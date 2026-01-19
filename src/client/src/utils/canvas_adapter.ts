/**
 * Canvas Image Adapter
 * Converts browser Canvas ImageData to OpenCV.js Mat objects for CV algorithms
 */

// OpenCV types global
declare const cv: any;

/**
 * Convert Canvas ImageData to OpenCV grayscale Mat (FAST - uses OpenCV.js)
 * @param imageData - Canvas ImageData object (RGBA format)
 * @returns OpenCV Mat (grayscale, CV_8UC1)
 */
export function canvasToGrayscaleMat(imageData: ImageData): any {
    if (typeof cv === 'undefined') {
        throw new Error('OpenCV.js not loaded');
    }

    // Create RGBA Mat from ImageData (zero-copy)
    const src = cv.matFromImageData(imageData);

    // Convert RGBA to grayscale using OpenCV (MUCH faster than JS loop)
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Clean up source
    src.delete();

    return gray;
}

/**
 * Convert Canvas ImageData to grayscale array (LEGACY - for compatibility)
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

/**
 * Downscale grayscale Mat using OpenCV (FAST - uses optimized resize)
 * @param src - Source grayscale Mat
 * @param scale - Downscale factor (2 = half size, 4 = quarter size)
 * @returns Downscaled Mat (caller must delete!)
 */
export function downscaleMat(src: any, scale: number): any {
    if (typeof cv === 'undefined') {
        throw new Error('OpenCV.js not loaded');
    }

    if (scale <= 1) {
        // No downscaling - return clone
        return src.clone();
    }

    const newWidth = Math.floor(src.cols / scale);
    const newHeight = Math.floor(src.rows / scale);
    const dsize = new cv.Size(newWidth, newHeight);
    const dst = new cv.Mat();

    // Use INTER_AREA for downscaling (best quality for reduction)
    cv.resize(src, dst, dsize, 0, 0, cv.INTER_AREA);

    return dst;
}

/**
 * Downscale grayscale image by averaging blocks of pixels (LEGACY)
 * MASSIVE performance boost: 4x downscale = 16x fewer pixels to process!
 * @param gray - Source grayscale image
 * @param width - Source width
 * @param height - Source height
 * @param scale - Downscale factor (2 = half size, 4 = quarter size)
 * @returns {data, width, height} - Downscaled image and dimensions
 */
export function downscaleGrayscale(
    gray: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    scale: number
): { data: Uint8ClampedArray; width: number; height: number } {
    if (scale <= 1) {
        // No downscaling
        return {
            data: gray instanceof Uint8ClampedArray ? gray : new Uint8ClampedArray(gray),
            width,
            height,
        };
    }

    const newWidth = Math.floor(width / scale);
    const newHeight = Math.floor(height / scale);
    const downscaled = new Uint8ClampedArray(newWidth * newHeight);

    // Average each block of pixels
    for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
            let sum = 0;
            let count = 0;

            // Sample block in source image
            for (let dy = 0; dy < scale; dy++) {
                for (let dx = 0; dx < scale; dx++) {
                    const sx = x * scale + dx;
                    const sy = y * scale + dy;
                    if (sx < width && sy < height) {
                        sum += gray[sy * width + sx] ?? 0;
                        count++;
                    }
                }
            }

            downscaled[y * newWidth + x] = Math.floor(sum / count);
        }
    }

    return { data: downscaled, width: newWidth, height: newHeight };
}
