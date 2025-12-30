/**
 * Feature Manager - orchestrates feature registration, toggling, and frame distribution
 */

import { SSEStreamClient } from '../streaming/sse_client.js';
import { CanvasRenderer } from '../streaming/canvas_renderer.js';
import type { Feature, RawFrame } from '../types/streaming.types.js';

export class FeatureManager {
  private streamClient: SSEStreamClient;
  private cameraId: string;
  private originalRenderer: CanvasRenderer;
  private features: Map<string, Feature> = new Map();
  private featureRenderers: Map<string, CanvasRenderer> = new Map();
  private frameHandler: ((event: Event) => void) | null = null;

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

    console.log(`Registering feature: ${feature.name}`);
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

    if (enabled) {
      // Create canvas for this feature
      this.createFeatureCanvas(feature);
    } else {
      // Destroy canvas for this feature
      this.destroyFeatureCanvas(featureId);
    }

    // Emit toggle event
    const toggleEvent = new CustomEvent('featuretoggle', {
      detail: {
        featureId,
        enabled,
      },
    });
    window.dispatchEvent(toggleEvent);
  }

  /**
   * Get all active features
   */
  getActiveFeatures(): Feature[] {
    return Array.from(this.features.values()).filter(f => f.enabled);
  }

  /**
   * Get all registered features
   */
  getAllFeatures(): Feature[] {
    return Array.from(this.features.values());
  }

  /**
   * Create canvas for a feature
   */
  private createFeatureCanvas(feature: Feature): void {
    if (this.featureRenderers.has(feature.id)) {
      console.warn(`Canvas already exists for feature: ${feature.id}`);
      return;
    }

    try {
      const renderer = new CanvasRenderer(
        'stream-viewer',
        feature.id,
        feature.name
      );

      this.featureRenderers.set(feature.id, renderer);
    } catch (error) {
      console.error(`Failed to create canvas for feature ${feature.id}:`, error);
    }
  }

  /**
   * Destroy canvas for a feature
   */
  private destroyFeatureCanvas(featureId: string): void {
    const renderer = this.featureRenderers.get(featureId);

    if (renderer) {
      renderer.destroy();
      this.featureRenderers.delete(featureId);
    }
  }

  /**
   * Handle incoming frame from SSE
   */
  private async handleIncomingFrame(event: Event): Promise<void> {
    const customEvent = event as CustomEvent<RawFrame>;
    const rawFrame = customEvent.detail;

    try {
      // Decode frame once
      const imageData = await this.originalRenderer.decodeFrame(rawFrame.base64Data);

      // Render to original canvas
      this.originalRenderer.renderFrame(imageData);

      // Process all active features
      await this.processFeatures(imageData);
    } catch (error) {
      console.error('Failed to process frame:', error);
    }
  }

  /**
   * Process all active features with the decoded frame
   */
  private async processFeatures(imageData: ImageData): Promise<void> {
    const activeFeatures = this.getActiveFeatures();

    for (const feature of activeFeatures) {
      const renderer = this.featureRenderers.get(feature.id);

      if (!renderer) {
        console.warn(`No renderer found for active feature: ${feature.id}`);
        continue;
      }

      try {
        // Call feature processor
        await feature.process(imageData, renderer.getCanvas());
      } catch (error) {
        console.error(`Feature ${feature.id} processing failed:`, error);
        // Continue processing other features
      }
    }
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

    // Destroy all feature canvases
    for (const featureId of this.featureRenderers.keys()) {
      this.destroyFeatureCanvas(featureId);
    }

    this.features.clear();
    this.featureRenderers.clear();
  }
}
