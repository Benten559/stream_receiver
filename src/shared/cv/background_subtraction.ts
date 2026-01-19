/**
 * Background Subtraction for Bullet Hole Detection
 * Detects changes between reference frame and current frame
 * Target-agnostic approach that works with any background pattern
 */

/**
 * Compute absolute difference between two grayscale images
 * @param current - Current frame
 * @param reference - Reference/background frame
 * @param width - Image width
 * @param height - Image height
 * @returns Absolute difference image
 */
export function computeDifference(
  current: Uint8Array | Uint8ClampedArray,
  reference: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const diff = new Uint8Array(width * height);

  for (let i = 0; i < current.length; i++) {
    const curr = current[i] ?? 0;
    const ref = reference[i] ?? 0;
    diff[i] = Math.abs(curr - ref);
  }

  return diff;
}

/**
 * Apply threshold to difference image to create binary mask
 * @param diff - Difference image
 * @param threshold - Minimum change to consider significant (0-255)
 * @returns Binary mask (0 or 255)
 */
export function thresholdDifference(
  diff: Uint8Array,
  threshold: number
): Uint8Array {
  const mask = new Uint8Array(diff.length);

  for (let i = 0; i < diff.length; i++) {
    mask[i] = (diff[i] ?? 0) > threshold ? 255 : 0;
  }

  return mask;
}

/**
 * Apply morphological operations to clean up noise
 * Simple erosion followed by dilation (opening operation)
 * Removes small noise while preserving larger features
 */
export function morphologicalClean(
  mask: Uint8Array,
  width: number,
  height: number,
  kernelSize: number = 3
): Uint8Array {
  // Erosion - removes small noise
  const eroded = erode(mask, width, height, kernelSize);

  // Dilation - restores size of remaining features
  const cleaned = dilate(eroded, width, height, kernelSize);

  return cleaned;
}

/**
 * Erosion operation
 */
function erode(
  mask: Uint8Array,
  width: number,
  height: number,
  kernelSize: number
): Uint8Array {
  const result = new Uint8Array(mask.length);
  const half = Math.floor(kernelSize / 2);

  for (let y = half; y < height - half; y++) {
    for (let x = half; x < width - half; x++) {
      let minVal = 255;

      // Check kernel neighborhood
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const val = mask[idx] ?? 0;
          if (val < minVal) minVal = val;
        }
      }

      result[y * width + x] = minVal;
    }
  }

  return result;
}

/**
 * Dilation operation
 */
function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  kernelSize: number
): Uint8Array {
  const result = new Uint8Array(mask.length);
  const half = Math.floor(kernelSize / 2);

  for (let y = half; y < height - half; y++) {
    for (let x = half; x < width - half; x++) {
      let maxVal = 0;

      // Check kernel neighborhood
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const val = mask[idx] ?? 0;
          if (val > maxVal) maxVal = val;
        }
      }

      result[y * width + x] = maxVal;
    }
  }

  return result;
}

/**
 * Full background subtraction pipeline
 * @param current - Current frame
 * @param reference - Reference/background frame
 * @param width - Image width
 * @param height - Image height
 * @param threshold - Difference threshold (default: 20)
 * @param cleanNoise - Apply morphological cleaning (default: true)
 * @returns Binary mask of changes
 */
export function backgroundSubtraction(
  current: Uint8Array | Uint8ClampedArray,
  reference: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 20,
  cleanNoise: boolean = true
): Uint8Array {
  // 1. Compute difference
  const diff = computeDifference(current, reference, width, height);

  // 2. Threshold to binary mask
  const mask = thresholdDifference(diff, threshold);

  // 3. Clean noise (optional)
  if (cleanNoise) {
    return morphologicalClean(mask, width, height, 3);
  }

  return mask;
}
