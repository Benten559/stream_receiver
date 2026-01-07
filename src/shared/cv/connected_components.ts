/**
 * Connected Components Analysis
 * Flood fill algorithm to find connected regions in binary images
 */

import type { Blob, Point } from './types.ts';

/**
 * Find all connected components in binary edge image
 * @param edges - Binary edge map (0 or 255)
 * @param width - Image width
 * @param height - Image height
 * @returns Array of blobs (connected components)
 */
export function findConnectedComponents(
    edges: Uint8ClampedArray,
    width: number,
    height: number
): Blob[] {
    const visited = new Uint8Array(width * height);
    const blobs: Blob[] = [];

    /**
     * Flood fill from a seed point
     */
    function floodFill(startX: number, startY: number): Blob | null {
        const stack: Point[] = [{ x: startX, y: startY }];
        const blob: Blob = {
            pixels: [],
            minX: startX,
            maxX: startX,
            minY: startY,
            maxY: startY,
        };

        while (stack.length > 0) {
            const { x, y } = stack.pop()!;

            // Bounds check
            if (x < 0 || x >= width || y < 0 || y >= height) {
                continue;
            }

            const idx = y * width + x;

            // Skip if already visited or not an edge
            if (visited[idx] || !edges[idx]) {
                continue;
            }

            // Mark as visited
            visited[idx] = 1;

            // Add to blob
            blob.pixels.push({ x, y });

            // Update bounding box
            blob.minX = Math.min(blob.minX, x);
            blob.maxX = Math.max(blob.maxX, x);
            blob.minY = Math.min(blob.minY, y);
            blob.maxY = Math.max(blob.maxY, y);

            // Add 4-connected neighbors
            stack.push({ x: x + 1, y });
            stack.push({ x: x - 1, y });
            stack.push({ x, y: y + 1 });
            stack.push({ x, y: y - 1 });
        }

        return blob.pixels.length > 0 ? blob : null;
    }

    // Find all connected components
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (edges[idx] && !visited[idx]) {
                const blob = floodFill(x, y);
                if (blob) {
                    blobs.push(blob);
                }
            }
        }
    }

    return blobs;
}
