/**
 * Bullet Hole Detection Pipeline
 * Complete detection workflow combining all CV algorithms
 */

import type { DetectedHole, DetectionParams } from './types.ts';
import { sobelEdgeDetection } from './edge_detection.ts';
import { findConnectedComponents } from './connected_components.ts';
import { analyzeShape } from './shape_analysis.ts';

/**
 * Detect bullet holes in grayscale image
 * @param gray - Grayscale pixel data (width * height)
 * @param width - Image width
 * @param height - Image height
 * @param params - Detection parameters
 * @returns Array of detected holes with metrics
 */
export function detectBulletHoles(
    gray: Uint8ClampedArray,
    width: number,
    height: number,
    params: DetectionParams
): DetectedHole[] {
    // Step 1: Edge detection
    const edges = sobelEdgeDetection(gray, width, height, params.edgeThreshold);

    // Step 2: Find connected components
    const blobs = findConnectedComponents(edges, width, height);

    // Step 3: Filter and analyze blobs
    const detectedHoles: DetectedHole[] = [];

    for (const blob of blobs) {
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
