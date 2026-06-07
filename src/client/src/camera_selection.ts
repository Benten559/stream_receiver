import type { AvailableCamerasResponse } from '../../types/api.types.js';
import { setupRecordingControls } from './features/frame_recording_controls.js';

let currentStreamImg: HTMLImageElement | null = null;
let currentOverlayCanvas: HTMLCanvasElement | null = null;
let holeNotificationSource: EventSource | null = null;

interface DetectedHole {
  x: number;
  y: number;
  timestamp: number;
}
let detectedHoles: DetectedHole[] = [];

async function fetchAvailableCameras(): Promise<string[]> {
  try {
    const response = await fetch('/camera/discover');
    const data: AvailableCamerasResponse = await response.json();
    return data.cameras;
  } catch (error) {
    console.error('Failed to fetch available cameras:', error);
    return [];
  }
}

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

function startMJPEGStream(cameraId: string): void {
  const streamViewElement = document.getElementById('stream-viewer');
  if (!streamViewElement) return;

  cleanupCurrentStream();
  streamViewElement.innerHTML = '';

  try {
    const wrapper = document.createElement('div');
    wrapper.className = 'stream-canvas-container';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'label';
    labelDiv.textContent = `Camera: ${cameraId}`;
    wrapper.appendChild(labelDiv);

    // MJPEG display: browser updates this img natively on each multipart frame.
    // The img must be in the DOM — off-DOM img elements don't receive pixel
    // updates from MJPEG streams in Chrome.
    const img = document.createElement('img');
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    img.onload = () => {
      console.log(`[MJPEG] First frame decoded: ${img.naturalWidth}x${img.naturalHeight}`);
      if (currentOverlayCanvas) {
        currentOverlayCanvas.width = img.naturalWidth;
        currentOverlayCanvas.height = img.naturalHeight;
      }
    };
    img.onerror = (e) => console.error('[MJPEG] Stream error:', e);

    // Transparent canvas layered on top of the img for hole markers
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;max-width:100%;';

    wrapper.appendChild(img);
    wrapper.appendChild(overlay);
    streamViewElement.appendChild(wrapper);

    currentStreamImg = img;
    currentOverlayCanvas = overlay;

    img.src = `/camera/stream/${cameraId}`;
    console.log(`MJPEG stream started: ${cameraId}`);

    startHoleNotificationListener();
    addRecordingButton();

  } catch (error) {
    console.error('Failed to start MJPEG stream:', error);
  }
}

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

function startHoleNotificationListener(): void {
  if (holeNotificationSource) {
    holeNotificationSource.close();
  }

  holeNotificationSource = new EventSource('/camera/holes/sse');

  holeNotificationSource.addEventListener('hole', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      console.log(`Hole detected at (${data.x}, ${data.y})`);
      detectedHoles.push({ x: data.x, y: data.y, timestamp: data.timestamp });
      if (detectedHoles.length > 50) detectedHoles = detectedHoles.slice(-50);
      drawDetectedHoles();
    } catch (error) {
      console.error('Failed to parse hole notification:', error);
    }
  });

  holeNotificationSource.addEventListener('open', () => console.log('Connected to hole notifications'));
  holeNotificationSource.addEventListener('error', () => console.error('Hole notification connection error'));
}

function drawDetectedHoles(): void {
  if (!currentOverlayCanvas) return;

  const ctx = currentOverlayCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, currentOverlayCanvas.width, currentOverlayCanvas.height);
  if (detectedHoles.length === 0) return;

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 3;

  for (const hole of detectedHoles) {
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, 15, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, 3, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function cleanupCurrentStream(): void {
  if (currentStreamImg) {
    currentStreamImg.src = '';
    currentStreamImg.onload = null;
    currentStreamImg.onerror = null;
    currentStreamImg = null;
  }
  currentOverlayCanvas = null;

  if (holeNotificationSource) {
    holeNotificationSource.close();
    holeNotificationSource = null;
  }

  detectedHoles = [];

  const featureOptions = document.getElementById('feature-options');
  if (featureOptions) featureOptions.innerHTML = '';
}

function addRecordingButton(): void {
  const featureOptions = document.getElementById('feature-options');
  if (!featureOptions) return;

  const recordingBtn = document.createElement('button');
  recordingBtn.textContent = 'Frame Recording';
  recordingBtn.className = 'feature-toggle-button';
  recordingBtn.addEventListener('click', () => setupRecordingControls());
  featureOptions.appendChild(recordingBtn);

  const clearHolesBtn = document.createElement('button');
  clearHolesBtn.textContent = 'Clear Holes';
  clearHolesBtn.className = 'feature-toggle-button';
  clearHolesBtn.addEventListener('click', () => {
    detectedHoles = [];
    drawDetectedHoles();
    console.log('Cleared detected holes');
  });
  featureOptions.appendChild(clearHolesBtn);
}

window.addEventListener('beforeunload', () => cleanupCurrentStream());

const cameras = await fetchAvailableCameras();
console.log('Available cameras:', cameras);
renderCameraButtons(cameras);
