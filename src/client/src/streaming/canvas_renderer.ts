/**
 * Canvas rendering utilities for displaying camera frames
 * Handles base64 JPEG decoding and binary data streams for canvas rendering
 */

export class CanvasRenderer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameraId: string;
  private label: string;
  private canvasContainer: HTMLDivElement;

  constructor(containerId: string, cameraId: string, label: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element not found: ${containerId}`);
    }

    this.container = container;
    this.cameraId = cameraId;
    this.label = label;

    this.canvasContainer = this.createCanvasContainer();
    this.canvas = this.createCanvasElement();
    this.canvasContainer.appendChild(this.canvas);
    this.container.appendChild(this.canvasContainer);

    const ctx = this.canvas.getContext('2d', {
      // Turning off the alpha channel for better performance
      alpha: false,
      willReadFrequently: false
    });
    
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'low';  // 'low' is fastest
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

  private createCanvasElement(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = `canvas-${this.cameraId}-${Date.now()}`;
    return canvas;
  }

  /**
   * Decode base64 JPEG to ImageData
   */
  async decodeFrame(base64Data: string): Promise<ImageData> {
    const img = await this.createTempImage(base64Data);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;

    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) {
      throw new Error('Failed to get 2D context for temp canvas');
    }

    tempCtx.drawImage(img, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, img.width, img.height);

    return imageData;
  }

  private createTempImage(base64Data: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (error) => reject(new Error(`Failed to load image: ${error}`));
      img.src = `data:image/jpeg;base64,${base64Data}`;
    });
  }

  /**
   * Render frame (accepts both ImageData and HTMLImageElement)
   */
  renderFrame(source: ImageData | HTMLImageElement): void {
    // Resize canvas ONLY if/when dimensions change
    if (source instanceof HTMLImageElement) {
      if (this.canvas.width !== source.naturalWidth || 
          this.canvas.height !== source.naturalHeight) {
        this.canvas.width = source.naturalWidth;
        this.canvas.height = source.naturalHeight;
      }
      
      // no ImageData conversion
      this.ctx.drawImage(source, 0, 0);
      
    } else if (source instanceof ImageData) {
      if (this.canvas.width !== source.width || 
          this.canvas.height !== source.height) {
        this.canvas.width = source.width;
        this.canvas.height = source.height;
      }
      
      // Put ImageData directly
      this.ctx.putImageData(source, 0, 0);
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  getCanvasContainer(): HTMLDivElement {
    return this.canvasContainer;
  }

  destroy(): void {
    if (this.canvasContainer && this.canvasContainer.parentNode) {
      this.canvasContainer.parentNode.removeChild(this.canvasContainer);
    }
  }
}