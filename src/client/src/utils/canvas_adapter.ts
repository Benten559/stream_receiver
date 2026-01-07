/**
 * Canvas Image Adapter
 * Converts browser Canvas ImageData to grayscale arrays for CV algorithms
 */

/**
 * Convert Canvas ImageData to grayscale
 * @param imageData - Canvas ImageData object (RGBA format)
 * @returns Grayscale pixel array (width * height)
 */
export function canvasToGrayscale(imageData: ImageData): Uint8ClampedArray {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data; // RGBA format: [R, G, B, A, R, G, B, A, ...]

    // Convert to grayscale using standard RGB weights
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < width * height; i++) {
        const r = data[i * 4] ?? 0;
        const g = data[i * 4 + 1] ?? 0;
        const b = data[i * 4 + 2] ?? 0;
        // Standard grayscale conversion: 0.299*R + 0.587*G + 0.114*B
        gray[i] = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
    }

    return gray;
}
