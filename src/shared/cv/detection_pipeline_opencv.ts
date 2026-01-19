/**
 * Bullet Hole Detection Pipeline (OpenCV.js Optimized)
 * 5-10x faster than custom JavaScript implementation
 * Uses WebAssembly-compiled C++ for near-native performance
 */

import type { DetectedHole, DetectionParams } from './types.ts';
import { analyzeShape } from './shape_analysis.ts';
import {
    isOpenCVReady,
    backgroundSubtractionCV,
    connectedComponentsCV,
    cannyEdgeDetectionCV,
    morphologyCV,
} from './opencv_optimized.ts';

// OpenCV types global
declare const cv: any;

/**
 * Detect bullet holes using OpenCV.js (FAST!)
 * @param grayMat - Grayscale Mat (CV_8UC1)
 * @param params - Detection parameters
 * @param referenceMat - Optional reference frame Mat for background subtraction
 * @returns Array of detected holes with metrics
 */
export function detectBulletHolesCV(
    grayMat: any,
    params: DetectionParams,
    referenceMat?: any
): DetectedHole[] {
    if (!isOpenCVReady()) {
        throw new Error('OpenCV.js not loaded - cannot use optimized pipeline');
    }

    const useBackgroundSub = params.useBackgroundSubtraction !== false && referenceMat;
    let binaryMask: any;

    try {
        if (useBackgroundSub && referenceMat) {
            // Use OpenCV background subtraction (FAST!)
            console.log('[OpenCV Pipeline] Using background subtraction');
            binaryMask = backgroundSubtractionCV(
                grayMat,
                referenceMat,
                params.differenceThreshold ?? 15
            );

            // Optional: Apply morphological closing to fill small gaps
            if (params.cleanNoise) {
                const cleaned = morphologyCV(binaryMask, cv.MORPH_CLOSE, 3);
                binaryMask.delete();
                binaryMask = cleaned;
            }
        } else {
            // Use edge detection (Canny is often better than Sobel for holes)
            console.log('[OpenCV Pipeline] Using Canny edge detection');
            const lowThreshold = (params.edgeThreshold ?? 50) / 2;
            const highThreshold = params.edgeThreshold ?? 50;

            binaryMask = cannyEdgeDetectionCV(grayMat, lowThreshold, highThreshold);
        }

        // Find connected components (FAST - optimized union-find!)
        console.log('[OpenCV Pipeline] Finding connected components');
        const blobs = connectedComponentsCV(
            binaryMask,
            params.minBlobSize ?? 5,
            params.maxBlobSize ?? 5000,
            200 // Max components for performance
        );

        console.log(`[OpenCV Pipeline] Found ${blobs.length} components`);

        // Analyze shapes and filter
        const detectedHoles: DetectedHole[] = [];

        for (const blob of blobs) {
            const metrics = analyzeShape(blob);

            // Filter by shape quality
            if (
                metrics.circularity < (params.minCircularity ?? 0.25) ||
                metrics.compactness < (params.minCompactness ?? 0.2)
            ) {
                continue;
            }

            // Calculate confidence
            const confidence = Math.min(
                100,
                metrics.circularity * 50 + metrics.compactness * 50
            );

            detectedHoles.push({
                center: { x: metrics.centerX, y: metrics.centerY },
                radius: metrics.radius,
                confidence,
                metrics,
            });
        }

        console.log(`[OpenCV Pipeline] Detected ${detectedHoles.length} holes after filtering`);

        return detectedHoles;
    } finally {
        // Clean up Mat to avoid memory leaks
        if (binaryMask) {
            binaryMask.delete();
        }
    }
}
