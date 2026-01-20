import { IStreamClient } from "../types/streaming.types";

/**
 * MJPEG Stream Client
 * Uses an <img> element to display MJPEG stream from server.
 * Uses requestAnimationFrame to continuously emit frame events for canvas rendering.
 */
export class MJPEGStreamClient extends EventTarget implements IStreamClient {
  private img: HTMLImageElement;
  private url: string;
  private isConnected: boolean = false;
  private animationFrameId: number | null = null;
  private imageReady: boolean = false;

  constructor(cameraId: string) {
    super();
    this.url = `/camera/stream/${cameraId}`;
    this.img = new Image();
    // Allow cross-origin if needed
    this.img.crossOrigin = 'anonymous';
  }

  connect() {
    this.isConnected = true;
    this.imageReady = false;

    // onload fires once when the MJPEG stream starts
    this.img.onload = () => {
      if (!this.isConnected) return;
      console.log(`[MJPEG] Stream loaded: ${this.img.naturalWidth}x${this.img.naturalHeight}`);
      this.imageReady = true;
      // Start the render loop once the image is ready
      this.startRenderLoop();
    };

    this.img.onerror = (e) => {
      if (this.isConnected) {
        console.error('[MJPEG] Stream error:', e);
        this.dispatchEvent(new CustomEvent('error', { detail: e }));
      }
    };

    // Start the MJPEG stream
    this.img.src = this.url;
    this.dispatchEvent(new CustomEvent('connected'));
  }

  /**
   * Continuously emit frame events using requestAnimationFrame.
   * The browser updates the img element automatically for MJPEG streams,
   * but we need to poll it to draw to canvas and overlay holes.
   */
  private startRenderLoop() {
    const emitFrame = () => {
      if (!this.isConnected || !this.imageReady) return;

      // Only emit if image has valid dimensions
      if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
        this.dispatchEvent(new CustomEvent('frame', {
          detail: {
            image: this.img,
            timestamp: Date.now()
          }
        }));
      }

      // Continue the loop
      this.animationFrameId = requestAnimationFrame(emitFrame);
    };

    // Start the loop
    this.animationFrameId = requestAnimationFrame(emitFrame);
  }

  disconnect() {
    this.isConnected = false;
    this.imageReady = false;

    // Stop the render loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.img.onload = null;
    this.img.onerror = null;
    this.img.src = "";  // Terminate the stream

    this.dispatchEvent(new CustomEvent('disconnected'));
  }
}
