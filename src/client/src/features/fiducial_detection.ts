/**
 * Fiducial Marker Detection Feature
 * Uses OpenCV.js ArUco detection to identify and visualize fiducial markers
 * for spotter scope calibration and target tracking
 */

import type { Feature, FeatureProcessor, FeatureContext } from '../types/streaming.types.js';

// OpenCV types global cv
declare const cv: any;

/**
 * Marker detection state and OpenCV resources
 */
interface DetectionState {
  dictionary: any;
  detector: any;
  lastFrameTime: number;
  frameCount: number;
  fps: number;
}

// Module state
let state: DetectionState | null = null;

/**
 * Detected marker data
 */
export interface DetectedMarker {
  id: number;
  corners: { x: number; y: number }[];
  center: { x: number; y: number };
}

/**
 * Initialize ArUco detector: lazy initialization
 */
function initializeDetector(): boolean {
  if (typeof cv === 'undefined' || !cv.aruco_Dictionary) {
    return false;
  }

  if (state === null) {
    try {
      console.log('[ArUco Debug] Attempting to initialize detector...');
      console.log('[ArUco Debug] cv.DICT_5X5_100 =', cv.DICT_5X5_100);

      // Try to create ArUco dictionary
      let dictionary;

      // Method 1: Try static getPredefinedDictionary on class
      if (cv.aruco_Dictionary.getPredefinedDictionary) {
        console.log('[ArUco Debug] Using aruco_Dictionary.getPredefinedDictionary');
        dictionary = cv.aruco_Dictionary.getPredefinedDictionary(cv.DICT_5X5_100);
      }
      // Method 2: Try global getPredefinedDictionary
      else if (cv.getPredefinedDictionary) {
        console.log('[ArUco Debug] Using cv.getPredefinedDictionary');
        dictionary = cv.getPredefinedDictionary(cv.DICT_5X5_100);
      }
      // Method 3: Try constructor with dictionary ID
      else {
        console.log('[ArUco Debug] Trying direct constructor');
        dictionary = new cv.aruco_Dictionary(cv.DICT_5X5_100);
      }

      console.log('[ArUco Debug] Dictionary created:', dictionary);

      const parameters = new cv.aruco_DetectorParameters();

      // Adjustable parameters for better detection
      // Make detection more lenient for various conditions
      // TODO: Add these to an interface for real-time adjustablility
      parameters.adaptiveThreshWinSizeMin = 3;
      parameters.adaptiveThreshWinSizeMax = 23;
      parameters.adaptiveThreshWinSizeStep = 10;
      parameters.minMarkerPerimeterRate = 0.03; // Smaller markers (default 0.03)
      parameters.maxMarkerPerimeterRate = 4.0;  // Larger markers (default 4.0)
      parameters.polygonalApproxAccuracyRate = 0.05; // More lenient (default 0.05)
      parameters.minCornerDistanceRate = 0.05;
      parameters.minDistanceToBorder = 3;
      parameters.cornerRefinementMethod = 1; // Subpix refinement

      console.log('[ArUco Debug] Parameters created and tuned:', parameters);

      // Create RefineParameters with default values (minRepDistance, errorCorrectionRate, checkAllOrders)
      const refineParameters = new cv.aruco_RefineParameters(10.0, 3.0, true);
      console.log('[ArUco Debug] RefineParameters created:', refineParameters);

      const detector = new cv.aruco_ArucoDetector(dictionary, parameters, refineParameters);
      console.log('[ArUco Debug] Detector created:', detector);

      state = {
        dictionary,
        detector,
        lastFrameTime: performance.now(),
        frameCount: 0,
        fps: 0,
      };

      console.log('ArUco detector initialized (DICT_5X5_100)');
      return true;
    } catch (error) {
      console.error('Failed to initialize ArUco detector:', error);
      console.error('[ArUco Debug] Error details:', error);
      return false;
    }
  }

  return true;
}

/**
 * Detect ArUco markers in image
 */
function detectMarkers(imageData: ImageData): DetectedMarker[] {
  if (!state) {
    return [];
  }

  const markers: DetectedMarker[] = [];
  let src: any = null;
  let gray: any = null;
  let corners: any = null;
  let ids: any = null;
  let rejected: any = null;

  try {
    // Convert ImageData to OpenCV Mat
    src = cv.matFromImageData(imageData);

    // Convert to grayscale
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Detect markers using detector object
    corners = new cv.MatVector();
    ids = new cv.Mat();
    rejected = new cv.MatVector();
    state.detector.detectMarkers(gray, corners, ids, rejected);

    // Debug: Log detection results
    const numMarkers = ids.rows;
    const numRejected = rejected.size();
    if (numRejected > 0 || numMarkers > 0) {
      console.log(`[Detection] Found ${numMarkers} markers, rejected ${numRejected} candidates`);
    }
    for (let i = 0; i < numMarkers; i++) {
      const id = ids.data32S[i];
      const cornerMat = corners.get(i);

      // Extract 4 corners from Float32Array (x, y pairs)
      const cornerPoints: { x: number; y: number }[] = [];
      for (let j = 0; j < 4; j++) {
        cornerPoints.push({
          x: cornerMat.data32F[j * 2],
          y: cornerMat.data32F[j * 2 + 1],
        });
      }

      // Calculate center point
      const center = {
        x: cornerPoints.reduce((sum, p) => sum + p.x, 0) / 4,
        y: cornerPoints.reduce((sum, p) => sum + p.y, 0) / 4,
      };

      markers.push({
        id,
        corners: cornerPoints,
        center,
      });
    }

    return markers;
  } catch (error) {
    console.error('Marker detection failed:', error);
    return [];
  } finally {
    // Clean up to avoid memory leaks
    if (src) src.delete();
    if (gray) gray.delete();
    if (corners) corners.delete();
    if (ids) ids.delete();
    if (rejected) rejected.delete();
  }
}

/**
 * Draw marker visualizations on canvas
 */
function drawMarkers(
  ctx: CanvasRenderingContext2D,
  markers: DetectedMarker[]
): void {
  markers.forEach((marker) => {
    const { corners, center, id } = marker;

    // Skip if invalid marker data
    if (corners.length < 4) return;

    // Draw polygon outline (green)
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(corners[0]!.x, corners[0]!.y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i]!.x, corners[i]!.y);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw corners
    corners.forEach((corner, index) => {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, 6, 0, 2 * Math.PI);
      // First corner is red (orientation reference), others yellow
      ctx.fillStyle = index === 0 ? '#ff0000' : '#ffff00';
      ctx.fill();
    });

    // Draw center point (cyan)
    ctx.beginPath();
    ctx.arc(center.x, center.y, 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#00ffff';
    ctx.fill();

    // Draw coordinate axes from center
    const axisLength = 40;

    // Calculate axis directions from first corner to center
    const dx = corners[1]!.x - corners[0]!.x;
    const dy = corners[1]!.y - corners[0]!.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Normalize and scale
    const xAxisX = (dx / length) * axisLength;
    const xAxisY = (dy / length) * axisLength;

    // Y-axis is perpendicular
    const yAxisX = -xAxisY;
    const yAxisY = xAxisX;

    // Draw X-axis (red)
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(center.x + xAxisX, center.y + xAxisY);
    ctx.stroke();

    // Draw Y-axis (green)
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(center.x + yAxisX, center.y + yAxisY);
    ctx.stroke();

    // Draw marker ID label
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = `ID ${id}`;
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const textHeight = 28;

    // Dark background for label
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(
      center.x - textWidth / 2 - 5,
      center.y - textHeight / 2 - 5,
      textWidth + 10,
      textHeight + 10
    );

    // White text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, center.x, center.y);
  });
}

/**
 * Draw status overlay
 */
function drawStatusOverlay(
  ctx: CanvasRenderingContext2D,
  markers: DetectedMarker[],
  detectionTime: number,
  width: number,
  height: number
): void {
  const panelWidth = 300;
  const panelHeight = 110;
  const padding = 10;
  const lineHeight = 18;

  // Dark background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, panelWidth, panelHeight);

  // Text styling
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Color based on detection
  ctx.fillStyle = markers.length > 0 ? '#00ff00' : '#ffa500';

  let y = padding;

  // Marker count
  ctx.fillText(`Markers: ${markers.length}`, padding, y);
  y += lineHeight;

  // Detection time
  ctx.fillText(`Detection: ${detectionTime.toFixed(1)}ms`, padding, y);
  y += lineHeight;

  // FPS
  const fps = state?.fps ?? 0;
  ctx.fillText(`FPS: ${fps.toFixed(1)}`, padding, y);
  y += lineHeight;

  // Frame dimensions
  ctx.fillText(`Frame: ${width}x${height}`, padding, y);
  y += lineHeight;

  // Detected marker IDs
  if (markers.length > 0) {
    const ids = markers.map((m) => m.id).join(', ');
    ctx.fillText(`IDs: ${ids}`, padding, y);
  }
}

/**
 * Update FPS calculation
 */
function updateFPS(): void {
  if (!state) return;

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
 * Fiducial detection processor with context pipeline
 */
const fiducialProcessor: FeatureProcessor = (
  sourceImageData: ImageData,
  sharedCanvas: HTMLCanvasElement,
  context: Readonly<FeatureContext>
): FeatureContext => {
  const ctx = sharedCanvas.getContext('2d');

  if (!ctx) {
    console.error('Failed to get 2D context for fiducial canvas');
    return {};
  }

  // Draw original image first (base layer)
  ctx.putImageData(sourceImageData, 0, 0);

  // Check if OpenCV is ready
  if (typeof cv === 'undefined' || !cv.aruco_Dictionary) {
    // Show loading message
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 300, 60);
    ctx.fillStyle = '#ffa500';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('OpenCV.js Loading...', 10, 30);
    return {};
  }

  // Initialize detector if needed
  if (!initializeDetector()) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 300, 60);
    ctx.fillStyle = '#ff0000';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Failed to initialize detector', 10, 30);
    return {};
  }

  try {
    // Detect markers
    const startTime = performance.now();
    const markers = detectMarkers(sourceImageData);
    const detectionTime = performance.now() - startTime;

    // Update FPS
    updateFPS();

    // Draw visualizations
    drawMarkers(ctx, markers);
    drawStatusOverlay(
      ctx,
      markers,
      detectionTime,
      sourceImageData.width,
      sourceImageData.height
    );

    // Return markers in context for downstream features
    return { markers };
  } catch (error) {
    console.error('Fiducial processing failed:', error);
    return {};
  }
};

/**
 * Fiducial detection feature definition with pipeline metadata
 */
export const fiducialFeature: Feature = {
  id: 'fiducial-detection',
  name: 'Fiducial Markers',
  description: 'Detect and highlight ArUco markers (5x5, IDs 0-99)',
  process: fiducialProcessor,
  enabled: false,
  pipeline: {
    provides: ['markers'],  // Provides markers for downstream features
    consumes: [],           // Doesn't consume any context
    layer: 0,               // Base layer (drawn first)
  },
};
