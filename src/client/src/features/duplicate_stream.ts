/**
 * Duplicate Stream Feature
 * Simply displays an exact copy of the original stream
 */

import type { Feature, FeatureProcessor } from '../types/streaming.types.js';

/**
 * Duplicate feature processor - passthrough rendering
 */
const duplicateProcessor: FeatureProcessor = (
  sourceImageData: ImageData,
  outputCanvas: HTMLCanvasElement
): void => {
  const ctx = outputCanvas.getContext('2d');

  if (!ctx) {
    console.error('Failed to get 2D context for duplicate canvas');
    return;
  }

  // Ensure canvas matches image dimensions
  if (outputCanvas.width !== sourceImageData.width || outputCanvas.height !== sourceImageData.height) {
    outputCanvas.width = sourceImageData.width;
    outputCanvas.height = sourceImageData.height;
  }

  // Draw the image data directly (no processing)
  ctx.putImageData(sourceImageData, 0, 0);
};

/**
 * Duplicate feature definition
 */
export const duplicateFeature: Feature = {
  id: 'duplicate',
  name: 'Duplicate Stream',
  description: 'Shows an exact copy of the original stream',
  process: duplicateProcessor,
  enabled: false,
};
