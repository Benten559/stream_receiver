import type { AvailableCamerasResponse } from '../../types/api.types.js';

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
    setStreamViewer(cameraId);
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
 * @description When a button is clicked add an updating-img element to page
 * @param cameraId 
 * @returns 
 */
function setStreamViewer(cameraId: string): HTMLImageElement {
  const streamViewElement = document.getElementById("stream-viewer");
  const imgElement = document.createElement('img');

  if (!streamViewElement){
    console.error(`stream-viewer element not found!`);
    return imgElement;
  }

  // Clear out previous stream
  streamViewElement.innerHTML = '';

  // Create MJPEG stream
  imgElement.src = `/camera/stream/${cameraId}`;
  imgElement.alt = `${cameraId} video feed`;
  imgElement.style.maxWidth = '100%';
  imgElement.style.height = 'auto';
  imgElement.style.border = '2px solid #ddd';
  imgElement.style.borderRadius = '4px';

  // When something goes wrong in rendering image data
  imgElement.onerror = () => {
    console.error(`Failed to load stream for camera: ${cameraId}`);
    const errorMsg = document.createElement('p');
    errorMsg.textContent = `Failed to stream camera: ${cameraId}`;
    errorMsg.style.color = 'red';
    streamViewElement.innerHTML = '';
    streamViewElement.appendChild(errorMsg);
  };

  streamViewElement.appendChild(imgElement);

  return imgElement;
}

const cameras = await fetchAvailableCameras();
console.log('Available cameras:', cameras);
renderCameraButtons(cameras);
