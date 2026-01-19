/**
 * Advanced blob detection using Laplacian of Gaussian (LoG)
 * Detects both dark and light circular blobs (bullet holes)
 */

/**
 * Apply Gaussian blur to grayscale image
 * Uses separable filter for performance
 */
export function gaussianBlur(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  sigma: number = 1.5
): Uint8Array {
  // Generate 1D Gaussian kernel
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1; // 3-sigma rule
  const kernel = new Float32Array(kernelSize);
  const center = Math.floor(kernelSize / 2);

  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - center;
    const value = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = value;
    sum += value;
  }

  // Normalize kernel
  for (let i = 0; i < kernelSize; i++) {
    const value = kernel[i];
    if (value !== undefined) {
      kernel[i] = value / sum;
    }
  }

  // Horizontal pass
  const temp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = 0; k < kernelSize; k++) {
        const kx = x + k - center;
        if (kx >= 0 && kx < width) {
          const grayVal = gray[y * width + kx];
          const kernelVal = kernel[k];
          if (grayVal !== undefined && kernelVal !== undefined) {
            value += grayVal * kernelVal;
          }
        }
      }
      temp[y * width + x] = Math.round(value);
    }
  }

  // Vertical pass
  const blurred = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = 0; k < kernelSize; k++) {
        const ky = y + k - center;
        if (ky >= 0 && ky < height) {
          const tempVal = temp[ky * width + x];
          const kernelVal = kernel[k];
          if (tempVal !== undefined && kernelVal !== undefined) {
            value += tempVal * kernelVal;
          }
        }
      }
      blurred[y * width + x] = Math.round(value);
    }
  }

  return blurred;
}

/**
 * Apply Laplacian operator (2nd derivative)
 * Detects regions of rapid intensity change (blobs)
 */
export function applyLaplacian(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  // Laplacian kernel (approximation)
  // [0  1  0]
  // [1 -4  1]
  // [0  1  0]

  const laplacian = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = gray[idx]!;
      const top = gray[(y - 1) * width + x]!;
      const bottom = gray[(y + 1) * width + x]!;
      const left = gray[y * width + (x - 1)]!;
      const right = gray[y * width + (x + 1)]!;

      // Laplacian response (can be negative or positive)
      laplacian[idx] = top + bottom + left + right - 4 * center;
    }
  }

  return laplacian;
}

/**
 * Laplacian of Gaussian blob detection
 * Returns binary mask where blobs are detected
 */
export function laplacianOfGaussian(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  sigma: number = 1.5,
  threshold: number = 10
): Uint8Array {
  // 1. Gaussian blur (noise reduction)
  const blurred = gaussianBlur(gray, width, height, sigma);

  // 2. Laplacian (blob detection)
  const laplacian = applyLaplacian(blurred, width, height);

  // 3. Threshold both positive and negative responses
  const blobMask = new Uint8Array(width * height);
  for (let i = 0; i < laplacian.length; i++) {
    const absResponse = Math.abs(laplacian[i]!);
    blobMask[i] = absResponse > threshold ? 255 : 0;
  }

  return blobMask;
}

/**
 * Local contrast enhancement (CLAHE-like)
 * Improves detection of low-contrast holes
 */
export function contrastEnhancement(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  tileSize: number = 32
): Uint8Array {
  const enhanced = new Uint8Array(width * height);

  // Process image in tiles
  for (let ty = 0; ty < height; ty += tileSize) {
    for (let tx = 0; tx < width; tx += tileSize) {
      const tileWidth = Math.min(tileSize, width - tx);
      const tileHeight = Math.min(tileSize, height - ty);

      // Find min/max in this tile
      let min = 255;
      let max = 0;
      for (let y = ty; y < ty + tileHeight; y++) {
        for (let x = tx; x < tx + tileWidth; x++) {
          const val = gray[y * width + x]!;
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }

      // Normalize tile to full 0-255 range
      const range = max - min;
      const scale = range > 0 ? 255 / range : 1;

      for (let y = ty; y < ty + tileHeight; y++) {
        for (let x = tx; x < tx + tileWidth; x++) {
          const idx = y * width + x;
          const val = gray[idx]!;
          enhanced[idx] = Math.round((val - min) * scale);
        }
      }
    }
  }

  return enhanced;
}

/**
 * Deduplicate overlapping blobs from multiple detection methods
 */
export function deduplicateBlobs(
  blobs: Array<{ x: number; y: number; size: number }>,
  distanceThreshold: number = 15
): Array<{ x: number; y: number; size: number }> {
  if (blobs.length === 0) return [];

  const unique: Array<{ x: number; y: number; size: number }> = [];
  const used = new Set<number>();

  // Sort by size (larger blobs first - likely more reliable)
  const sorted = [...blobs].sort((a, b) => b.size - a.size);

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;

    const blob = sorted[i]!;
    unique.push(blob);
    used.add(i);

    // Mark nearby blobs as duplicates
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;

      const other = sorted[j]!;
      const dx = blob.x - other.x;
      const dy = blob.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < distanceThreshold) {
        used.add(j);
      }
    }
  }

  return unique;
}
