/**
 * Shared Computer Vision Library
 * Cross-platform CV algorithms for browser and Deno
 */

// Types
export type {
    Point,
    Blob,
    ShapeMetrics,
    DetectedHole,
    DetectionParams,
    DetectedMarker,
    ROI,
    ExclusionZone
} from './types.ts';
export { DEFAULT_PARAMS } from './types.ts';

// Core Algorithms
export { sobelEdgeDetection } from './edge_detection.ts';
export { findConnectedComponents } from './connected_components.ts';
export { analyzeShape } from './shape_analysis.ts';

// High-level Pipeline
export { detectBulletHoles } from './detection_pipeline.ts';

// ROI Utilities
export {
    calculateROI,
    isPointInQuad,
    isInExclusionZone,
    filterHolesByROI
} from './roi_utils.ts';
