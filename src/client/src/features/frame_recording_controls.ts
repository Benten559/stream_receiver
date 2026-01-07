/**
 * Frame Recording Control Panel
 * Provides GUI controls to start/stop frame recording for algorithm development
 */

interface RecordingStatus {
  isRecording: boolean;
  sessionId?: string;
  sessionPath?: string;
  startTime?: string;
  cameras?: string[];
  frameCounts?: Record<string, number>;
  totalFrames?: number;
}

let statusUpdateInterval: number | null = null;

/**
 * Start a new recording session
 */
async function startRecording(): Promise<void> {
  try {
    const response = await fetch('/camera/recording/start', {
      method: 'POST',
    });
    const data = await response.json();

    if (data.success) {
      console.log('Recording started:', data.session);
      updateRecordingUI(true);
      startStatusPolling();
    } else {
      alert(`Failed to start recording: ${data.error}`);
    }
  } catch (error) {
    console.error('Failed to start recording:', error);
    alert('Failed to start recording. Check console for details.');
  }
}

/**
 * Stop the current recording session
 */
async function stopRecording(): Promise<void> {
  try {
    const response = await fetch('/camera/recording/stop', {
      method: 'POST',
    });
    const data = await response.json();

    if (data.success) {
      console.log('Recording stopped');
      updateRecordingUI(false);
      stopStatusPolling();
    } else {
      alert(`Failed to stop recording: ${data.error}`);
    }
  } catch (error) {
    console.error('Failed to stop recording:', error);
    alert('Failed to stop recording. Check console for details.');
  }
}

/**
 * Fetch current recording status from backend
 */
async function fetchRecordingStatus(): Promise<RecordingStatus> {
  const response = await fetch('/camera/recording/status');
  return await response.json();
}

/**
 * Start polling for status updates
 */
function startStatusPolling(): void {
  if (statusUpdateInterval) return;

  statusUpdateInterval = window.setInterval(async () => {
    const status = await fetchRecordingStatus();
    updateStatusDisplay(status);
  }, 1000);  // Update every second
}

/**
 * Stop polling for status updates
 */
function stopStatusPolling(): void {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
    statusUpdateInterval = null;
  }
}

/**
 * Update UI based on recording state
 */
function updateRecordingUI(isRecording: boolean): void {
  const startBtn = document.getElementById('recording-start-btn');
  const stopBtn = document.getElementById('recording-stop-btn');

  if (startBtn && stopBtn) {
    startBtn.style.display = isRecording ? 'none' : 'block';
    stopBtn.style.display = isRecording ? 'block' : 'none';
  }
}

/**
 * Update status display with current recording info
 */
function updateStatusDisplay(status: RecordingStatus): void {
  const statusDiv = document.getElementById('recording-status');
  if (!statusDiv) return;

  if (!status.isRecording) {
    statusDiv.innerHTML = '<p>Not recording</p>';
    return;
  }

  const frameInfo = status.cameras?.map(cam => {
    const count = status.frameCounts?.[cam] || 0;
    return `<li>${cam}: ${count} frames</li>`;
  }).join('') || '';

  statusDiv.innerHTML = `
    <p><strong>Session:</strong> ${status.sessionId}</p>
    <p><strong>Path:</strong> ${status.sessionPath}</p>
    <p><strong>Total Frames:</strong> ${status.totalFrames || 0}</p>
    <ul>${frameInfo}</ul>
  `;
}

/**
 * Create the recording control panel UI
 */
function createRecordingControlPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'recording-controls';
  panel.style.cssText = `
    position: fixed;
    top: 140px;
    right: 20px;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 15px;
    border-radius: 8px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    min-width: 300px;
    z-index: 1000;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  `;

  panel.innerHTML = `
    <h3 style="margin: 0 0 15px 0; font-size: 16px;">Frame Recording</h3>

    <div style="margin-bottom: 15px;">
      <button id="recording-start-btn" style="
        background: #00ff00;
        color: black;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        width: 100%;
      ">Start Recording</button>

      <button id="recording-stop-btn" style="
        background: #ff0000;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        width: 100%;
        display: none;
      ">Stop Recording</button>
    </div>

    <div id="recording-status" style="
      border-top: 1px solid #444;
      padding-top: 10px;
      font-size: 12px;
    ">
      <p>Not recording</p>
    </div>

    <button id="recording-close-btn" style="
      position: absolute;
      top: 10px;
      right: 10px;
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 18px;
    ">×</button>
  `;

  return panel;
}

/**
 * Setup and display recording controls
 */
export function setupRecordingControls(): void {
  // Remove existing panel
  const existing = document.getElementById('recording-controls');
  if (existing) {
    existing.remove();
    stopStatusPolling();
  }

  // Create and attach new panel
  const panel = createRecordingControlPanel();
  document.body.appendChild(panel);

  // Attach event listeners
  document.getElementById('recording-start-btn')?.addEventListener('click', startRecording);
  document.getElementById('recording-stop-btn')?.addEventListener('click', stopRecording);
  document.getElementById('recording-close-btn')?.addEventListener('click', () => {
    panel.remove();
    stopStatusPolling();
  });

  // Initial status check
  fetchRecordingStatus().then(status => {
    updateRecordingUI(status.isRecording);
    updateStatusDisplay(status);
    if (status.isRecording) {
      startStatusPolling();
    }
  });
}
