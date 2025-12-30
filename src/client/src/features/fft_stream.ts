/**
 * FFT Stream Feature
 * Displays the 2D FFT (Fast Fourier Transform) magnitude spectrum of the image
 */

import FFT from 'webfft';
import type { Feature, FeatureProcessor } from '../types/streaming.types.js';

/**
 * Convert ImageData to grayscale array
 */
function imageDataToGrayscale(imageData: ImageData): number[] {
  const grayscale: number[] = [];
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Convert RGB to grayscale using luminance formula
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    grayscale.push(gray);
  }

  return grayscale;
}

/**
 * Find next power of 2 for FFT
 */
function nextPowerOf2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

/**
 * Pad array to target size with zeros
 */
function padArray(arr: number[], width: number, height: number, targetSize: number): number[] {
  const padded = new Array(targetSize * targetSize).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      padded[y * targetSize + x] = arr[y * width + x];
    }
  }

  return padded;
}

/**
 * Perform 2D FFT and compute magnitude spectrum using webfft
 */
function compute2DFFT(grayscaleData: number[], width: number, height: number): ImageData {
  // Find next power of 2 for FFT
  const size = nextPowerOf2(Math.max(width, height));

  // Pad the image to square power-of-2 dimensions
  const paddedData = padArray(grayscaleData, width, height, size);

  // Create FFT instance for the given size
  const fft = new FFT(size);

  // Temporary storage for FFT results
  const fftResult: Float32Array[] = [];

  // Perform FFT on each row
  for (let y = 0; y < size; y++) {
    const row = paddedData.slice(y * size, (y + 1) * size);

    // webfft expects interleaved complex array (real, imag, real, imag, ...)
    const input = new Float32Array(size * 2);
    for (let i = 0; i < size; i++) {
      input[i * 2] = row[i] ?? 0;     // Real part
      input[i * 2 + 1] = 0;           // Imaginary part (zero)
    }

    // Perform FFT - returns interleaved complex array
    const output = fft.fft(input);
    fftResult.push(output);
  }

  // Transpose and perform FFT on columns
  const transposed: Float32Array[] = [];
  for (let x = 0; x < size; x++) {
    const col = new Float32Array(size * 2);

    // Extract column from FFT results
    for (let y = 0; y < size; y++) {
      col[y * 2] = fftResult[y]?.[x * 2] ?? 0;         // Real part
      col[y * 2 + 1] = fftResult[y]?.[x * 2 + 1] ?? 0; // Imaginary part
    }

    // Perform FFT on column
    const output = fft.fft(col);
    transposed.push(output);
  }

  // Compute magnitude spectrum and apply FFT shift (move DC to center)
  const magnitude = new Array(size * size).fill(0);
  let maxMagnitude = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const real = transposed[x]?.[y * 2] ?? 0;
      const imag = transposed[x]?.[y * 2 + 1] ?? 0;
      const mag = Math.sqrt(real * real + imag * imag);

      // FFT shift: move DC component to center
      const shiftedY = (y + size / 2) % size;
      const shiftedX = (x + size / 2) % size;

      magnitude[shiftedY * size + shiftedX] = mag;
      maxMagnitude = Math.max(maxMagnitude, mag);
    }
  }

  // Convert magnitude to ImageData with log scaling for better visibility
  const imageData = new ImageData(size, size);
  const data = imageData.data;

  for (let i = 0; i < magnitude.length; i++) {
    // Log scale for better dynamic range visualization
    const normalized = Math.log(1 + magnitude[i]) / Math.log(1 + maxMagnitude);
    const value = Math.floor(normalized * 255);

    const pixelIndex = i * 4;
    data[pixelIndex] = value;      // R
    data[pixelIndex + 1] = value;  // G
    data[pixelIndex + 2] = value;  // B
    data[pixelIndex + 3] = 255;    // A
  }

  return imageData;
}

/**
 * FFT feature processor
 */
const fftProcessor: FeatureProcessor = (
  sourceImageData: ImageData,
  outputCanvas: HTMLCanvasElement
): void => {
  const ctx = outputCanvas.getContext('2d');

  if (!ctx) {
    console.error('Failed to get 2D context for FFT canvas');
    return;
  }

  try {
    // Convert to grayscale
    const grayscale = imageDataToGrayscale(sourceImageData);

    // Compute 2D FFT
    const fftImageData = compute2DFFT(
      grayscale,
      sourceImageData.width,
      sourceImageData.height
    );

    // Resize canvas to match FFT output size
    if (outputCanvas.width !== fftImageData.width || outputCanvas.height !== fftImageData.height) {
      outputCanvas.width = fftImageData.width;
      outputCanvas.height = fftImageData.height;
    }

    // Draw FFT magnitude spectrum
    ctx.putImageData(fftImageData, 0, 0);
  } catch (error) {
    console.error('FFT processing failed:', error);
  }
};

/**
 * FFT feature definition
 */
export const fftFeature: Feature = {
  id: 'fft',
  name: 'FFT Spectrum',
  description: 'Shows the 2D FFT magnitude spectrum of the image',
  process: fftProcessor,
  enabled: false,
};
