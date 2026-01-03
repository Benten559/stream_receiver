/**
 * Bullet Hole Detection Feature
 *
 * Detects circular bullet holes in target images using custom computer vision:
 * 1. Sobel Edge Detection - Fast edge detection
 * 2. Connected Components - Flood fill to find blobs
 * 3. Shape Analysis - Circularity and compactness filtering
 *
 * Fast, optimized algorithm designed for real-time performance.
 */

import type { Feature, FeatureProcessor, FeatureContext } from '../types/streaming.types.js';
import type { DetectedMarker } from './fiducial_detection.js';

/**
 * Detected bullet hole from blob detection
 */
interface DetectedHole {
  center: { x: number; y: number };
  radius: number;
  confidence: number; // 0-100 (based on blob properties)
}

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
}

// Module-level state
let state: DetectionState | null = null;

// Detection parameters (tunable)
const PARAMS = {
  // Edge Detection (Sobel)
  edgeThreshold: 50, // 0-255, lower = more sensitive to edges

  // Blob Size Constraints
  minBlobSize: 10, // Minimum blob area in pixels²
  maxBlobSize: 2000, // Maximum blob area in pixels²

  // Shape Analysis
  minCircularity: 0.4, // 0-1, how circular the blob must be (4πA/P²)
  minCompactness: 0.3, // 0-1, how compact the blob is (A/BoundingBoxArea)

  // Temporal tracking parameters
  matchDistanceThreshold: 20, // pixels - max distance to match holes between frames
  minFramesToConfirm: 2, // Frames a hole must be seen before displaying
  maxFramesNotSeen: 5, // Frames without detection before removing hole
  confidenceSmoothingFactor: 0.3, // 0-1, lower = more smoothing (exponential moving average)

  // Debug visualization
  debugMode: true, // Show detected blobs before filtering
  debugShowRawBlobs: true, // Show ALL blobs before ROI/exclusion filtering
};

/**
 * Sobel Edge Detection
 * Applies Sobel operator to detect edges in grayscale image
 */
function sobelEdgeDetection(
  imageData: ImageData,
  threshold: number
): Uint8ClampedArray {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  // Convert to grayscale
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    gray[i] = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  // Edge magnitude array
  const edges = new Uint8ClampedArray(width * height);

  // Apply Sobel operator
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

/**
 * Blob data structure for connected components
 */
interface Blob {
  pixels: { x: number; y: number }[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Connected Components using Flood Fill
 * Finds all connected regions in binary edge image
 */
function findConnectedComponents(
  edges: Uint8ClampedArray,
  width: number,
  height: number
): Blob[] {
  const visited = new Uint8Array(width * height);
  const blobs: Blob[] = [];

  // Flood fill from a seed point
  function floodFill(startX: number, startY: number): Blob | null {
    const stack: { x: number; y: number }[] = [{ x: startX, y: startY }];
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
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const idx = y * width + x;

      // Skip if already visited or not an edge
      if (visited[idx] || !edges[idx]) continue;

      // Mark as visited
      visited[idx] = 1;

      // Add to blob
      blob.pixels.push({ x, y });

      // Update bounding box
      blob.minX = Math.min(blob.minX, x);
      blob.maxX = Math.max(blob.maxX, x);
      blob.minY = Math.min(blob.minY, y);
      blob.maxY = Math.max(blob.maxY, y);

      // Add neighbors (4-connectivity)
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

/**
 * Shape Analysis - Calculate circularity and compactness
 */
function analyzeShape(blob: Blob): {
  area: number;
  perimeter: number;
  circularity: number;
  compactness: number;
  centerX: number;
  centerY: number;
  radius: number;
} {
  const area = blob.pixels.length;

  // Calculate perimeter (count edge pixels)
  let perimeter = 0;
  const pixelSet = new Set(blob.pixels.map((p) => `${p.x},${p.y}`));

  for (const pixel of blob.pixels) {
    const { x, y } = pixel;
    // Check 4-neighbors
    const neighbors = [
      `${x + 1},${y}`,
      `${x - 1},${y}`,
      `${x},${y + 1}`,
      `${x},${y - 1}`,
    ];
    // If any neighbor is not in blob, this is a perimeter pixel
    if (neighbors.some((n) => !pixelSet.has(n))) {
      perimeter++;
    }
  }

  // Circularity: 4π * Area / Perimeter² (1.0 = perfect circle)
  const circularity =
    perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

  // Compactness: Area / Bounding Box Area
  const boundingBoxArea =
    (blob.maxX - blob.minX + 1) * (blob.maxY - blob.minY + 1);
  const compactness = boundingBoxArea > 0 ? area / boundingBoxArea : 0;

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
 * Detect blobs (bullet holes) in image using custom computer vision
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
  try {
    const width = imageData.width;
    const height = imageData.height;

    // Create ROI-cropped ImageData if ROI is specified
    let processImageData = imageData;
    let offsetX = 0;
    let offsetY = 0;

    if (roi) {
      console.log(
        `[BlobDetect] ROI active: (${roi.minX},${roi.minY}) to (${roi.maxX},${roi.maxY}), ${roi.exclusionZones.length} exclusion zones`
      );
      const roiWidth = roi.maxX - roi.minX;
      const roiHeight = roi.maxY - roi.minY;

      // Create a new ImageData for the ROI region
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
      console.log(
        `[BlobDetect] No ROI - processing full frame ${width}x${height}`
      );
    }

    // 1. Sobel Edge Detection
    const edges = sobelEdgeDetection(processImageData, PARAMS.edgeThreshold);

    // 2. Connected Components
    const blobs = findConnectedComponents(
      edges,
      processImageData.width,
      processImageData.height
    );

    console.log(
      `[BlobDetect] Found ${blobs.length} connected components (edge threshold=${PARAMS.edgeThreshold})`
    );

    // Debug tracking
    const rawBlobs: { x: number; y: number; radius: number }[] = [];
    let afterROICount = 0;
    let afterExclusionCount = 0;
    let afterShapeCount = 0;

    // 3. Shape Analysis and Filtering
    const holes: DetectedHole[] = [];
    for (const blob of blobs) {
      const shape = analyzeShape(blob);

      // Adjust coordinates back to full frame
      const centerX = shape.centerX + offsetX;
      const centerY = shape.centerY + offsetY;

      // Track raw blobs for debug
      rawBlobs.push({ x: centerX, y: centerY, radius: shape.radius });

      // Filter by blob size
      if (
        shape.area < PARAMS.minBlobSize ||
        shape.area > PARAMS.maxBlobSize
      ) {
        continue;
      }
      afterShapeCount++;

      // Skip if outside ROI quadrilateral
      if (roi && !isPointInQuad(centerX, centerY, roi.corners)) {
        continue;
      }
      afterROICount++;

      // Skip if inside exclusion zone (fiducial marker)
      if (roi && isInExclusionZone(centerX, centerY, roi.exclusionZones)) {
        continue;
      }
      afterExclusionCount++;

      // Filter by circularity
      if (shape.circularity < PARAMS.minCircularity) {
        continue;
      }

      // Filter by compactness
      if (shape.compactness < PARAMS.minCompactness) {
        continue;
      }

      // Confidence based on shape quality (combination of circularity and compactness)
      const confidence = Math.min(
        100,
        ((shape.circularity + shape.compactness) / 2) * 100
      );

      holes.push({
        center: { x: centerX, y: centerY },
        radius: shape.radius,
        confidence,
      });
    }

    // Store debug info
    lastDebugInfo = {
      rawBlobCount: blobs.length,
      afterROICount,
      afterExclusionCount,
      rawBlobs,
    };

    console.log(
      `[BlobDetect] Filtering: ${blobs.length} raw → ${afterShapeCount} after shape → ${afterROICount} after ROI → ${afterExclusionCount} after exclusion → ${holes.length} final holes (circ>=${PARAMS.minCircularity}, compact>=${PARAMS.minCompactness})`
    );

    return holes;
  } catch (error) {
    console.error('Blob detection failed:', error);
    return [];
  }
}

/**
 * Custom Computer Vision Approach:
 * 1. Sobel Edge Detection - Fast, simple edge detection
 * 2. Connected Components - Flood fill to find blob regions
 * 3. Shape Analysis - Circularity and compactness filtering
 *
 * No FFT (too slow), no OpenCV dependency
 */

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

    // Draw confidence label with hole ID
    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `#${id} ${confidence.toFixed(0)}%`,
      center.x,
      center.y + radius + 15
    );
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
  const panelHeight = PARAMS.debugMode && debugInfo ? 200 : 130;
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
 * Get ROI (Region of Interest) from fiducial markers 0-3 in context
 * Returns bounding box and corner points, or null if markers not available
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
  // Read markers from context (provided by fiducial detection)
  const allMarkers = context.markers as DetectedMarker[] | undefined;

  if (!allMarkers || allMarkers.length === 0) {
    console.log('[ROI] No markers in context - processing full frame');
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

  return {
    minX: Math.floor(Math.min(...xs)),
    maxX: Math.ceil(Math.max(...xs)),
    minY: Math.floor(Math.min(...ys)),
    maxY: Math.ceil(Math.max(...ys)),
    corners,
    exclusionZones,
  };
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
 * Update tracked holes with new detections
 * Returns list of confirmed holes to display
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
    };
  }

  state.totalFrames++;
  const currentFrame = state.totalFrames;
  const matched = new Set<number>(); // Track which tracked holes were matched

  // Match new detections with existing tracked holes
  for (const detection of newDetections) {
    let bestMatch: TrackedHole | null = null;
    let bestDistance = Infinity;

    // Find closest tracked hole within threshold
    for (const tracked of state.trackedHoles) {
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

      // Smooth confidence using exponential moving average
      const alpha = PARAMS.confidenceSmoothingFactor;
      bestMatch.confidence =
        alpha * detection.confidence + (1 - alpha) * bestMatch.confidence;

      // Update position (slight smoothing)
      bestMatch.center.x = alpha * detection.center.x + (1 - alpha) * bestMatch.center.x;
      bestMatch.center.y = alpha * detection.center.y + (1 - alpha) * bestMatch.center.y;
      bestMatch.radius = alpha * detection.radius + (1 - alpha) * bestMatch.radius;

      // Reset tracking counters
      bestMatch.framesSeen++;
      bestMatch.framesNotSeen = 0;
      bestMatch.lastSeen = currentFrame;
    } else {
      // Add new tracked hole
      state.trackedHoles.push({
        id: state.nextHoleId++,
        center: { ...detection.center },
        radius: detection.radius,
        confidence: detection.confidence,
        framesSeen: 1,
        framesNotSeen: 0,
        lastSeen: currentFrame,
      });
    }
  }

  // Update holes that weren't matched this frame
  for (const tracked of state.trackedHoles) {
    if (!matched.has(tracked.id)) {
      tracked.framesNotSeen++;
    }
  }

  // Remove holes that haven't been seen for too long
  state.trackedHoles = state.trackedHoles.filter(
    (hole) => hole.framesNotSeen <= PARAMS.maxFramesNotSeen
  );

  // Return only confirmed holes (seen for minimum frames)
  return state.trackedHoles.filter(
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

  const ctx = sharedCanvas.getContext('2d');

  if (!ctx) {
    console.error('[PROCESSOR] Failed to get 2D context');
    return {};
  }

  try {
    const startTime = performance.now();

    // 1. Get ROI from context (markers provided by fiducial detection)
    const roi = getTargetROI(context);

    // 2. Detect blobs (bullet holes)
    const currentDetections = detectBlobs(sourceImageData, roi ?? undefined);

    // 3. Update temporal tracking and get confirmed holes
    const trackedHoles = updateTrackedHoles(currentDetections);

    const processingTime = performance.now() - startTime;

    // Update FPS
    updateFPS();

    // 4. Render visualization (on top of fiducial layer)
    // NOTE: Don't call putImageData - fiducial detection already drew the base image

    // Draw debug visualization if enabled
    if (PARAMS.debugMode && PARAMS.debugShowRawBlobs && lastDebugInfo) {
      // Draw ALL raw blobs in red (before filtering)
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      lastDebugInfo.rawBlobs.forEach((blob) => {
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius, 0, 2 * Math.PI);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }

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
    const isDecimal = paramName.includes('Factor') || paramName.includes('Circularity') || paramName.includes('Compactness');
    valueSpan.textContent = value.toFixed(isDecimal ? 2 : 0);
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

  // Setup parameter sliders
  const paramKeys: (keyof typeof PARAMS)[] = [
    'edgeThreshold',
    'minBlobSize',
    'maxBlobSize',
    'minCircularity',
    'minCompactness',
    'matchDistanceThreshold',
    'minFramesToConfirm',
    'maxFramesNotSeen',
    'confidenceSmoothingFactor',
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
