/**
 * Bullet Hole Detection Feature
 *
 * Detects circular bullet holes in target images using shared CV algorithms:
 * 1. Sobel Edge Detection - Fast edge detection
 * 2. Connected Components - Flood fill to find blobs
 * 3. Shape Analysis - Circularity and compactness filtering
 *
 * Now uses shared cross-platform CV modules for consistency with Deno notebooks.
 */

import type { Feature, FeatureProcessor, FeatureContext } from '../types/streaming.types.js';
import type { DetectedMarker } from './fiducial_detection.js';

// Shared CV algorithms and types
import type { DetectedHole as SharedDetectedHole, DetectionParams } from '../../../shared/cv/types.ts';
import {
  detectBulletHoles,
  detectBulletHolesCV,
  isOpenCVReady,
  sobelEdgeDetection,
  findConnectedComponents,
  analyzeShape
} from '../../../shared/cv/index.ts';
import {
  canvasToGrayscale,
  canvasToGrayscaleMat,
  downscaleGrayscale,
  downscaleMat
} from '../utils/canvas_adapter.ts';

// OpenCV types global
declare const cv: any;

/**
 * Detected bullet hole (re-export shared type for convenience)
 */
type DetectedHole = SharedDetectedHole;

/**
 * Tracked hole with temporal persistence
 */
interface TrackedHole {
  id: number;
  center: { x: number; y: number };
  radius: number;
  confidence: number; // Smoothed over time
  framesSeen: number; // How many frames this hole has been detected
  framesNotSeen: number; // Consecutive frames without detection
  lastSeen: number; // Frame number when last detected
  temporalClusterCount: number; // How many times detected in spatial-temporal window
}

/**
 * Cached fiducial state for ROI persistence
 */
interface CachedFiducialState {
  roi: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    corners: { x: number; y: number }[];
    exclusionZones: ExclusionZone[];
  };
  lastSeenFrame: number;
  markerCount: number; // How many markers were used
}

/**
 * Detection state (module-level persistence)
 */
interface DetectionState {
  lastFrameTime: number;
  frameCount: number;
  fps: number;
  trackedHoles: TrackedHole[]; // Persistent hole tracking
  nextHoleId: number; // ID counter for new holes
  totalFrames: number; // Total frames processed
  detectionHistory: DetectedHole[][]; // Sliding window of last N frames
  historyWindowSize: number; // Size of temporal window
  cachedFiducials: CachedFiducialState | null; // Persistent fiducial ROI
  fiducialPersistenceFrames: number; // How long to keep cached fiducials
  referenceFrame: Uint8Array | Uint8ClampedArray | null; // Reference frame for background subtraction
  latestSourceImage: ImageData | null; // Latest source image for reference capture
  skipCounter: number; // Frame skip counter for performance
  lastProcessedHoles: TrackedHole[]; // Last processed holes (for skipped frames)
  // Scale calibration from fiducials
  pixelsPerMM: number | null; // Pixels per millimeter (from 150mm fiducials)
  calibratedMinHoleSize: number | null; // Min hole size in pixels (calibrated from scale)
  calibratedMaxHoleSize: number | null; // Max hole size in pixels (calibrated from scale)
}

// Module-level state
let state: DetectionState | null = null;

// Detection parameters (tunable)
const PARAMS: DetectionParams & {
  // Additional browser-specific tracking parameters
  matchDistanceThreshold: number;
  minFramesToConfirm: number;
  maxFramesNotSeen: number;
  confidenceSmoothingFactor: number;
  debugMode: boolean;
  debugShowRawBlobs: boolean;
  // Temporal window parameters
  temporalWindowSize: number;
  temporalMatchDistance: number;
  temporalConfidenceBoost: number;
  minTemporalClustersForBoost: number;
  // Fiducial persistence parameters
  fiducialPersistenceFrames: number;
  // Performance parameters
  processingScale: number;
  frameSkip: number;
} = {
  // Core CV parameters (shared)
  edgeThreshold: 50,
  minBlobSize: 5, // Reduced from 10 to catch smaller holes
  maxBlobSize: 5000, // Increased from 2000 for larger potential detections
  minCircularity: 0.25, // Reduced from 0.4 - holes at angles aren't perfectly circular
  minCompactness: 0.2, // Reduced from 0.3 - accept less compact shapes

  // Advanced detection (NEW - multi-method detection)
  useContrastEnhancement: false, // DISABLED by default - enable in UI if needed
  contrastTileSize: 32, // Tile size for local contrast normalization
  useLoGDetection: false, // DISABLED by default - enable in UI if needed
  logSigma: 1.5, // LoG Gaussian blur sigma
  logThreshold: 10, // LoG response threshold

  // Background Subtraction (BEST method - target agnostic)
  useBackgroundSubtraction: true, // Enable by default when reference captured
  differenceThreshold: 15, // Reduced from 20 - more sensitive to smaller changes
  cleanNoise: false, // Apply morphological noise cleaning (DISABLED for performance - 5M ops/frame!)

  // Browser-specific temporal tracking parameters
  matchDistanceThreshold: 20,
  minFramesToConfirm: 1, // Reduced from 2 (BG sub is already accurate)
  maxFramesNotSeen: 3, // Reduced from 5 for faster cleanup
  confidenceSmoothingFactor: 0.3,

  // Temporal window parameters
  temporalWindowSize: 3, // Keep last 3 frames in history (reduced from 5 for performance)
  temporalMatchDistance: 25, // Max distance for temporal clustering
  temporalConfidenceBoost: 15, // Confidence boost per temporal cluster
  minTemporalClustersForBoost: 2, // Min clusters needed for boost (reduced from 3)

  // Fiducial persistence
  fiducialPersistenceFrames: 10, // Keep ROI for 10 frames without fiducials

  // PERFORMANCE CRITICAL SETTINGS
  processingScale: 4, // Downscale factor (4 = 1/4 size = 16x fewer pixels! 1920x1080 → 480x270)
  frameSkip: 0, // Process every Nth frame (0 = process all, 1 = every other, 2 = every 3rd)

  // Debug visualization
  debugMode: false, // DISABLED for performance
  debugShowRawBlobs: false, // DISABLED for performance
};

/**
 * Debug info for blob detection
 */
interface BlobDebugInfo {
  rawBlobCount: number;
  afterROICount: number;
  afterExclusionCount: number;
  rawBlobs: { x: number; y: number; radius: number }[];
}

let lastDebugInfo: BlobDebugInfo | null = null;

/**
 * Get last debug info
 */
export function getLastDebugInfo(): BlobDebugInfo | null {
  return lastDebugInfo;
}

/**
 * Detect blobs (bullet holes) using OpenCV.js optimized pipeline (FAST!)
 * 5-10x faster than custom JavaScript implementation
 */
function detectBlobs(
  imageData: ImageData,
  roi?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    corners: { x: number; y: number }[];
    exclusionZones: ExclusionZone[];
  }
): DetectedHole[] {
  // Fallback to legacy implementation if OpenCV not ready
  if (!isOpenCVReady()) {
    console.warn('[BlobDetect] OpenCV.js not ready - using legacy JS implementation (slow)');
    return detectBlobsLegacy(imageData, roi);
  }

  let grayMat: any = null;
  let grayDownscaled: any = null;
  let refMat: any = null;
  let refDownscaled: any = null;

  try {
    const width = imageData.width;
    const height = imageData.height;
    let offsetX = 0;
    let offsetY = 0;

    // Create ROI-cropped ImageData if specified
    let processImageData = imageData;
    if (roi) {
      console.log(
        `[BlobDetect-CV] ROI active: (${roi.minX},${roi.minY}) to (${roi.maxX},${roi.maxY}), ${roi.exclusionZones.length} exclusion zones`
      );
      const roiWidth = roi.maxX - roi.minX;
      const roiHeight = roi.maxY - roi.minY;

      const roiData = new Uint8ClampedArray(roiWidth * roiHeight * 4);
      for (let y = 0; y < roiHeight; y++) {
        for (let x = 0; x < roiWidth; x++) {
          const srcIdx = ((roi.minY + y) * width + (roi.minX + x)) * 4;
          const dstIdx = (y * roiWidth + x) * 4;
          roiData[dstIdx] = imageData.data[srcIdx] ?? 0;
          roiData[dstIdx + 1] = imageData.data[srcIdx + 1] ?? 0;
          roiData[dstIdx + 2] = imageData.data[srcIdx + 2] ?? 0;
          roiData[dstIdx + 3] = imageData.data[srcIdx + 3] ?? 255;
        }
      }
      processImageData = new ImageData(roiData, roiWidth, roiHeight);
      offsetX = roi.minX;
      offsetY = roi.minY;
    } else {
      console.log(`[BlobDetect-CV] No ROI - processing full frame ${width}x${height}`);
    }

    // 1. Convert to grayscale Mat (FAST!)
    grayMat = canvasToGrayscaleMat(processImageData);

    // 2. Downscale for performance (FAST with OpenCV resize!)
    const scale = PARAMS.processingScale ?? 1;
    grayDownscaled = downscaleMat(grayMat, scale);

    console.log(
      `[BlobDetect-CV] Downscaled ${grayMat.cols}x${grayMat.rows} → ${grayDownscaled.cols}x${grayDownscaled.rows} (${scale}x)`
    );

    // 3. Prepare reference frame Mat if using background subtraction
    if (state?.referenceFrame && PARAMS.useBackgroundSubtraction) {
      try {
        // Reference frame is stored at full resolution, need to crop to match ROI
        const refWidth = width;  // Full frame width
        const refHeight = height;  // Full frame height

        // Create full-resolution reference Mat
        const refFull = new cv.Mat(refHeight, refWidth, cv.CV_8UC1);
        for (let i = 0; i < state.referenceFrame.length && i < refFull.data.length; i++) {
          refFull.data[i] = state.referenceFrame[i];
        }

        // If ROI is active, crop reference to match
        if (roi) {
          const roiWidth = roi.maxX - roi.minX;
          const roiHeight = roi.maxY - roi.minY;
          const roiRect = new cv.Rect(roi.minX, roi.minY, roiWidth, roiHeight);

          refMat = refFull.roi(roiRect).clone();  // Clone to own the memory
          refFull.delete();  // Clean up full frame
        } else {
          refMat = refFull;  // Use full frame
        }

        // Downscale reference to match processing scale
        refDownscaled = downscaleMat(refMat, scale);

        console.log(
          `[BlobDetect-CV] Reference frame prepared: ${refMat.cols}x${refMat.rows} → ${refDownscaled.cols}x${refDownscaled.rows}`
        );
      } catch (e) {
        console.error('[BlobDetect-CV] Failed to create reference Mat:', e);
        if (refMat) refMat.delete();
        refMat = null;
        refDownscaled = null;
      }
    }

    // 4. Apply OpenCV optimized detection pipeline (FAST!)
    const detectionParams = { ...PARAMS };
    if (state && state.calibratedMinHoleSize !== null && state.calibratedMaxHoleSize !== null) {
      detectionParams.minBlobSize = state.calibratedMinHoleSize;
      detectionParams.maxBlobSize = state.calibratedMaxHoleSize;
      console.log(
        `[BlobDetect-CV] Using calibrated sizes: ${state.calibratedMinHoleSize}-${state.calibratedMaxHoleSize} px²`
      );
    }

    const detectedHoles = detectBulletHolesCV(
      grayDownscaled,
      detectionParams,
      refDownscaled
    );

    console.log(`[BlobDetect-CV] OpenCV pipeline detected ${detectedHoles.length} holes`);

    // 5. Scale up and filter holes
    const filteredHoles: DetectedHole[] = [];

    for (const hole of detectedHoles) {
      // Scale up from downscaled resolution
      const scaledCenterX = hole.center.x * scale;
      const scaledCenterY = hole.center.y * scale;
      const scaledRadius = hole.radius * scale;

      // Adjust back to full frame coordinates
      const centerX = scaledCenterX + offsetX;
      const centerY = scaledCenterY + offsetY;

      // Skip if outside ROI quadrilateral
      if (roi && !isPointInQuad(centerX, centerY, roi.corners)) {
        continue;
      }

      // Skip if inside exclusion zone (fiducial marker)
      if (roi && isInExclusionZone(centerX, centerY, roi.exclusionZones)) {
        continue;
      }

      filteredHoles.push({
        center: { x: centerX, y: centerY },
        radius: scaledRadius,
        confidence: hole.confidence,
        metrics: hole.metrics,
      });
    }

    console.log(`[BlobDetect-CV] After filtering: ${filteredHoles.length} holes`);

    return filteredHoles;
  } catch (error) {
    console.error('[BlobDetect-CV] OpenCV detection failed:', error);
    return [];
  } finally {
    // CRITICAL: Clean up Mats to prevent memory leaks!
    if (grayMat) grayMat.delete();
    if (grayDownscaled) grayDownscaled.delete();
    if (refMat) refMat.delete();
    if (refDownscaled) refDownscaled.delete();
  }
}

/**
 * Legacy JavaScript blob detection (SLOW - fallback only)
 * Used when OpenCV.js is not available
 */
function detectBlobsLegacy(
  imageData: ImageData,
  roi?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    corners: { x: number; y: number }[];
    exclusionZones: ExclusionZone[];
  }
): DetectedHole[] {
  try {
    const width = imageData.width;
    const height = imageData.height;
    let processImageData = imageData;
    let offsetX = 0;
    let offsetY = 0;

    if (roi) {
      const roiWidth = roi.maxX - roi.minX;
      const roiHeight = roi.maxY - roi.minY;
      const roiData = new Uint8ClampedArray(roiWidth * roiHeight * 4);
      for (let y = 0; y < roiHeight; y++) {
        for (let x = 0; x < roiWidth; x++) {
          const srcIdx = ((roi.minY + y) * width + (roi.minX + x)) * 4;
          const dstIdx = (y * roiWidth + x) * 4;
          roiData[dstIdx] = imageData.data[srcIdx] ?? 0;
          roiData[dstIdx + 1] = imageData.data[srcIdx + 1] ?? 0;
          roiData[dstIdx + 2] = imageData.data[srcIdx + 2] ?? 0;
          roiData[dstIdx + 3] = imageData.data[srcIdx + 3] ?? 255;
        }
      }
      processImageData = new ImageData(roiData, roiWidth, roiHeight);
      offsetX = roi.minX;
      offsetY = roi.minY;
    }

    const grayFull = canvasToGrayscale(processImageData);
    const scale = PARAMS.processingScale ?? 1;
    const { data: gray, width: procWidth, height: procHeight } = downscaleGrayscale(
      grayFull,
      processImageData.width,
      processImageData.height,
      scale
    );

    let referenceGray: Uint8Array | Uint8ClampedArray | undefined = undefined;
    if (state?.referenceFrame && PARAMS.useBackgroundSubtraction) {
      if (roi) {
        const refWidth = roi.maxX - roi.minX;
        const refHeight = roi.maxY - roi.minY;
        const refFull = new Uint8Array(refWidth * refHeight);
        for (let y = 0; y < refHeight; y++) {
          for (let x = 0; x < refWidth; x++) {
            const srcIdx = (roi.minY + y) * width + (roi.minX + x);
            const dstIdx = y * refWidth + x;
            refFull[dstIdx] = state.referenceFrame[srcIdx] ?? 0;
          }
        }
        const { data: refDownscaled } = downscaleGrayscale(refFull, refWidth, refHeight, scale);
        referenceGray = refDownscaled;
      } else {
        const { data: refDownscaled } = downscaleGrayscale(
          state.referenceFrame,
          width,
          height,
          scale
        );
        referenceGray = refDownscaled;
      }
    }

    const detectionParams = { ...PARAMS };
    if (state && state.calibratedMinHoleSize !== null && state.calibratedMaxHoleSize !== null) {
      detectionParams.minBlobSize = state.calibratedMinHoleSize;
      detectionParams.maxBlobSize = state.calibratedMaxHoleSize;
    }

    const detectedHoles = detectBulletHoles(
      gray,
      procWidth,
      procHeight,
      detectionParams,
      referenceGray
    );

    const filteredHoles: DetectedHole[] = [];
    for (const hole of detectedHoles) {
      const scaledCenterX = hole.center.x * scale;
      const scaledCenterY = hole.center.y * scale;
      const scaledRadius = hole.radius * scale;
      const centerX = scaledCenterX + offsetX;
      const centerY = scaledCenterY + offsetY;

      if (roi && !isPointInQuad(centerX, centerY, roi.corners)) {
        continue;
      }
      if (roi && isInExclusionZone(centerX, centerY, roi.exclusionZones)) {
        continue;
      }

      filteredHoles.push({
        center: { x: centerX, y: centerY },
        radius: scaledRadius,
        confidence: hole.confidence,
        metrics: hole.metrics,
      });
    }

    return filteredHoles;
  } catch (error) {
    console.error('[BlobDetect-Legacy] Detection failed:', error);
    return [];
  }
}

/**
 * Draw detected holes on canvas
 */
function drawDetections(
  ctx: CanvasRenderingContext2D,
  holes: TrackedHole[]
): void {
  holes.forEach((hole) => {
    const { center, radius, confidence, id } = hole;

    // Color code by confidence
    let color = '#ff8800'; // Orange - low confidence
    if (confidence > 75) {
      color = '#00ff00'; // Green - high confidence
    } else if (confidence > 50) {
      color = '#ffff00'; // Yellow - medium confidence
    }

    // Draw circle outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center crosshair
    const crossSize = 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x - crossSize, center.y);
    ctx.lineTo(center.x + crossSize, center.y);
    ctx.moveTo(center.x, center.y - crossSize);
    ctx.lineTo(center.x, center.y + crossSize);
    ctx.stroke();

    // Draw confidence label with hole ID and temporal info
    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = hole.temporalClusterCount > 0
      ? `#${id} ${confidence.toFixed(0)}% [${hole.temporalClusterCount}]`
      : `#${id} ${confidence.toFixed(0)}%`;
    ctx.fillText(label, center.x, center.y + radius + 15);
  });
}

/**
 * Draw ROI outline on canvas
 */
function drawROIOutline(
  ctx: CanvasRenderingContext2D,
  roi: { corners: { x: number; y: number }[]; exclusionZones: ExclusionZone[] }
): void {
  // Draw ROI quadrilateral
  ctx.strokeStyle = '#00ffff'; // Cyan
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]); // Dashed line
  ctx.beginPath();
  ctx.moveTo(roi.corners[0]!.x, roi.corners[0]!.y);
  for (let i = 1; i < roi.corners.length; i++) {
    ctx.lineTo(roi.corners[i]!.x, roi.corners[i]!.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]); // Reset to solid line

  // Draw exclusion zones (fiducial markers)
  if (PARAMS.debugMode) {
    ctx.strokeStyle = '#ff00ff'; // Magenta for exclusion zones
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const zone of roi.exclusionZones) {
      ctx.strokeRect(
        zone.minX,
        zone.minY,
        zone.maxX - zone.minX,
        zone.maxY - zone.minY
      );
    }
    ctx.setLineDash([]);
  }
}

/**
 * Draw status panel
 */
function drawStatusPanel(
  ctx: CanvasRenderingContext2D,
  holes: TrackedHole[],
  processingTimeMs: number,
  width: number,
  height: number,
  roiActive: boolean,
  blobsDetected: number,
  debugInfo?: BlobDebugInfo | null
): void {
  const panelWidth = 280;
  const panelHeight = PARAMS.debugMode && debugInfo ? 250 : 160;
  const padding = 10;
  const lineHeight = 18;

  // Dark background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, panelWidth, panelHeight);

  // Text styling
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = holes.length > 0 ? '#00ff00' : '#ffa500';

  let y = padding;

  // Tracked holes (confirmed)
  ctx.fillText(`Holes: ${holes.length} (confirmed)`, padding, y);
  y += lineHeight;

  // Blobs detected this frame
  ctx.fillStyle = '#00ffff';
  ctx.fillText(`Blobs: ${blobsDetected} (this frame)`, padding, y);
  y += lineHeight;

  // Processing time
  ctx.fillStyle = holes.length > 0 ? '#00ff00' : '#ffa500';
  ctx.fillText(`Processing: ${processingTimeMs.toFixed(1)}ms`, padding, y);
  y += lineHeight;

  // FPS
  const fps = state?.fps ?? 0;
  ctx.fillText(`FPS: ${fps.toFixed(1)}`, padding, y);
  y += lineHeight;

  // ROI status
  ctx.fillStyle = roiActive ? '#00ff00' : '#ff8800';
  ctx.fillText(
    `ROI: ${roiActive ? 'Active (Markers 0-3)' : 'Full Frame'}`,
    padding,
    y
  );
  y += lineHeight;

  // Frame dimensions
  ctx.fillStyle = holes.length > 0 ? '#00ff00' : '#ffa500';
  ctx.fillText(`Frame: ${width}x${height}`, padding, y);
  y += lineHeight;

  // Temporal window status
  const historySize = state?.detectionHistory.length ?? 0;
  ctx.fillStyle = '#00ffff';
  ctx.fillText(`Temporal: ${historySize}/${PARAMS.temporalWindowSize} frames`, padding, y);
  y += lineHeight;

  // Fiducial cache status
  if (state?.cachedFiducials) {
    const age = state.totalFrames - state.cachedFiducials.lastSeenFrame;
    ctx.fillStyle = age === 0 ? '#00ff00' : '#ffff00';
    ctx.fillText(`Fiducial cache: ${age}f old`, padding, y);
  } else {
    ctx.fillStyle = '#888888';
    ctx.fillText(`Fiducial cache: none`, padding, y);
  }
  y += lineHeight;

  // Reference frame status (IMPORTANT)
  const hasRef = state?.referenceFrame !== null;
  ctx.fillStyle = hasRef ? '#00ff00' : '#ff6600';
  ctx.font = hasRef ? 'bold 14px monospace' : '14px monospace';
  ctx.fillText(
    hasRef ? '✓ Reference: Active (BG Sub)' : '⚠ Reference: None',
    padding,
    y
  );
  ctx.font = '14px monospace'; // Reset font
  y += lineHeight;

  // Debug statistics (if enabled)
  if (PARAMS.debugMode && debugInfo) {
    y += 5; // Extra spacing
    ctx.fillStyle = '#ff00ff';
    ctx.fillText(`--- DEBUG PIPELINE ---`, padding, y);
    y += lineHeight;

    ctx.fillStyle = '#ff0000';
    ctx.fillText(`Raw blobs: ${debugInfo.rawBlobCount}`, padding, y);
    y += lineHeight;

    ctx.fillStyle = '#ffaa00';
    ctx.fillText(`After ROI: ${debugInfo.afterROICount}`, padding, y);
    y += lineHeight;

    ctx.fillStyle = '#ffff00';
    ctx.fillText(`After exclusion: ${debugInfo.afterExclusionCount}`, padding, y);
  }
}

function isPointInQuad(
  x: number,
  y: number,
  corners: { x: number; y: number }[]
): boolean {
  if (corners.length !== 4) return false;

  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = corners[i]!.x;
    const yi = corners[i]!.y;
    const xj = corners[j]!.x;
    const yj = corners[j]!.y;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Exclusion zone for a fiducial marker
 */
interface ExclusionZone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Calibrate scale from fiducial markers
 * Fiducials are 150mm square - use this to calculate pixels per mm
 * Then calculate appropriate min/max hole sizes based on bullet calibers
 * @param markers - Detected fiducial markers
 */
function calibrateScaleFromFiducials(markers: DetectedMarker[]): void {
  if (!state || markers.length === 0) return;

  // Calculate average marker size in pixels from all available markers
  let totalPixelSize = 0;
  let count = 0;

  for (const marker of markers) {
    if (marker.corners.length >= 4) {
      const c0 = marker.corners[0];
      const c1 = marker.corners[1];
      const c2 = marker.corners[2];
      const c3 = marker.corners[3];

      if (!c0 || !c1 || !c2 || !c3) continue;

      // Calculate marker width and height from corners
      const width1 = Math.hypot(
        c1.x - c0.x,
        c1.y - c0.y
      );
      const width2 = Math.hypot(
        c2.x - c3.x,
        c2.y - c3.y
      );
      const height1 = Math.hypot(
        c3.x - c0.x,
        c3.y - c0.y
      );
      const height2 = Math.hypot(
        c2.x - c1.x,
        c2.y - c1.y
      );

      // Average all measurements
      const avgSize = (width1 + width2 + height1 + height2) / 4;
      totalPixelSize += avgSize;
      count++;
    }
  }

  if (count === 0) return;

  const avgMarkerPixels = totalPixelSize / count;
  const fiducialSizeMM = 150; // Known physical size
  const pixelsPerMM = avgMarkerPixels / fiducialSizeMM;

  // Bullet hole sizes:
  // - Small caliber (.22): ~5.6mm diameter
  // - Medium (.380, 9mm): ~9-9.5mm diameter
  // - Large (.45): ~11.4mm diameter
  // Account for downscaling and use area (πr²)

  const scale = PARAMS.processingScale ?? 1;
  const minHoleDiameterMM = 5; // Smaller than .22 to catch damaged holes
  const maxHoleDiameterMM = 15; // Larger than .45 for ragged holes

  // Calculate pixel sizes (accounting for downscaling)
  const minHoleDiameterPixels = (minHoleDiameterMM * pixelsPerMM) / scale;
  const maxHoleDiameterPixels = (maxHoleDiameterMM * pixelsPerMM) / scale;

  // Convert diameter to area (area = π * r²)
  const minArea = Math.PI * Math.pow(minHoleDiameterPixels / 2, 2);
  const maxArea = Math.PI * Math.pow(maxHoleDiameterPixels / 2, 2);

  // Store calibration
  state.pixelsPerMM = pixelsPerMM;
  state.calibratedMinHoleSize = Math.floor(minArea);
  state.calibratedMaxHoleSize = Math.ceil(maxArea);

  console.log(
    `[Calibration] Fiducial: ${avgMarkerPixels.toFixed(1)}px = ${fiducialSizeMM}mm → ${pixelsPerMM.toFixed(2)} px/mm`
  );
  console.log(
    `[Calibration] Hole size range: ${minHoleDiameterMM}-${maxHoleDiameterMM}mm → ${state.calibratedMinHoleSize}-${state.calibratedMaxHoleSize} px² (area, after ${scale}x downscale)`
  );
}

/**
 * Get ROI (Region of Interest) from fiducial markers 0-3 in context
 * Returns bounding box and corner points, or null if markers not available
 * Now with fiducial persistence - uses cached ROI if markers temporarily lost
 *
 * Marker layout:
 * 0 (top-left) ---- 1 (top-right)
 * |                 |
 * |                 |
 * 2 (bottom-left) - 3 (bottom-right)
 */
function getTargetROI(context: Readonly<FeatureContext>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  corners: { x: number; y: number }[];
  exclusionZones: ExclusionZone[]; // Exclude marker regions
} | null {
  if (!state) return null;

  // Read markers from context (provided by fiducial detection)
  const allMarkers = context.markers as DetectedMarker[] | undefined;

  // Calibrate scale from markers if available
  if (allMarkers && allMarkers.length > 0) {
    calibrateScaleFromFiducials(allMarkers);
  }

  if (!allMarkers || allMarkers.length === 0) {
    // No markers detected - try using cached fiducials
    if (state.cachedFiducials) {
      const framesSinceLastSeen = state.totalFrames - state.cachedFiducials.lastSeenFrame;
      if (framesSinceLastSeen <= PARAMS.fiducialPersistenceFrames) {
        console.log(
          `[ROI] Using cached fiducials (${framesSinceLastSeen} frames old, ${state.cachedFiducials.markerCount} markers)`
        );
        return state.cachedFiducials.roi;
      } else {
        console.log('[ROI] Cached fiducials expired - processing full frame');
        state.cachedFiducials = null;
      }
    } else {
      console.log('[ROI] No markers in context - processing full frame');
    }
    return null;
  }

  // Filter for markers 0-3
  const markersMap = new Map<number, DetectedMarker>();
  for (const marker of allMarkers) {
    if ([0, 1, 2, 3].includes(marker.id)) {
      markersMap.set(marker.id, marker);
    }
  }

  // Need all 4 markers to define ROI
  if (markersMap.size !== 4) {
    // Try using cached fiducials if available
    if (state.cachedFiducials) {
      const framesSinceLastSeen = state.totalFrames - state.cachedFiducials.lastSeenFrame;
      if (framesSinceLastSeen <= PARAMS.fiducialPersistenceFrames) {
        console.log(
          `[ROI] Only ${markersMap.size}/4 markers - using cached fiducials (${framesSinceLastSeen} frames old)`
        );
        return state.cachedFiducials.roi;
      }
    }
    console.log(`[ROI] Only ${markersMap.size}/4 markers detected (need 0,1,2,3) - processing full frame`);
    return null;
  }

  // Get markers
  const marker0 = markersMap.get(0);
  const marker1 = markersMap.get(1);
  const marker2 = markersMap.get(2);
  const marker3 = markersMap.get(3);

  if (!marker0 || !marker1 || !marker2 || !marker3) {
    return null;
  }

  // Order corners spatially for proper quadrilateral:
  // 0 (top-left) → 1 (top-right) → 3 (bottom-right) → 2 (bottom-left)
  const corners = [
    marker0.center, // top-left
    marker1.center, // top-right
    marker3.center, // bottom-right
    marker2.center, // bottom-left
  ];

  // Calculate bounding box
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);

  // Create exclusion zones for each marker (add padding to be safe)
  const exclusionPadding = 5; // pixels of extra padding around markers
  const exclusionZones: ExclusionZone[] = [];

  for (const marker of [marker0, marker1, marker2, marker3]) {
    // Get bounding box from marker corners
    const markerXs = marker.corners.map((c) => c.x);
    const markerYs = marker.corners.map((c) => c.y);

    exclusionZones.push({
      minX: Math.floor(Math.min(...markerXs)) - exclusionPadding,
      maxX: Math.ceil(Math.max(...markerXs)) + exclusionPadding,
      minY: Math.floor(Math.min(...markerYs)) - exclusionPadding,
      maxY: Math.ceil(Math.max(...markerYs)) + exclusionPadding,
    });
  }

  const roi = {
    minX: Math.floor(Math.min(...xs)),
    maxX: Math.ceil(Math.max(...xs)),
    minY: Math.floor(Math.min(...ys)),
    maxY: Math.ceil(Math.max(...ys)),
    corners,
    exclusionZones,
  };

  // Cache this ROI for persistence if markers are lost in future frames
  if (state) {
    state.cachedFiducials = {
      roi,
      lastSeenFrame: state.totalFrames,
      markerCount: 4,
    };
  }

  return roi;
}

/**
 * Check if point is inside any exclusion zone
 */
function isInExclusionZone(
  x: number,
  y: number,
  exclusionZones: ExclusionZone[]
): boolean {
  for (const zone of exclusionZones) {
    if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate distance between two points
 */
function distance(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Analyze temporal persistence of a detection across frame history
 * Returns boosted confidence and cluster count if hole appears repeatedly in same location
 */
function analyzeTemporalPersistence(
  detection: DetectedHole,
  history: DetectedHole[][]
): { boostedConfidence: number; clusterCount: number } {
  let clusterCount = 0;

  // Count how many frames in history have a detection near this location
  for (const frameDetections of history) {
    // Limit search to prevent performance issues with many detections
    const maxSearchDetections = Math.min(frameDetections.length, 50);

    for (let i = 0; i < maxSearchDetections; i++) {
      const historicDetection = frameDetections[i];
      if (!historicDetection) break;

      const dist = distance(detection.center, historicDetection.center);
      if (dist <= PARAMS.temporalMatchDistance) {
        clusterCount++;
        break; // Only count once per frame
      }
    }
  }

  // Boost confidence if hole appears in multiple frames
  let boostedConfidence = detection.confidence;
  if (clusterCount >= PARAMS.minTemporalClustersForBoost) {
    const boost = Math.min(
      clusterCount * PARAMS.temporalConfidenceBoost,
      40 // Cap boost at 40%
    );
    boostedConfidence = Math.min(100, detection.confidence + boost);
  }

  return { boostedConfidence, clusterCount };
}

/**
 * Update tracked holes with new detections
 * Returns list of confirmed holes to display
 * Now with temporal analysis - holes appearing in same location across multiple frames get boosted confidence
 */
function updateTrackedHoles(newDetections: DetectedHole[]): TrackedHole[] {
  if (!state) {
    // Initialize state
    state = {
      lastFrameTime: performance.now(),
      frameCount: 0,
      fps: 0,
      trackedHoles: [],
      nextHoleId: 0,
      totalFrames: 0,
      detectionHistory: [],
      historyWindowSize: PARAMS.temporalWindowSize,
      cachedFiducials: null,
      fiducialPersistenceFrames: PARAMS.fiducialPersistenceFrames,
      referenceFrame: null,
      latestSourceImage: null,
      skipCounter: 0,
      lastProcessedHoles: [],
      pixelsPerMM: null,
      calibratedMinHoleSize: null,
      calibratedMaxHoleSize: null,
    };
  }

  state!.totalFrames++;
  const currentFrame = state!.totalFrames;

  // Limit detections to prevent performance issues (take top N by confidence)
  const MAX_DETECTIONS_TO_PROCESS = 100;
  const limitedDetections = newDetections.length > MAX_DETECTIONS_TO_PROCESS
    ? newDetections
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_DETECTIONS_TO_PROCESS)
    : newDetections;

  // PERFORMANCE: Skip temporal analysis entirely (expensive and not needed with BG sub)
  const shouldAnalyzeTemporal = false; // DISABLED for performance

  // Add current detections to history only if temporal analysis is enabled
  if (shouldAnalyzeTemporal) {
    state!.detectionHistory.push([...limitedDetections]);

    // Keep only the last N frames in history (sliding window)
    if (state!.detectionHistory.length > state!.historyWindowSize) {
      state!.detectionHistory.shift();
    }
  }

  const enhancedDetections = shouldAnalyzeTemporal
    ? limitedDetections.map((detection) => {
        const { boostedConfidence, clusterCount } = analyzeTemporalPersistence(
          detection,
          state!.detectionHistory.slice(0, -1) // Exclude current frame
        );

        return {
          ...detection,
          confidence: boostedConfidence,
          temporalClusterCount: clusterCount,
        };
      })
    : limitedDetections.map((detection) => ({
        ...detection,
        temporalClusterCount: 0,
      }));

  const matched = new Set<number>(); // Track which tracked holes were matched

  // Match enhanced detections with existing tracked holes
  for (const detection of enhancedDetections) {
    let bestMatch: TrackedHole | null = null;
    let bestDistance = Infinity;

    // Find closest tracked hole within threshold
    for (const tracked of state!.trackedHoles) {
      const dist = distance(detection.center, tracked.center);
      if (
        dist < PARAMS.matchDistanceThreshold &&
        dist < bestDistance
      ) {
        bestMatch = tracked;
        bestDistance = dist;
      }
    }

    if (bestMatch) {
      // Update existing tracked hole
      matched.add(bestMatch.id);

      // Smooth confidence using exponential moving average (with temporal boost)
      const alpha = PARAMS.confidenceSmoothingFactor;
      bestMatch.confidence =
        alpha * detection.confidence + (1 - alpha) * bestMatch.confidence;

      // Update position (slight smoothing)
      bestMatch.center.x = alpha * detection.center.x + (1 - alpha) * bestMatch.center.x;
      bestMatch.center.y = alpha * detection.center.y + (1 - alpha) * bestMatch.center.y;
      bestMatch.radius = alpha * detection.radius + (1 - alpha) * bestMatch.radius;

      // Update temporal cluster count
      bestMatch.temporalClusterCount = detection.temporalClusterCount;

      // Reset tracking counters
      bestMatch.framesSeen++;
      bestMatch.framesNotSeen = 0;
      bestMatch.lastSeen = currentFrame;
    } else {
      // Add new tracked hole
      state!.trackedHoles.push({
        id: state!.nextHoleId++,
        center: { ...detection.center },
        radius: detection.radius,
        confidence: detection.confidence,
        framesSeen: 1,
        framesNotSeen: 0,
        lastSeen: currentFrame,
        temporalClusterCount: detection.temporalClusterCount,
      });
    }
  }

  // Update holes that weren't matched this frame
  for (const tracked of state!.trackedHoles) {
    if (!matched.has(tracked.id)) {
      tracked.framesNotSeen++;
    }
  }

  // Remove holes that haven't been seen for too long
  // Holes with high temporal cluster counts persist longer (likely real holes)
  state!.trackedHoles = state!.trackedHoles.filter((hole) => {
    let maxFramesNotSeen = PARAMS.maxFramesNotSeen;

    // Boost persistence for holes with strong temporal evidence
    if (hole.temporalClusterCount >= PARAMS.minTemporalClustersForBoost) {
      // Allow 2x persistence for temporally confirmed holes
      maxFramesNotSeen *= 2;
    }

    return hole.framesNotSeen <= maxFramesNotSeen;
  });

  // Return only confirmed holes (seen for minimum frames)
  return state!.trackedHoles.filter(
    (hole) => hole.framesSeen >= PARAMS.minFramesToConfirm
  );
}

/**
 * Update FPS calculation
 */
function updateFPS(): void {
  if (!state) {
    // Initialize state
    state = {
      lastFrameTime: performance.now(),
      frameCount: 0,
      fps: 0,
      trackedHoles: [],
      nextHoleId: 0,
      totalFrames: 0,
      detectionHistory: [],
      historyWindowSize: PARAMS.temporalWindowSize,
      cachedFiducials: null,
      fiducialPersistenceFrames: PARAMS.fiducialPersistenceFrames,
      referenceFrame: null,
      latestSourceImage: null,
      skipCounter: 0,
      lastProcessedHoles: [],
      pixelsPerMM: null,
      calibratedMinHoleSize: null,
      calibratedMaxHoleSize: null,
    };
    return;
  }

  const now = performance.now();
  state.frameCount++;

  // Update FPS every second
  const elapsed = now - state.lastFrameTime;
  if (elapsed >= 1000) {
    state.fps = (state.frameCount * 1000) / elapsed;
    state.frameCount = 0;
    state.lastFrameTime = now;
  }
}

/**
 * Capture current frame as reference for background subtraction
 * Call this when the target is clean (no bullet holes)
 */
export function captureReferenceFrame(imageData: ImageData): void {
  if (!state) {
    console.warn('[Reference] State not initialized - run detection first');
    return;
  }

  // Convert to grayscale
  const gray = canvasToGrayscale(imageData);

  // Store as reference frame
  state.referenceFrame = gray;

  console.log(`[Reference] Captured ${imageData.width}x${imageData.height} reference frame`);
}

/**
 * Clear reference frame (go back to traditional detection)
 */
export function clearReferenceFrame(): void {
  if (state) {
    state.referenceFrame = null;
    console.log('[Reference] Cleared reference frame');
  }
}

/**
 * Check if reference frame is captured
 */
export function hasReferenceFrame(): boolean {
  return state?.referenceFrame !== null;
}

/**
 * Bullet hole detection processor with context pipeline
 */
const bulletHoleProcessor: FeatureProcessor = (
  sourceImageData: ImageData,
  sharedCanvas: HTMLCanvasElement,
  context: Readonly<FeatureContext>
): FeatureContext => {
  console.log('[PROCESSOR] Bullet hole processor called!', {
    imageSize: `${sourceImageData.width}x${sourceImageData.height}`,
    hasMarkers: !!context.markers,
    stateExists: !!state,
  });

  // Store latest source image for reference capture
  if (state) {
    state.latestSourceImage = sourceImageData;
  }

  const ctx = sharedCanvas.getContext('2d');

  if (!ctx) {
    console.error('[PROCESSOR] Failed to get 2D context');
    return {};
  }

  try {
    const startTime = performance.now();

    // 1. Get ROI from context (markers provided by fiducial detection)
    const roi = getTargetROI(context);

    // 2. PERFORMANCE: Frame skipping (process every Nth frame)
    let trackedHoles: TrackedHole[];
    let processingTime = 0;
    let currentDetections: DetectedHole[] = [];

    if (!state) {
      // Initialize state if needed
      state = {
        lastFrameTime: performance.now(),
        frameCount: 0,
        fps: 0,
        trackedHoles: [],
        nextHoleId: 0,
        totalFrames: 0,
        detectionHistory: [],
        historyWindowSize: PARAMS.temporalWindowSize,
        cachedFiducials: null,
        fiducialPersistenceFrames: PARAMS.fiducialPersistenceFrames,
        referenceFrame: null,
        latestSourceImage: sourceImageData,
        skipCounter: 0,
        lastProcessedHoles: [],
        pixelsPerMM: null,
        calibratedMinHoleSize: null,
        calibratedMaxHoleSize: null,
      };
    }

    const shouldSkip = PARAMS.frameSkip > 0 && state!.skipCounter % (PARAMS.frameSkip + 1) !== 0;
    state!.skipCounter++;

    if (shouldSkip) {
      // Reuse last processed holes (MASSIVE performance gain!)
      trackedHoles = state!.lastProcessedHoles;
      processingTime = 0; // No processing time
      console.log(`[PROCESSOR] Skipped frame ${state!.skipCounter} (frameSkip=${PARAMS.frameSkip})`);
    } else {
      // Normal processing
      // 2. Detect blobs (bullet holes) using shared CV modules
      currentDetections = detectBlobs(sourceImageData, roi ?? undefined);

      // 3. Update temporal tracking and get confirmed holes
      trackedHoles = updateTrackedHoles(currentDetections);

      // Cache for skipped frames
      state!.lastProcessedHoles = trackedHoles;

      processingTime = performance.now() - startTime;
    }

    // Update FPS
    updateFPS();

    // 4. Render visualization (on top of fiducial layer)
    // NOTE: Don't call putImageData - fiducial detection already drew the base image

    // Debug visualization disabled (debugMode: false in params)

    // Draw ROI outline if active
    if (roi) {
      drawROIOutline(ctx, roi);
    }

    // Draw detected holes (green circles - after all filtering)
    drawDetections(ctx, trackedHoles);

    // Draw status panel with debug info
    drawStatusPanel(
      ctx,
      trackedHoles,
      processingTime,
      sourceImageData.width,
      sourceImageData.height,
      roi !== null,
      currentDetections.length,
      lastDebugInfo
    );

    // Return holes in context for potential downstream features
    return { holes: trackedHoles };
  } catch (error) {
    console.error('Bullet hole detection failed:', error);
    return {};
  }
};

/**
 * Create live parameter control panel
 */
function createControlPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'bullet-hole-controls';
  panel.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.9);
    border: 2px solid #00ffff;
    border-radius: 8px;
    padding: 15px;
    color: #fff;
    font-family: monospace;
    font-size: 12px;
    max-width: 320px;
    z-index: 1000;
    max-height: 90vh;
    overflow-y: auto;
  `;

  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <h3 style="margin: 0; color: #00ffff; font-size: 14px;">🎯 Detection Controls</h3>
      <button id="close-controls" style="background: #ff4444; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer;">✕</button>
    </div>

    <div style="margin-bottom: 15px;">
      <button id="preset-small" class="preset-btn">Small Holes</button>
      <button id="preset-large" class="preset-btn">Large Holes</button>
      <button id="preset-reset" class="preset-btn">Reset</button>
    </div>

    <div class="control-group" style="background: rgba(0, 255, 100, 0.1); padding: 10px; border-radius: 4px; border: 1px solid #00ff66;">
      <h4 style="color: #00ff66; margin: 0 0 10px 0;">📸 Background Subtraction (RECOMMENDED)</h4>
      <div style="font-size: 11px; color: #aaa; margin-bottom: 10px;">
        Captures clean target, then detects only new holes. Works with any target pattern!
      </div>
      <button id="capture-reference" style="width: 100%; background: #00ff66; color: #000; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 5px;">
        📷 Capture Clean Target
      </button>
      <button id="clear-reference" style="width: 100%; background: #ff4444; color: #fff; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">
        ✕ Clear Reference
      </button>
      <div style="font-size: 10px; color: #888; margin-top: 8px;">
        <label>Difference Threshold: <span id="val-differenceThreshold">${PARAMS.differenceThreshold}</span></label>
        <input type="range" id="ctrl-differenceThreshold" min="5" max="50" value="${PARAMS.differenceThreshold}" step="1">
      </div>
    </div>

    <div class="control-group">
      <h4 style="color: #ff00ff; margin: 10px 0 5px 0;">⚡ Edge Detection</h4>

      <label>Edge Threshold: <span id="val-edgeThreshold">${PARAMS.edgeThreshold}</span></label>
      <input type="range" id="ctrl-edgeThreshold" min="0" max="255" value="${PARAMS.edgeThreshold}" step="5">
      <div style="font-size: 10px; color: #888; margin-top: 2px;">Lower = more sensitive</div>
    </div>

    <div class="control-group">
      <h4 style="color: #ffff00; margin: 10px 0 5px 0;">📏 Blob Size</h4>

      <label>Min Size: <span id="val-minBlobSize">${PARAMS.minBlobSize}</span>px²</label>
      <input type="range" id="ctrl-minBlobSize" min="1" max="200" value="${PARAMS.minBlobSize}" step="1">

      <label>Max Size: <span id="val-maxBlobSize">${PARAMS.maxBlobSize}</span>px²</label>
      <input type="range" id="ctrl-maxBlobSize" min="100" max="5000" value="${PARAMS.maxBlobSize}" step="50">
    </div>

    <div class="control-group">
      <h4 style="color: #00ff00; margin: 10px 0 5px 0;">🔍 Shape Analysis</h4>

      <label>Min Circularity: <span id="val-minCircularity">${PARAMS.minCircularity}</span></label>
      <input type="range" id="ctrl-minCircularity" min="0" max="1" value="${PARAMS.minCircularity}" step="0.05">
      <div style="font-size: 10px; color: #888; margin-top: 2px;">How round (1.0 = perfect circle)</div>

      <label>Min Compactness: <span id="val-minCompactness">${PARAMS.minCompactness}</span></label>
      <input type="range" id="ctrl-minCompactness" min="0" max="1" value="${PARAMS.minCompactness}" step="0.05">
      <div style="font-size: 10px; color: #888; margin-top: 2px;">How tight to bounding box</div>
    </div>

    <div class="control-group">
      <h4 style="color: #ff00ff; margin: 10px 0 5px 0;">🔬 Advanced Detection</h4>

      <label>
        <input type="checkbox" id="ctrl-useContrastEnhancement" ${PARAMS.useContrastEnhancement ? 'checked' : ''}>
        Contrast Enhancement
      </label>
      <div style="font-size: 10px; color: #888; margin-top: 2px;">Boost low-contrast holes</div>

      <label>Contrast Tile: <span id="val-contrastTileSize">${PARAMS.contrastTileSize}</span>px</label>
      <input type="range" id="ctrl-contrastTileSize" min="16" max="64" value="${PARAMS.contrastTileSize}" step="8">

      <label>
        <input type="checkbox" id="ctrl-useLoGDetection" ${PARAMS.useLoGDetection ? 'checked' : ''}>
        LoG Blob Detection
      </label>
      <div style="font-size: 10px; color: #888; margin-top: 2px;">Detect dark & light holes</div>

      <label>LoG Sigma: <span id="val-logSigma">${PARAMS.logSigma}</span></label>
      <input type="range" id="ctrl-logSigma" min="0.5" max="3.0" value="${PARAMS.logSigma}" step="0.1">

      <label>LoG Threshold: <span id="val-logThreshold">${PARAMS.logThreshold}</span></label>
      <input type="range" id="ctrl-logThreshold" min="5" max="30" value="${PARAMS.logThreshold}" step="1">
    </div>

    <div class="control-group">
      <h4 style="color: #ff8800; margin: 10px 0 5px 0;">⏱️ Tracking</h4>

      <label>Match Distance: <span id="val-matchDistanceThreshold">${PARAMS.matchDistanceThreshold}</span>px</label>
      <input type="range" id="ctrl-matchDistanceThreshold" min="5" max="50" value="${PARAMS.matchDistanceThreshold}" step="1">

      <label>Confirm Frames: <span id="val-minFramesToConfirm">${PARAMS.minFramesToConfirm}</span></label>
      <input type="range" id="ctrl-minFramesToConfirm" min="1" max="10" value="${PARAMS.minFramesToConfirm}" step="1">

      <label>Persistence: <span id="val-maxFramesNotSeen">${PARAMS.maxFramesNotSeen}</span></label>
      <input type="range" id="ctrl-maxFramesNotSeen" min="1" max="20" value="${PARAMS.maxFramesNotSeen}" step="1">

      <label>Smoothing: <span id="val-confidenceSmoothingFactor">${PARAMS.confidenceSmoothingFactor}</span></label>
      <input type="range" id="ctrl-confidenceSmoothingFactor" min="0.1" max="0.9" value="${PARAMS.confidenceSmoothingFactor}" step="0.05">
    </div>

    <div class="control-group">
      <h4 style="color: #00ccff; margin: 10px 0 5px 0;">🕰️ Temporal Analysis</h4>

      <label>Window Size: <span id="val-temporalWindowSize">${PARAMS.temporalWindowSize}</span> frames</label>
      <input type="range" id="ctrl-temporalWindowSize" min="3" max="15" value="${PARAMS.temporalWindowSize}" step="1">
      <div style="font-size: 10px; color: #888; margin-top: 2px;">History for time-series analysis</div>

      <label>Match Distance: <span id="val-temporalMatchDistance">${PARAMS.temporalMatchDistance}</span>px</label>
      <input type="range" id="ctrl-temporalMatchDistance" min="10" max="50" value="${PARAMS.temporalMatchDistance}" step="1">

      <label>Confidence Boost: <span id="val-temporalConfidenceBoost">${PARAMS.temporalConfidenceBoost}</span>%</label>
      <input type="range" id="ctrl-temporalConfidenceBoost" min="5" max="30" value="${PARAMS.temporalConfidenceBoost}" step="1">

      <label>Min Clusters: <span id="val-minTemporalClustersForBoost">${PARAMS.minTemporalClustersForBoost}</span></label>
      <input type="range" id="ctrl-minTemporalClustersForBoost" min="2" max="10" value="${PARAMS.minTemporalClustersForBoost}" step="1">

      <label>Fiducial Persist: <span id="val-fiducialPersistenceFrames">${PARAMS.fiducialPersistenceFrames}</span> frames</label>
      <input type="range" id="ctrl-fiducialPersistenceFrames" min="5" max="30" value="${PARAMS.fiducialPersistenceFrames}" step="1">
      <div style="font-size: 10px; color: #888; margin-top: 2px;">Keep ROI when markers lost</div>
    </div>

    <style>
      #bullet-hole-controls label {
        display: block;
        margin: 8px 0 2px 0;
        font-size: 11px;
        color: #aaa;
      }
      #bullet-hole-controls input[type="range"] {
        width: 100%;
        margin-bottom: 8px;
      }
      #bullet-hole-controls .preset-btn {
        background: #444;
        border: 1px solid #666;
        color: #fff;
        padding: 6px 10px;
        margin: 2px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
      }
      #bullet-hole-controls .preset-btn:hover {
        background: #555;
      }
      #bullet-hole-controls .preset-btn:active {
        background: #00ffff;
        color: #000;
      }
    </style>
  `;

  return panel;
}

/**
 * Update parameter and display value
 */
function updateParam(paramName: keyof typeof PARAMS, value: number): void {
  (PARAMS as any)[paramName] = value;
  const valueSpan = document.getElementById(`val-${paramName}`);
  if (valueSpan) {
    // Format based on parameter type
    const isDecimal = paramName.includes('Factor') ||
                     paramName.includes('Circularity') ||
                     paramName.includes('Compactness') ||
                     paramName.includes('Sigma');
    valueSpan.textContent = value.toFixed(isDecimal ? 2 : 0);
  }

  // Update state if temporal window size changed
  if (paramName === 'temporalWindowSize' && state) {
    state.historyWindowSize = value;
    console.log(`Updated temporal window size to ${value} frames`);
  }

  // Update state if fiducial persistence changed
  if (paramName === 'fiducialPersistenceFrames' && state) {
    state.fiducialPersistenceFrames = value;
    console.log(`Updated fiducial persistence to ${value} frames`);
  }

  console.log(`Updated ${paramName} to ${value}`);
}

/**
 * Apply preset configurations
 */
function applyPreset(preset: 'small' | 'large' | 'reset'): void {
  const presets = {
    small: {
      edgeThreshold: 40,
      minBlobSize: 5,
      maxBlobSize: 500,
      minCircularity: 0.5,
      minCompactness: 0.4,
    },
    large: {
      edgeThreshold: 60,
      minBlobSize: 50,
      maxBlobSize: 3000,
      minCircularity: 0.6,
      minCompactness: 0.3,
    },
    reset: {
      edgeThreshold: 50,
      minBlobSize: 10,
      maxBlobSize: 2000,
      minCircularity: 0.4,
      minCompactness: 0.3,
      matchDistanceThreshold: 20,
      minFramesToConfirm: 2,
      maxFramesNotSeen: 5,
      confidenceSmoothingFactor: 0.3,
    },
  };

  const config = presets[preset];
  Object.entries(config).forEach(([key, value]) => {
    updateParam(key as keyof typeof PARAMS, value);
    const slider = document.getElementById(`ctrl-${key}`) as HTMLInputElement;
    if (slider) slider.value = value.toString();
  });

  console.log(`Applied preset: ${preset}`);
}

/**
 * Setup control panel and event listeners
 */
export function setupBulletHoleControls(): void {
  // Remove existing panel if any
  const existing = document.getElementById('bullet-hole-controls');
  if (existing) existing.remove();

  // Create and add panel
  const panel = createControlPanel();
  document.body.appendChild(panel);

  // Setup close button
  document.getElementById('close-controls')?.addEventListener('click', () => {
    panel.remove();
  });

  // Setup preset buttons
  document.getElementById('preset-small')?.addEventListener('click', () => applyPreset('small'));
  document.getElementById('preset-large')?.addEventListener('click', () => applyPreset('large'));
  document.getElementById('preset-reset')?.addEventListener('click', () => applyPreset('reset'));

  // Setup reference capture/clear buttons
  document.getElementById('capture-reference')?.addEventListener('click', () => {
    if (state?.latestSourceImage) {
      captureReferenceFrame(state.latestSourceImage);
      console.log('Reference frame captured');
    } else {
      console.warn('No source image available for reference capture');
    }
  });

  document.getElementById('clear-reference')?.addEventListener('click', () => {
    clearReferenceFrame();
    console.log('Reference frame cleared');
  });

  // Setup parameter sliders
  const paramKeys: (keyof typeof PARAMS)[] = [
    'edgeThreshold',
    'minBlobSize',
    'maxBlobSize',
    'minCircularity',
    'minCompactness',
    'contrastTileSize',
    'logSigma',
    'logThreshold',
    'differenceThreshold',
    'matchDistanceThreshold',
    'minFramesToConfirm',
    'maxFramesNotSeen',
    'confidenceSmoothingFactor',
    'temporalWindowSize',
    'temporalMatchDistance',
    'temporalConfidenceBoost',
    'minTemporalClustersForBoost',
    'fiducialPersistenceFrames',
  ];

  paramKeys.forEach((key) => {
    const slider = document.getElementById(`ctrl-${key}`) as HTMLInputElement;
    if (slider) {
      slider.addEventListener('input', (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        updateParam(key, value);
      });
    }
  });

  // Setup checkboxes for boolean parameters
  const contrastCheckbox = document.getElementById('ctrl-useContrastEnhancement') as HTMLInputElement;
  if (contrastCheckbox) {
    contrastCheckbox.addEventListener('change', (e) => {
      PARAMS.useContrastEnhancement = (e.target as HTMLInputElement).checked;
      console.log(`Contrast enhancement: ${PARAMS.useContrastEnhancement}`);
    });
  }

  const logCheckbox = document.getElementById('ctrl-useLoGDetection') as HTMLInputElement;
  if (logCheckbox) {
    logCheckbox.addEventListener('change', (e) => {
      PARAMS.useLoGDetection = (e.target as HTMLInputElement).checked;
      console.log(`LoG detection: ${PARAMS.useLoGDetection}`);
    });
  }

  console.log('Bullet hole controls initialized');
}

/**
 * Bullet hole detection feature definition with pipeline metadata
 */
export const bulletHoleFeature: Feature = {
  id: 'bullet-holes',
  name: 'Bullet Hole Detection',
  description: 'Detect bullet holes with live parameter controls',
  process: bulletHoleProcessor,
  enabled: false,
  pipeline: {
    consumes: ['markers'],  // Uses markers from fiducial detection
    provides: ['holes'],    // Provides detected holes
    layer: 1,               // Draw on top of fiducial layer
  },
};
