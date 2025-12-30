import type { AvailableCamerasResponse } from '../../types/api.types.js';
import { SSEStreamClient } from './streaming/sse_client.js';
import { CanvasRenderer } from './streaming/canvas_renderer.js';
import { FeatureManager } from './features/feature_manager.js';
import { duplicateFeature } from './features/duplicate_stream.js';
import { fftFeature } from './features/fft_stream.js';
import { setupFeatureToggles } from './features/setup_features.js';
import type { RawFrame } from './types/streaming.types.js';

// Track current stream
let currentStreamClient: SSEStreamClient | null = null;
let currentRenderer: CanvasRenderer | null = null;
let currentFeatureManager: FeatureManager | null = null;

/**
 * @description Gives an array of all cameras server can stream
 *
 * @return {*}  {Promise<string[]>}
 */
async function fetchAvailableCameras(): Promise<string[]> {
  try {
    const response = await fetch('/camera/available');
    const data: AvailableCamerasResponse = await response.json();
    return data.cameras;
  } catch (error) {
    console.error('Failed to fetch available cameras:', error);
    return [];
  }
}

/**
 * @description Makes a button for each available stream
 * @param cameraId
 * @returns HTMLButtonElement
 */
function createCameraButton(cameraId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = `Camera: ${cameraId}`;
  button.className = 'camera-button';
  button.addEventListener('click', () => {
    console.log(`Viewing camera: ${cameraId}`);
    startSSEStream(cameraId);
  });
  return button;
}

/**
 * @description Put button elements on screen
 *
 * @param {string[]} cameras
 * @return {*}  {void}
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
 * @description Start SSE stream for a camera using canvas rendering with feature support
 * @param cameraId - The camera to stream
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
    // Create canvas renderer for original stream
    currentRenderer = new CanvasRenderer(
      'stream-viewer',
      cameraId,
      `Camera: ${cameraId} (Original)`
    );

    // Create SSE client
    currentStreamClient = new SSEStreamClient(cameraId);

    // Create feature manager (handles frame distribution)
    currentFeatureManager = new FeatureManager(
      currentStreamClient,
      cameraId,
      currentRenderer
    );

    // Register available features
    currentFeatureManager.registerFeature(duplicateFeature);
    currentFeatureManager.registerFeature(fftFeature);

    // Setup feature toggle buttons
    setupFeatureToggles(currentFeatureManager);

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

  } catch (error) {
    console.error('Failed to start SSE stream:', error);
    showError(streamViewElement, `Failed to initialize stream for camera: ${cameraId}`);
  }
}

/**
 * @description Cleanup current stream (disconnect and destroy)
 */
function cleanupCurrentStream(): void {
  if (currentFeatureManager) {
    currentFeatureManager.destroy();
    currentFeatureManager = null;
  }

  if (currentStreamClient) {
    currentStreamClient.disconnect();
    currentStreamClient = null;
  }

  if (currentRenderer) {
    currentRenderer.destroy();
    currentRenderer = null;
  }

  // Clear feature options
  const featureOptions = document.getElementById('feature-options');
  if (featureOptions) {
    featureOptions.innerHTML = '';
  }
}

/**
 * @description Show error message
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

const cameras = await fetchAvailableCameras();
console.log('Available cameras:', cameras);
renderCameraButtons(cameras);
