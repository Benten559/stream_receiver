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
 * Feature definition with metadata and processing function
 */
export interface Feature {
  id: string;
  name: string;
  description: string;
  process: FeatureProcessor;
  enabled: boolean;
}

/**
 * Feature processor function signature
 * Takes source ImageData and renders to output canvas
 * Can be sync or async
 */
export type FeatureProcessor = (
  sourceImageData: ImageData,
  outputCanvas: HTMLCanvasElement
) => void | Promise<void>;

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
