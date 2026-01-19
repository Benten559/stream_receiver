/**
 * Bullet Hole Detection Pipeline
 * Complete detection workflow combining all CV algorithms
 * Now with multi-method detection: Sobel edges + LoG blobs + contrast enhancement
 */

import type { DetectedHole, DetectionParams } from './types.ts';
import { sobelEdgeDetection } from './edge_detection.ts';
import { findConnectedComponents } from './connected_components.ts';
import { analyzeShape } from './shape_analysis.ts';
import {
    contrastEnhancement,
    laplacianOfGaussian,
    deduplicateBlobs,
} from './blob_detection.ts';
import { backgroundSubtraction } from './background_subtraction.ts';

/**
 * Detect bullet holes in grayscale image
 * @param gray - Grayscale pixel data (width * height)
 * @param width - Image width
 * @param height - Image height
 * @param params - Detection parameters
 * @param referenceFrame - Optional reference frame for background subtraction
 * @returns Array of detected holes with metrics
 */
export function detectBulletHoles(
    gray: Uint8ClampedArray,
    width: number,
    height: number,
    params: DetectionParams,
    referenceFrame?: Uint8Array | Uint8ClampedArray
): DetectedHole[] {
    // Step 0a: Background subtraction (if reference frame available)
    const useBackgroundSub = params.useBackgroundSubtraction !== false && referenceFrame;
    let detectionMask: Uint8Array | Uint8ClampedArray;

    if (useBackgroundSub && referenceFrame) {
        // Use difference detection - most accurate for bullet holes
        detectionMask = backgroundSubtraction(
            gray,
            referenceFrame,
            width,
            height,
            params.differenceThreshold ?? 20,
            params.cleanNoise ?? true
        );
    } else {
        // Fallback to traditional edge/blob detection
        // Step 0b: Preprocessing - Contrast enhancement (optional)
        const useContrast = params.useContrastEnhancement !== false;
        detectionMask = useContrast
            ? contrastEnhancement(gray, width, height, params.contrastTileSize ?? 32)
            : gray;
    }

    let finalMask: Uint8Array | Uint8ClampedArray;

    if (useBackgroundSub) {
        // Background subtraction already produces a binary mask - use directly
        finalMask = detectionMask;
    } else {
        // Traditional multi-method detection
        const allBlobCenters: Array<{ x: number; y: number; size: number }> = [];

        // Method 1: Sobel Edge Detection
        const edges = sobelEdgeDetection(detectionMask, width, height, params.edgeThreshold);
        const edgeBlobs = findConnectedComponents(edges, width, height);

        for (const blob of edgeBlobs) {
            const metrics = analyzeShape(blob);
            allBlobCenters.push({
                x: metrics.centerX,
                y: metrics.centerY,
                size: metrics.area,
            });
        }

        // Method 2: Laplacian of Gaussian blob detection (optional)
        const useLoG = params.useLoGDetection !== false;
        let logMask: Uint8Array | null = null;

        if (useLoG) {
            logMask = laplacianOfGaussian(
                detectionMask,
                width,
                height,
                params.logSigma ?? 1.5,
                params.logThreshold ?? 10
            );
            const logBlobs = findConnectedComponents(logMask, width, height);

            for (const blob of logBlobs) {
                const metrics = analyzeShape(blob);
                allBlobCenters.push({
                    x: metrics.centerX,
                    y: metrics.centerY,
                    size: metrics.area,
                });
            }
        }

        // Combine masks
        const combinedMask = new Uint8Array(width * height);
        for (let i = 0; i < edges.length; i++) {
            if (useLoG && logMask) {
                combinedMask[i] = Math.max(edges[i]!, logMask[i]!);
            } else {
                combinedMask[i] = edges[i]!;
            }
        }

        finalMask = combinedMask;
    }

    // Step 3: Analyze blobs in final mask
    const detectedHoles: DetectedHole[] = [];

    // Use stricter limit for background subtraction (cleaner) vs traditional detection (noisier)
    // Reduced further for performance - with 4x downscale we expect very few blobs
    const maxBlobs = useBackgroundSub ? 100 : 200;
    const finalBlobs = findConnectedComponents(finalMask, width, height, maxBlobs);

    for (const blob of finalBlobs) {
        const metrics = analyzeShape(blob);

        // Filter by size
        if (metrics.area < params.minBlobSize || metrics.area > params.maxBlobSize) {
            continue;
        }

        // Filter by shape
        if (metrics.circularity < params.minCircularity ||
            metrics.compactness < params.minCompactness) {
            continue;
        }

        // Calculate confidence (0-100)
        // Weight circularity and compactness equally
        const confidence = Math.min(100,
            (metrics.circularity * 50) + (metrics.compactness * 50)
        );

        detectedHoles.push({
            center: { x: metrics.centerX, y: metrics.centerY },
            radius: metrics.radius,
            confidence,
            metrics,
        });
    }

    return detectedHoles;
}
