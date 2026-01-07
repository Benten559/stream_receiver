/**
 * Shape Analysis
 * Calculate geometric properties of blobs
 */

import type { Blob, ShapeMetrics } from './types.ts';

/**
 * Analyze shape properties of a blob
 * @param blob - Connected component blob
 * @returns Shape metrics (area, perimeter, circularity, etc.)
 */
export function analyzeShape(blob: Blob): ShapeMetrics {
    const area = blob.pixels.length;

    // Calculate perimeter (count edge pixels)
    let perimeter = 0;
    const pixelSet = new Set(blob.pixels.map(p => `${p.x},${p.y}`));

    for (const pixel of blob.pixels) {
        const { x, y } = pixel;

        // Check 4-connected neighbors
        const neighbors = [
            `${x + 1},${y}`,
            `${x - 1},${y}`,
            `${x},${y + 1}`,
            `${x},${y - 1}`,
        ];

        // If any neighbor is not in blob, this is a perimeter pixel
        if (neighbors.some(n => !pixelSet.has(n))) {
            perimeter++;
        }
    }

    // Circularity: 4π * Area / Perimeter² (1.0 = perfect circle)
    const circularity = perimeter > 0
        ? (4 * Math.PI * area) / (perimeter * perimeter)
        : 0;

    // Compactness: Area / Bounding Box Area
    const boundingBoxArea = (blob.maxX - blob.minX + 1) * (blob.maxY - blob.minY + 1);
    const compactness = boundingBoxArea > 0
        ? area / boundingBoxArea
        : 0;

    // Center of mass
    let centerX = 0;
    let centerY = 0;
    for (const pixel of blob.pixels) {
        centerX += pixel.x;
        centerY += pixel.y;
    }
    centerX /= area;
    centerY /= area;

    // Approximate radius from area (assuming circle)
    const radius = Math.sqrt(area / Math.PI);

    return {
        area,
        perimeter,
        circularity,
        compactness,
        centerX,
        centerY,
        radius,
    };
}
