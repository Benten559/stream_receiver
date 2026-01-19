/**
 * OpenCV.js Optimized CV Algorithms
 * 5-10x faster than custom JavaScript implementations
 * Uses WebAssembly-compiled C++ code for near-native performance
 */

import type { DetectedHole, Blob } from './types.ts';

// OpenCV types global
declare const cv: any;

/**
 * Check if OpenCV.js is loaded and ready
 */
export function isOpenCVReady(): boolean {
    return typeof cv !== 'undefined' && cv.Mat !== undefined;
}

/**
 * Background subtraction using OpenCV (FAST - uses cv.absdiff + cv.threshold)
 * ~10x faster than custom JavaScript implementation
 * @param current - Current frame Mat
 * @param reference - Reference frame Mat
 * @param threshold - Difference threshold (default: 15)
 * @returns Binary mask Mat (caller must delete!)
 */
export function backgroundSubtractionCV(
    current: any,
    reference: any,
    threshold: number = 15
): any {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded');
    }

    // 1. Compute absolute difference (C++ speed!)
    const diff = new cv.Mat();
    cv.absdiff(current, reference, diff);

    // 2. Threshold to binary mask
    const mask = new cv.Mat();
    cv.threshold(diff, mask, threshold, 255, cv.THRESH_BINARY);

    // Clean up
    diff.delete();

    return mask;
}

/**
 * Connected components analysis using OpenCV (FAST - optimized union-find algorithm)
 * ~10x faster than custom flood-fill implementation
 * @param binary - Binary image Mat (CV_8UC1, values 0 or 255)
 * @param minSize - Minimum component area in pixels
 * @param maxSize - Maximum component area in pixels
 * @param maxComponents - Maximum components to return (performance limit)
 * @returns Array of blobs with bounding boxes
 */
export function connectedComponentsCV(
    binary: any,
    minSize: number = 5,
    maxSize: number = 5000,
    maxComponents: number = 100
): Blob[] {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded');
    }

    // Run connected components with stats
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();

    const numLabels = cv.connectedComponentsWithStats(
        binary,
        labels,
        stats,
        centroids,
        8, // 8-connectivity
        cv.CV_32S
    );

    const blobs: Blob[] = [];

    // Extract components (skip label 0 = background)
    for (let i = 1; i < numLabels && blobs.length < maxComponents; i++) {
        const area = stats.intAt(i, cv.CC_STAT_AREA);

        // Filter by size
        if (area < minSize || area > maxSize) {
            continue;
        }

        const left = stats.intAt(i, cv.CC_STAT_LEFT);
        const top = stats.intAt(i, cv.CC_STAT_TOP);
        const width = stats.intAt(i, cv.CC_STAT_WIDTH);
        const height = stats.intAt(i, cv.CC_STAT_HEIGHT);

        // Extract pixels for this component
        const pixels: { x: number; y: number }[] = [];

        // Sample pixels from the labeled region
        for (let y = top; y < top + height; y++) {
            for (let x = left; x < left + width; x++) {
                if (labels.intAt(y, x) === i) {
                    pixels.push({ x, y });
                }
            }
        }

        blobs.push({
            pixels,
            minX: left,
            maxX: left + width - 1,
            minY: top,
            maxY: top + height - 1,
        });
    }

    // Clean up
    labels.delete();
    stats.delete();
    centroids.delete();

    return blobs;
}

/**
 * Edge detection using Canny (FAST - OpenCV C++ implementation)
 * Alternative to Sobel, often better for bullet holes
 * @param src - Grayscale source Mat
 * @param lowThreshold - Low threshold for hysteresis
 * @param highThreshold - High threshold for hysteresis
 * @returns Binary edge map Mat (caller must delete!)
 */
export function cannyEdgeDetectionCV(
    src: any,
    lowThreshold: number = 50,
    highThreshold: number = 150
): any {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded');
    }

    const edges = new cv.Mat();

    // Apply Canny edge detection
    cv.Canny(src, edges, lowThreshold, highThreshold, 3, false);

    return edges;
}

/**
 * Morphological operations (erosion/dilation) using OpenCV
 * Much faster than custom implementations
 * @param src - Source binary Mat
 * @param operation - cv.MORPH_ERODE, cv.MORPH_DILATE, cv.MORPH_OPEN, cv.MORPH_CLOSE
 * @param kernelSize - Kernel size (3, 5, 7, etc.)
 * @returns Processed Mat (caller must delete!)
 */
export function morphologyCV(
    src: any,
    operation: number,
    kernelSize: number = 3
): any {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded');
    }

    const kernel = cv.getStructuringElement(
        cv.MORPH_RECT,
        new cv.Size(kernelSize, kernelSize)
    );

    const dst = new cv.Mat();
    cv.morphologyEx(src, dst, operation, kernel);

    kernel.delete();

    return dst;
}

/**
 * Gaussian blur using OpenCV (for smoothing before edge detection)
 * @param src - Source Mat
 * @param kernelSize - Kernel size (must be odd)
 * @param sigma - Gaussian sigma
 * @returns Blurred Mat (caller must delete!)
 */
export function gaussianBlurCV(
    src: any,
    kernelSize: number = 5,
    sigma: number = 1.5
): any {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded');
    }

    const dst = new cv.Mat();
    const ksize = new cv.Size(kernelSize, kernelSize);

    cv.GaussianBlur(src, dst, ksize, sigma, sigma, cv.BORDER_DEFAULT);

    return dst;
}

/**
 * Convert Mat to Uint8Array (for compatibility with existing code)
 * @param mat - OpenCV Mat (CV_8UC1)
 * @returns Uint8ClampedArray of pixel data
 */
export function matToUint8Array(mat: any): Uint8ClampedArray {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded');
    }

    const data = new Uint8ClampedArray(mat.data.length);
    for (let i = 0; i < mat.data.length; i++) {
        data[i] = mat.data[i];
    }

    return data;
}

/**
 * Create Mat from Uint8Array
 * @param data - Pixel data
 * @param width - Image width
 * @param height - Image height
 * @returns OpenCV Mat (CV_8UC1, caller must delete!)
 */
export function uint8ArrayToMat(
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number
): any {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded');
    }

    const mat = new cv.Mat(height, width, cv.CV_8UC1);

    for (let i = 0; i < data.length; i++) {
        mat.data[i] = data[i];
    }

    return mat;
}
