/**
 *
 * @export
 * @interface CameraFrame
 */
export interface CameraFrame {
    cameraId: string;
    frameData: Buffer;
    timestamp: Date;
    /** Unix timestamp (ms) when Redis received the frame - used for frame age detection */
    serverTimestamp: number;
}

/**
 *
 * @export
 * @interface CameraState
 */
export interface CameraState {
    cameraId: string;
    viewerCount: number;
    latestFrame: Buffer | null;
    lastSeen: Date;
    unsubscribeTimer: NodeJS.Timeout | null;
}