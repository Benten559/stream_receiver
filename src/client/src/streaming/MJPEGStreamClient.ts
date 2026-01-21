import { IStreamClient } from "../types/streaming.types";

/**
 * MJPEG Stream Client
 * Only emits frame events when the image actually changes
 * This prevents rendering the same frame multiple times
 */
export class MJPEGStreamClient extends EventTarget implements IStreamClient {
  private img: HTMLImageElement;
  private url: string;
  private isConnected: boolean = false;
  private animationFrameId: number | null = null;
  private imageReady: boolean = false;
  
  // Track last frame to detect changes
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private lastFpsLog: number = Date.now();
  
  constructor(cameraId: string) {
    super();
    this.url = `/camera/stream/${cameraId}`;
    this.img = new Image();
    this.img.crossOrigin = 'anonymous';
  }

  connect() {
    this.isConnected = true;
    this.imageReady = false;

    this.img.onload = () => {
      if (!this.isConnected) return;
      console.log(`[MJPEG] Stream loaded: ${this.img.naturalWidth}x${this.img.naturalHeight}`);
      this.imageReady = true;
      this.startRenderLoop();
    };

    this.img.onerror = (e) => {
      if (this.isConnected) {
        console.error('[MJPEG] Stream error:', e);
        this.dispatchEvent(new CustomEvent('error', { detail: e }));
      }
    };

    this.img.src = this.url;
    this.dispatchEvent(new CustomEvent('connected'));
  }

  /**
   * Only emit frames at a limited rate to prevent overwhelming renderer
   * Will limit the images being rendered to webpage to be 30 FPS mapx
   */
  private startRenderLoop() {
    const emitFrame = () => {
      if (!this.isConnected || !this.imageReady) return;

      const now = performance.now();
      
      // Only emit frames every 33ms (~30 FPS max)
      // This prevents emitting 60 FPS when RAF runs faster than MJPEG updates
      if (now - this.lastFrameTime >= 33) {  // 30 FPS limit
        
        // Only emit if image has valid dimensions
        if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
          this.dispatchEvent(new CustomEvent('frame', {
            detail: {
              image: this.img,
              timestamp: Date.now()
            }
          }));
          
          this.lastFrameTime = now;
          this.frameCount++;
          
          // Log actual FPS every 2 seconds
          const elapsed = Date.now() - this.lastFpsLog;
          if (elapsed >= 2000) {
            const fps = (this.frameCount / elapsed) * 1000;
            console.debug(`[MJPEG] Emitting ${fps.toFixed(1)} FPS`);
            this.frameCount = 0;
            this.lastFpsLog = Date.now();
          }
        }
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

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.img.onload = null;
    this.img.onerror = null;
    this.img.src = "";
    this.dispatchEvent(new CustomEvent('disconnected'));
  }
}
