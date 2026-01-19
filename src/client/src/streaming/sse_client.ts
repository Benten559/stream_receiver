/**
 * SSE (Server-Sent Events) client for receiving camera frames
 * Extends EventTarget to emit custom events for frame arrivals
 */

import type { RawFrame } from '../types/streaming.types.js';

export class SSEStreamClient extends EventTarget {
  private cameraId: string;
  private eventSource: EventSource | null = null;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private reconnectTimer: number | null = null;
  private isManualDisconnect: boolean = false;

  // Frame stats
  private frameCount: number = 0;

  constructor(cameraId: string) {
    super();
    this.cameraId = cameraId;
  }

  /**
   * Establish SSE connection to the camera stream
   */
  connect(): void {
    if (this.eventSource) {
      console.warn(`SSE client already connected for camera: ${this.cameraId}`);
      return;
    }

    this.isManualDisconnect = false;
    const url = `/camera/stream/${this.cameraId}/sse`;

    console.log(`Connecting to SSE stream: ${url}`);
    this.eventSource = new EventSource(url);

    // Connection opened
    this.eventSource.addEventListener('open', () => {
      this.handleConnectionOpen();
    });

    // Frame event
    this.eventSource.addEventListener('frame', (event: MessageEvent) => {
      this.handleFrame(event);
    });

    // Error handling
    this.eventSource.addEventListener('error', (event: Event) => {
      this.handleError(event);
    });
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect(): void {
    this.isManualDisconnect = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      console.log(`Disconnecting from camera: ${this.cameraId}`);
      this.eventSource.close();
      this.eventSource = null;

      // Emit disconnected event
      this.dispatchEvent(new Event('disconnected'));
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }

  /**
   * Get the camera ID
   */
  getCameraId(): string {
    return this.cameraId;
  }

  /**
   * Handle connection open
   */
  private handleConnectionOpen(): void {
    console.log(`SSE connection established for camera: ${this.cameraId}`);
    this.reconnectDelay = 1000; // Reset reconnect delay on successful connection

    // Emit connected event
    this.dispatchEvent(new Event('connected'));
  }

  /**
   * Handle incoming frame data
   */
  private handleFrame(event: MessageEvent): void {
    try {
      const base64Data = event.data;

      if (!base64Data || typeof base64Data !== 'string') {
        console.error('[SSE] Invalid frame data received:', typeof base64Data);
        return;
      }

      this.frameCount++;

      // Validate base64 JPEG data (only log warnings occasionally)
      if (!base64Data.startsWith('/9j/') && this.frameCount % 50 === 0) {
        console.warn(
          `[SSE] Frame data doesn't look like JPEG base64. ` +
          `Length: ${base64Data.length}, Start: ${base64Data.substring(0, 20)}...`
        );
      }

      const rawFrame: RawFrame = {
        base64Data,
        timestamp: Date.now(),
      };

      // Emit custom frame event with detail
      const frameEvent = new CustomEvent('frame', { detail: rawFrame });
      this.dispatchEvent(frameEvent);
    } catch (error) {
      console.error('[SSE] Error processing frame:', error);
    }
  }

  /**
   * Handle connection errors
   */
  private handleError(event: Event): void {
    // EventSource fires error event on connection failure
    // Check if connection is closed
    if (this.eventSource?.readyState === EventSource.CLOSED) {
      console.error(`SSE connection closed for camera: ${this.cameraId}`);
      this.eventSource = null;

      // Emit error event
      const errorEvent = new CustomEvent('error', { detail: event });
      this.dispatchEvent(errorEvent);

      // Attempt reconnect if not manually disconnected
      if (!this.isManualDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return; // Already scheduled
    }

    console.log(`Reconnecting in ${this.reconnectDelay}ms...`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      console.log(`Attempting to reconnect to camera: ${this.cameraId}`);
      this.connect();

      // Increase delay for next reconnect (exponential backoff)
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay
      );
    }, this.reconnectDelay);
  }
}
