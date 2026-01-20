import type { AvailableCamerasResponse } from '../../types/api.types.js';
import { SSEStreamClient } from './streaming/sse_client.js';
import { CanvasRenderer } from './streaming/canvas_renderer.js';
import { MJPEGStreamClient } from './streaming/MJPEGStreamClient.js';
import { setupRecordingControls } from './features/frame_recording_controls.js';
import type { BinaryFrame, IStreamClient, RawFrame } from './types/streaming.types.js';

// Track current stream
let currentStreamClient: IStreamClient | null = null;
let currentRenderer: CanvasRenderer | null = null;
let holeNotificationSource: EventSource | null = null;

// Store detected holes for drawing
interface DetectedHole {
  x: number;
  y: number;
  timestamp: number;
}
let detectedHoles: DetectedHole[] = [];

/**
 * Fetch available cameras from server
 * Uses /camera/discover to trigger stream discovery on page load
 */
async function fetchAvailableCameras(): Promise<string[]> {
  try {
    // Use discover endpoint to trigger stream discovery
    const response = await fetch('/camera/discover');
    const data: AvailableCamerasResponse = await response.json();
    return data.cameras;
  } catch (error) {
    console.error('Failed to fetch available cameras:', error);
    return [];
  }
}

/**
 * Create a button for selecting a camera
 */
function createCameraButton(cameraId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = `Camera: ${cameraId}`;
  button.className = 'camera-button';
  button.addEventListener('click', () => {
    console.log(`Viewing camera: ${cameraId}`);
    startMJPEGStream(cameraId);
  });
  return button;
}

/**
 * Start MJPEG stream for a camera
 */
function startMJPEGStream(cameraId: string): void {
  const streamViewElement = document.getElementById('stream-viewer');
  if (!streamViewElement) return;

  cleanupCurrentStream();
  streamViewElement.innerHTML = '';

  try {
    currentRenderer = new CanvasRenderer(
      'stream-viewer',
      cameraId,
      `Camera: ${cameraId}`
    );

    // Swap SSE for MJPEG
    currentStreamClient = new MJPEGStreamClient(cameraId);

    // Handle incoming MJPEG frames
    currentStreamClient.addEventListener('frame', async (event: Event) => {
      const customEvent = event as CustomEvent;
      const data = customEvent.detail;

      if (!data) return;

      try {
        // CASE 1: MJPEG (The data object HAS an image property)
        if (data.image && data.image instanceof HTMLImageElement) {
          currentRenderer!.renderFrame(data.image);
          drawDetectedHoles();
        }
        // CASE 2: SSE (The data object HAS base64Data)
        else if (data.base64Data) {
          const imgData = await currentRenderer!.decodeFrame(data.base64Data);
          if (imgData) {
            currentRenderer!.renderFrame(imgData);
            drawDetectedHoles();
          }
        }
        else {
          console.warn("Unrecognized frame format:", data);
        }
      } catch (error) {
        console.error('Failed to render frame:', error);
      }
    });


    currentStreamClient.addEventListener('connected', () => console.log(`MJPEG Connected: ${cameraId}`));
    currentStreamClient.addEventListener('error', (e) => showError(streamViewElement, `MJPEG Error: ${cameraId}`));

    currentStreamClient.connect();
    startHoleNotificationListener();
    addRecordingButton();

  } catch (error) {
    console.error('Failed to start MJPEG stream:', error);
  }
}

/**
 * Render camera selection buttons
 */
function renderCameraButtons(cameras: string[]): void {
  const container = document.getElementById('camera-buttons');
  if (!container) {
    console.error('Camera buttons container not found');
    return;
  }

  cameras.forEach(cameraId => {
    const button = createCameraButton(cameraId);
    container.appendChild(button);
  });
}

/**
 * Start SSE stream for a camera
 */
function startSSEStream(cameraId: string): void {
  const streamViewElement = document.getElementById('stream-viewer');

  if (!streamViewElement) {
    console.error('stream-viewer element not found!');
    return;
  }

  // Cleanup previous stream
  cleanupCurrentStream();

  // Clear container
  streamViewElement.innerHTML = '';

  try {
    // Create canvas renderer
    currentRenderer = new CanvasRenderer(
      'stream-viewer',
      cameraId,
      `Camera: ${cameraId}`
    );

    // Create SSE client for video frames
    currentStreamClient = new SSEStreamClient(cameraId);

    currentStreamClient.addEventListener('frame', async (event: Event) => {
      // Use the Union Type we defined
      const customEvent = event as CustomEvent<RawFrame | BinaryFrame>;
      const frame = customEvent.detail;

      try {
        let sourceToRender: HTMLImageElement | ImageData | null = null;

        // BRANCHING LOGIC: Check if it's SSE (base64Data) or MJPEG (image)
        if ('base64Data' in frame) {
          // SSE path: Needs manual decoding
          sourceToRender = await currentRenderer!.decodeFrame(frame.base64Data);
        } else if ('image' in frame) {
          // MJPEG path: Already a decoded HTMLImageElement
          sourceToRender = frame.image;
        }

        if (sourceToRender) {
          currentRenderer!.renderFrame(sourceToRender);
          drawDetectedHoles(); // Both perform overlay draw
        } else {
          console.warn("No renderable image data found in frame");
        }

      } catch (error) {
        console.error('Failed to render frame:', error);
      }
    });


    // Handle connection events
    currentStreamClient.addEventListener('connected', () => {
      console.log(`Connected to camera: ${cameraId}`);
    });

    currentStreamClient.addEventListener('disconnected', () => {
      console.log(`Disconnected from camera: ${cameraId}`);
    });

    currentStreamClient.addEventListener('error', (event: Event) => {
      console.error('SSE connection error:', event);
      showError(streamViewElement, `Failed to stream camera: ${cameraId}`);
    });

    // Connect to SSE stream
    currentStreamClient.connect();

    // Start listening for hole notifications
    startHoleNotificationListener();

    // Add recording controls button
    addRecordingButton();

  } catch (error) {
    console.error('Failed to start SSE stream:', error);
    showError(streamViewElement, `Failed to initialize stream for camera: ${cameraId}`);
  }
}

/**
 * Start listening for hole detection notifications from Python brain
 */
function startHoleNotificationListener(): void {
  // Close existing listener
  if (holeNotificationSource) {
    holeNotificationSource.close();
  }

  holeNotificationSource = new EventSource('/camera/holes/sse');

  holeNotificationSource.addEventListener('hole', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      console.log(`Hole detected at (${data.x}, ${data.y})`);

      // Add to detected holes list
      detectedHoles.push({
        x: data.x,
        y: data.y,
        timestamp: data.timestamp,
      });

      // Keep only last 50 holes
      if (detectedHoles.length > 50) {
        detectedHoles = detectedHoles.slice(-50);
      }

    } catch (error) {
      console.error('Failed to parse hole notification:', error);
    }
  });

  holeNotificationSource.addEventListener('open', () => {
    console.log('Connected to hole notifications');
  });

  holeNotificationSource.addEventListener('error', () => {
    console.error('Hole notification connection error');
  });
}

/**
 * Draw detected holes on the canvas
 */
function drawDetectedHoles(): void {
  if (!currentRenderer || detectedHoles.length === 0) {
    return;
  }

  const canvas = currentRenderer.getCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Draw each detected hole as a red circle
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 3;

  for (const hole of detectedHoles) {
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, 15, 0, 2 * Math.PI);
    ctx.stroke();

    // Add a small dot at center
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, 3, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/**
 * Cleanup current stream
 */
function cleanupCurrentStream(): void {
  if (currentStreamClient) {
    currentStreamClient.disconnect();
    currentStreamClient = null;
  }

  if (currentRenderer) {
    currentRenderer.destroy();
    currentRenderer = null;
  }

  if (holeNotificationSource) {
    holeNotificationSource.close();
    holeNotificationSource = null;
  }

  // Clear detected holes
  detectedHoles = [];

  // Clear feature options
  const featureOptions = document.getElementById('feature-options');
  if (featureOptions) {
    featureOptions.innerHTML = '';
  }
}

/**
 * Add frame recording button
 */
function addRecordingButton(): void {
  const recordingBtn = document.createElement('button');
  recordingBtn.textContent = 'Frame Recording';
  recordingBtn.className = 'feature-toggle-button';
  recordingBtn.addEventListener('click', () => {
    setupRecordingControls();
  });

  const featureOptions = document.getElementById('feature-options');
  if (featureOptions) {
    featureOptions.appendChild(recordingBtn);
  }

  // Add clear holes button
  const clearHolesBtn = document.createElement('button');
  clearHolesBtn.textContent = 'Clear Holes';
  clearHolesBtn.className = 'feature-toggle-button';
  clearHolesBtn.addEventListener('click', () => {
    detectedHoles = [];
    console.log('Cleared detected holes');
  });
  featureOptions?.appendChild(clearHolesBtn);
}

/**
 * Show error message
 */
function showError(container: HTMLElement, message: string): void {
  container.innerHTML = '';
  const errorMsg = document.createElement('p');
  errorMsg.textContent = message;
  errorMsg.style.color = 'red';
  container.appendChild(errorMsg);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupCurrentStream();
});

// Initialize
const cameras = await fetchAvailableCameras();
console.log('Available cameras:', cameras);
renderCameraButtons(cameras);
