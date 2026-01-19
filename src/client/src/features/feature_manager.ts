/**
 * Feature Manager - orchestrates feature registration, toggling, and frame distribution
 */

import { SSEStreamClient } from '../streaming/sse_client.js';
import { CanvasRenderer } from '../streaming/canvas_renderer.js';
import type { Feature, RawFrame, FeatureContext } from '../types/streaming.types.js';

export class FeatureManager {
  // Stream management
  private streamClient: SSEStreamClient;
  private cameraId: string;
  private originalRenderer: CanvasRenderer;

  // Feature registry
  private features: Map<string, Feature> = new Map();

  // Shared canvas for feature pipeline
  private sharedCanvasRenderer: CanvasRenderer | null = null;
  private sharedCanvas: HTMLCanvasElement | null = null;

  // Event handling
  private frameHandler: ((event: Event) => void) | null = null;

  // Frame dropping (prevent queue backlog)
  private isProcessing: boolean = false;
  private droppedFrames: number = 0;
  private processedFrames: number = 0;
  private lastStatsLog: number = Date.now();

  constructor(streamClient: SSEStreamClient, cameraId: string, originalRenderer: CanvasRenderer) {
    this.streamClient = streamClient;
    this.cameraId = cameraId;
    this.originalRenderer = originalRenderer;

    // Bind frame handler
    this.frameHandler = (event: Event) => this.handleIncomingFrame(event);
    this.streamClient.addEventListener('frame', this.frameHandler);
  }

  /**
   * Register a feature
   */
  registerFeature(feature: Feature): void {
    if (this.features.has(feature.id)) {
      console.warn(`Feature already registered: ${feature.id}`);
      return;
    }

    console.log(`Registering feature: ${feature.name}`, {
      layer: feature.pipeline.layer,
      provides: feature.pipeline.provides,
      consumes: feature.pipeline.consumes,
    });
    this.features.set(feature.id, feature);
  }

  /**
   * Toggle a feature on/off
   */
  toggleFeature(featureId: string, enabled: boolean): void {
    const feature = this.features.get(featureId);

    if (!feature) {
      console.error(`Feature not found: ${featureId}`);
      return;
    }

    console.log(`Toggling feature ${feature.name}: ${enabled ? 'ON' : 'OFF'}`);
    feature.enabled = enabled;

    // Manage shared canvas lifecycle
    enabled ? this.ensureSharedCanvas() : this.cleanupSharedCanvasIfNeeded();

    // Notify UI of toggle
    this.emitFeatureToggleEvent(featureId, enabled);
  }

  /**
   * Emit feature toggle event for UI listeners
   */
  private emitFeatureToggleEvent(featureId: string, enabled: boolean): void {
    const event = new CustomEvent('featuretoggle', {
      detail: { featureId, enabled },
    });
    window.dispatchEvent(event);
  }

  /**
   * Get all active features sorted by pipeline layer
   */
  getActiveFeatures(): Feature[] {
    const active = Array.from(this.features.values()).filter(f => f.enabled);

    // Sort by layer (lower layers drawn first)
    return active.sort((a, b) => a.pipeline.layer - b.pipeline.layer);
  }

  /**
   * Get all registered features
   */
  getAllFeatures(): Feature[] {
    return Array.from(this.features.values());
  }

  /**
   * Ensure shared canvas exists
   */
  private ensureSharedCanvas(): void {
    if (this.sharedCanvasRenderer) {
      return; // Already exists
    }

    try {
      this.sharedCanvasRenderer = new CanvasRenderer(
        'stream-viewer',
        'features-composite',
        'Features (Composite)'
      );

      this.sharedCanvas = this.sharedCanvasRenderer.getCanvas();

      console.log('Shared features canvas created');
    } catch (error) {
      console.error('Failed to create shared canvas:', error);
    }
  }

  /**
   * Cleanup shared canvas if no features are enabled
   */
  private cleanupSharedCanvasIfNeeded(): void {
    const hasEnabledFeatures = this.getActiveFeatures().length > 0;

    if (!hasEnabledFeatures && this.sharedCanvasRenderer) {
      this.sharedCanvasRenderer.destroy();
      this.sharedCanvasRenderer = null;
      this.sharedCanvas = null;
      console.log('Shared features canvas destroyed (no active features)');
    }
  }

  /**
   * Handle incoming frame from SSE
   * IMPORTANT: Drops frames if already processing OR if frame is too old (prevent lag)
   */
  private async handleIncomingFrame(event: Event): Promise<void> {
    const customEvent = event as CustomEvent<RawFrame>;
    const rawFrame = customEvent.detail;

    // DROP FRAME if already processing previous frame (prevent queue buildup!)
    if (this.isProcessing) {
      this.droppedFrames++;
      this.logDropStats();
      return;
    }

    // DROP FRAME if too old (prevent displaying stale frames)
    const frameAge = Date.now() - rawFrame.timestamp;
    if (frameAge > 500) {  // Drop frames older than 500ms
      this.droppedFrames++;
      if (frameAge > 1000 && this.droppedFrames % 10 === 0) {
        console.warn(`[FrameManager] Dropping old frames! Age: ${frameAge}ms - processing too slow!`);
      }
      this.logDropStats();
      return;
    }

    this.isProcessing = true;

    try {
      // Decode frame once
      const imageData = await this.originalRenderer.decodeFrame(rawFrame.base64Data);

      // Render to original canvas
      this.originalRenderer.renderFrame(imageData);

      // Process all active features
      await this.processFeatures(imageData);

      this.processedFrames++;
      this.logDropStats();
    } catch (error) {
      console.error('Failed to process frame:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Log frame drop statistics every 5 seconds
   */
  private logDropStats(): void {
    const now = Date.now();
    const elapsed = now - this.lastStatsLog;

    if (elapsed >= 5000) { // Log every 5 seconds
      const total = this.processedFrames + this.droppedFrames;
      const dropRate = total > 0 ? ((this.droppedFrames / total) * 100).toFixed(1) : '0.0';

      console.log(
        `[FrameStats] Processed: ${this.processedFrames}, Dropped: ${this.droppedFrames} (${dropRate}% drop rate)`
      );

      // Reset counters
      this.processedFrames = 0;
      this.droppedFrames = 0;
      this.lastStatsLog = now;
    }
  }

  /**
   * Process all active features using context pipeline
   */
  private async processFeatures(imageData: ImageData): Promise<void> {
    const activeFeatures = this.getActiveFeatures();

    if (activeFeatures.length === 0) {
      return;
    }

    if (!this.prepareSharedCanvas(imageData)) {
      return; // Canvas preparation failed
    }

    // Run feature pipeline with context flow
    await this.runFeaturePipeline(activeFeatures, imageData);
  }

  /**
   * Prepare shared canvas for rendering (create, resize, clear)
   * @returns true if canvas is ready, false otherwise
   */
  private prepareSharedCanvas(imageData: ImageData): boolean {
    this.ensureSharedCanvas();

    if (!this.sharedCanvas) {
      console.warn('Shared canvas not available');
      return false;
    }

    // Resize if needed
    if (
      this.sharedCanvas.width !== imageData.width ||
      this.sharedCanvas.height !== imageData.height
    ) {
      this.sharedCanvas.width = imageData.width;
      this.sharedCanvas.height = imageData.height;
    }

    // Clear canvas
    const ctx = this.sharedCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.sharedCanvas.width, this.sharedCanvas.height);
    }

    return true;
  }

  /**
   * Run the feature pipeline, passing context between features
   */
  private async runFeaturePipeline(
    features: Feature[],
    imageData: ImageData
  ): Promise<void> {
    let context: FeatureContext = {};

    for (const feature of features) {
      try {
        const result = await feature.process(
          imageData,
          this.sharedCanvas!,
          context
        );

        // Merge feature output into pipeline context
        context = this.mergeContext(context, result, feature);
      } catch (error) {
        console.error(`Feature ${feature.id} processing failed:`, error);
        // Continue with next feature (don't let one failure break the pipeline)
      }
    }
  }

  /**
   * Merge feature result into pipeline context
   */
  private mergeContext(
    context: FeatureContext,
    result: FeatureContext | void,
    feature: Feature
  ): FeatureContext {
    if (!result || typeof result !== 'object') {
      return context;
    }

    // Debug: Log what this feature provided
    if (feature.pipeline.provides && feature.pipeline.provides.length > 0) {
      const provided = feature.pipeline.provides.filter(
        (key) => key in result
      );
      if (provided.length > 0) {
        console.log(`Feature ${feature.id} provided:`, provided);
      }
    }

    return { ...context, ...result };
  }

  /**
   * Destroy feature manager and cleanup
   */
  destroy(): void {
    // Remove frame handler
    if (this.frameHandler) {
      this.streamClient.removeEventListener('frame', this.frameHandler);
      this.frameHandler = null;
    }

    // Destroy shared canvas
    if (this.sharedCanvasRenderer) {
      this.sharedCanvasRenderer.destroy();
      this.sharedCanvasRenderer = null;
      this.sharedCanvas = null;
    }

    // Reset frame stats
    this.isProcessing = false;
    this.droppedFrames = 0;
    this.processedFrames = 0;

    this.features.clear();
  }
}
