/**
 *
 * @export
 * @interface CameraFrame
 */
export interface CameraFrame {
    cameraId: string;
    frameData: Buffer;
    timestamp: Date;
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