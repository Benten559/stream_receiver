import { IStreamClient } from "../types/streaming.types";

/**
 * MJPEG Stream Client
 * Renders frames from a multipart/x-mixed-replace MJPEG endpoint.
 *
 * The render loop starts immediately on connect() and spins via RAF.
 * naturalWidth > 0 gates frame events so they only fire after the
 * first JPEG part is decoded — no dependency on img.onload timing.
 */
export class MJPEGStreamClient extends EventTarget implements IStreamClient {
  private img: HTMLImageElement;
  private url: string;
  private isConnected: boolean = false;
  private animationFrameId: number | null = null;

  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private lastFpsLog: number = Date.now();

  constructor(cameraId: string) {
    super();
    this.url = `/camera/stream/${cameraId}`;
    this.img = new Image();
    // crossOrigin NOT set — same-origin stream, no CORS restriction needed,
    // and setting it can taint the canvas with certain MJPEG streams.
  }

  connect() {
    this.isConnected = true;

    this.img.onload = () => {
      if (!this.isConnected) return;
      console.log(`[MJPEG] First frame decoded: ${this.img.naturalWidth}x${this.img.naturalHeight}`);
    };

    this.img.onerror = (e) => {
      if (this.isConnected) {
        console.error('[MJPEG] Stream error:', e);
        this.dispatchEvent(new CustomEvent('error', { detail: e }));
      }
    };

    this.img.src = this.url;

    // Start the render loop immediately — don't wait for onload.
    // The naturalWidth guard inside emitFrame prevents events firing
    // before the first frame has been decoded.
    this.startRenderLoop();
    this.dispatchEvent(new CustomEvent('connected'));
  }

  private startRenderLoop() {
    const emitFrame = () => {
      // Only stop on explicit disconnect.
      if (!this.isConnected) return;

      // Gate on actual decoded dimensions — 0 means no frame yet.
      if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
        const now = performance.now();

        if (now - this.lastFrameTime >= 33) { // ~30 FPS cap
          this.dispatchEvent(new CustomEvent('frame', {
            detail: {
              image: this.img,
              timestamp: Date.now()
            }
          }));

          this.lastFrameTime = now;
          this.frameCount++;

          const elapsed = Date.now() - this.lastFpsLog;
          if (elapsed >= 2000) {
            const fps = (this.frameCount / elapsed) * 1000;
            console.debug(`[MJPEG] Emitting ${fps.toFixed(1)} FPS`);
            this.frameCount = 0;
            this.lastFpsLog = Date.now();
          }
        }
      }

      // Always reschedule — loop only dies on disconnect.
      this.animationFrameId = requestAnimationFrame(emitFrame);
    };

    this.animationFrameId = requestAnimationFrame(emitFrame);
  }

  disconnect() {
    this.isConnected = false;

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
