/**
 * Edge Detection Algorithms
 * Sobel operator for gradient-based edge detection
 */

/**
 * Apply Sobel edge detection to grayscale image
 * @param gray - Grayscale pixel data (width * height)
 * @param width - Image width
 * @param height - Image height
 * @param threshold - Edge magnitude threshold (0-255)
 * @returns Binary edge map (0 or 255)
 */
export function sobelEdgeDetection(
    gray: Uint8ClampedArray,
    width: number,
    height: number,
    threshold: number
): Uint8ClampedArray {
    // Sobel kernels for horizontal and vertical gradients
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    // Edge magnitude array
    const edges = new Uint8ClampedArray(width * height);

    // Apply Sobel operator (skip borders)
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let gx = 0;
            let gy = 0;

            // 3x3 convolution
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = (y + ky) * width + (x + kx);
                    const kernelIdx = (ky + 1) * 3 + (kx + 1);
                    gx += (gray[idx] ?? 0) * (sobelX[kernelIdx] ?? 0);
                    gy += (gray[idx] ?? 0) * (sobelY[kernelIdx] ?? 0);
                }
            }

            // Gradient magnitude
            const magnitude = Math.sqrt(gx * gx + gy * gy);
            edges[y * width + x] = magnitude > threshold ? 255 : 0;
        }
    }

    return edges;
}
