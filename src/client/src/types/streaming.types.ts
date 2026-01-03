/**
 * Type definitions for SSE-based streaming and feature processing system
 */

/**
 * Raw frame data received from SSE endpoint
 */
export interface RawFrame {
  base64Data: string;
  timestamp: number;
}

/**
 * Decoded frame with ImageData ready for processing
 */
export interface DecodedFrame {
  imageData: ImageData;
  timestamp: number;
  cameraId: string;
}

/**
 * Context object that flows through the feature pipeline
 * Features can read from and write to this context to share data
 */
export interface FeatureContext {
  [key: string]: unknown;
}

/**
 * Pipeline metadata for a feature
 */
export interface FeaturePipeline {
  provides?: string[];   // Context keys this feature writes
  consumes?: string[];   // Context keys this feature reads
  layer: number;         // Drawing order (0 = bottom, higher = on top)
}

/**
 * Feature definition with metadata and processing function
 */
export interface Feature {
  id: string;
  name: string;
  description: string;
  process: FeatureProcessor;
  enabled: boolean;
  pipeline: FeaturePipeline;  // Pipeline configuration
}

/**
 * Feature processor function signature
 * Takes source ImageData, renders to shared canvas, and receives/returns context
 * Can be sync or async
 */
export type FeatureProcessor = (
  sourceImageData: ImageData,
  sharedCanvas: HTMLCanvasElement,
  context: Readonly<FeatureContext>
) => FeatureContext | void | Promise<FeatureContext | void>;

/**
 * Custom event for SSE frame arrival
 */
export interface SSEFrameEvent extends Event {
  detail: RawFrame;
}

/**
 * Custom event for feature toggle
 */
export interface FeatureToggleEvent extends Event {
  detail: {
    featureId: string;
    enabled: boolean;
  };
}
