/**
 * Type definitions for streaming system
 */

/**
 * Common interface for all stream providers (MJPEG, WebSockets, etc.)
 */
export interface IStreamClient extends EventTarget {
  connect(): void;
  disconnect(): void;
}

/**
 * Frame data received from binary MJPEG endpoint
 */
export interface BinaryFrame {
  image: HTMLImageElement;
  /** Client-side timestamp when frame was received */
  timestamp: number;
  /**
   * Note: MJPEG headers usually don't include server timestamps
   * unless custom headers are parsed manually.
   */
  serverTimestamp?: number;
}
