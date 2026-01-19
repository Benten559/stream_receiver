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

// Advanced Blob Detection
export {
    gaussianBlur,
    applyLaplacian,
    laplacianOfGaussian,
    contrastEnhancement,
    deduplicateBlobs
} from './blob_detection.ts';

// Background Subtraction
export {
    computeDifference,
    thresholdDifference,
    morphologicalClean,
    backgroundSubtraction
} from './background_subtraction.ts';

// High-level Pipelines
export { detectBulletHoles } from './detection_pipeline.ts';
export { detectBulletHolesCV } from './detection_pipeline_opencv.ts'; // OpenCV.js optimized!

// OpenCV.js Optimized Functions (5-10x faster!)
export {
    isOpenCVReady,
    backgroundSubtractionCV,
    connectedComponentsCV,
    cannyEdgeDetectionCV,
    morphologyCV,
    gaussianBlurCV,
    matToUint8Array,
    uint8ArrayToMat
} from './opencv_optimized.ts';

// ROI Utilities
export {
    calculateROI,
    isPointInQuad,
    isInExclusionZone,
    filterHolesByROI
} from './roi_utils.ts';
