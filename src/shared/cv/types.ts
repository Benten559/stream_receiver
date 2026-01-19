/**
 * Shared Computer Vision Types
 * Used by both browser client and Deno notebooks
 */

/**
 * 2D point coordinates
 */
export interface Point {
    x: number;
    y: number;
}

/**
 * Connected component blob
 */
export interface Blob {
    pixels: Point[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * Shape analysis metrics
 */
export interface ShapeMetrics {
    area: number;
    perimeter: number;
    circularity: number;  // 4π * Area / Perimeter² (1.0 = perfect circle)
    compactness: number;  // Area / Bounding Box Area
    centerX: number;
    centerY: number;
    radius: number;       // Approximate radius from area
}

/**
 * Detected bullet hole
 */
export interface DetectedHole {
    center: Point;
    radius: number;
    confidence: number;   // 0-100
    metrics: ShapeMetrics;
}

/**
 * Detection algorithm parameters
 */
export interface DetectionParams {
    // Edge Detection (Sobel)
    edgeThreshold: number;      // 0-255, lower = more sensitive

    // Blob Size Constraints
    minBlobSize: number;        // Minimum blob area in pixels²
    maxBlobSize: number;        // Maximum blob area in pixels²

    // Shape Analysis
    minCircularity: number;     // 0-1
    minCompactness: number;     // 0-1

    // Advanced Detection (optional)
    useContrastEnhancement?: boolean;  // Enable CLAHE-like preprocessing
    contrastTileSize?: number;         // Tile size for local contrast (default: 32)
    useLoGDetection?: boolean;         // Enable Laplacian of Gaussian blob detection
    logSigma?: number;                 // LoG Gaussian sigma (default: 1.5)
    logThreshold?: number;             // LoG threshold (default: 10)

    // Background Subtraction (optional)
    useBackgroundSubtraction?: boolean; // Enable reference-based difference detection
    differenceThreshold?: number;       // Minimum pixel change to detect (default: 20)
    cleanNoise?: boolean;               // Apply morphological cleaning (default: true)
}

/**
 * Detected fiducial marker (ArUco or similar)
 */
export interface DetectedMarker {
    id: number;
    corners: Point[];
    center: Point;
}

/**
 * Region of Interest with exclusion zones
 */
export interface ROI {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    corners: Point[];
    exclusionZones: ExclusionZone[];
}

/**
 * Exclusion zone (area to ignore detections)
 */
export interface ExclusionZone {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * Default detection parameters
 */
export const DEFAULT_PARAMS: DetectionParams = {
    edgeThreshold: 50,
    minBlobSize: 10,
    maxBlobSize: 2000,
    minCircularity: 0.4,
    minCompactness: 0.3,
};
