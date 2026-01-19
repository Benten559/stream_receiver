/**
 * Canvas rendering utilities for displaying camera frames
 * Handles base64 JPEG decoding and canvas rendering
 */

export class CanvasRenderer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameraId: string;
  private label: string;
  private canvasContainer: HTMLDivElement;

  // Decode stats (log every 100 frames to reduce console spam)
  private decodeCount: number = 0;

  constructor(containerId: string, cameraId: string, label: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element not found: ${containerId}`);
    }

    this.container = container;
    this.cameraId = cameraId;
    this.label = label;

    // Create canvas wrapper
    this.canvasContainer = this.createCanvasContainer();
    this.canvas = this.createCanvasElement();
    this.canvasContainer.appendChild(this.canvas);
    this.container.appendChild(this.canvasContainer);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;
  }

  /**
   * Create canvas wrapper container with label
   */
  private createCanvasContainer(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'stream-canvas-container';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'label';
    labelDiv.textContent = this.label;

    wrapper.appendChild(labelDiv);

    return wrapper;
  }

  /**
   * Create canvas element
   */
  private createCanvasElement(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = `canvas-${this.cameraId}-${Date.now()}`;
    return canvas;
  }

  /**
   * Decode base64 JPEG to ImageData
   * @param base64Data - Base64 encoded JPEG data
   * @returns Promise<ImageData>
   */
  async decodeFrame(base64Data: string): Promise<ImageData> {
    try {
      const img = await this.createTempImage(base64Data);

      // Create temporary canvas for decoding
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;

      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        throw new Error('Failed to get 2D context for temp canvas');
      }

      // Draw image to temp canvas
      tempCtx.drawImage(img, 0, 0);

      // Extract ImageData
      const imageData = tempCtx.getImageData(0, 0, img.width, img.height);

      return imageData;
    } catch (error) {
      const preview = base64Data.substring(0, 20);
      console.error(
        `[CanvasRenderer] JPEG decode failed: ${error}`,
        `Base64 length: ${base64Data.length}, Preview: ${preview}...`
      );
      throw error;
    }
  }

  /**
   * Create temporary image element from base64 data
   * @param base64Data - Base64 encoded JPEG
   * @returns Promise<HTMLImageElement>
   */
  private createTempImage(base64Data: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        this.decodeCount++;
        // Log every 100 frames to reduce console spam
        if (this.decodeCount % 100 === 0) {
          console.log(`[CanvasRenderer] Decoded ${this.decodeCount} frames: ${img.width}x${img.height}, ${(base64Data.length / 1024).toFixed(1)} KB`);
        }
        resolve(img);
      };

      img.onerror = (error) => {
        const preview = base64Data.substring(0, 50);
        console.error(
          `[CanvasRenderer] Image load error:`,
          `Length: ${base64Data.length} bytes`,
          `Preview: ${preview}...`,
          error
        );
        reject(new Error(`Failed to load JPEG image: ${error}`));
      };

      // Set data URL
      img.src = `data:image/jpeg;base64,${base64Data}`;
    });
  }

  /**
   * Render ImageData to canvas
   * @param imageData - ImageData to render
   */
  renderFrame(imageData: ImageData): void {
    // Resize canvas if needed
    if (this.canvas.width !== imageData.width || this.canvas.height !== imageData.height) {
      this.canvas.width = imageData.width;
      this.canvas.height = imageData.height;
    }

    // Render frame
    this.ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Get the canvas element
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Get the canvas context
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Get canvas container div
   */
  getCanvasContainer(): HTMLDivElement {
    return this.canvasContainer;
  }

  /**
   * Destroy canvas and remove from DOM
   */
  destroy(): void {
    if (this.canvasContainer && this.canvasContainer.parentNode) {
      this.canvasContainer.parentNode.removeChild(this.canvasContainer);
    }
  }
}
