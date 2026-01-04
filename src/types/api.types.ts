// src/types/api.types.ts

/**
 * Response for GET /camera/available
 */
export interface AvailableCamerasResponse {
    cameras: string[];
    count: number;
}

/**
 * Standard error response
 */
export interface ErrorResponse {
    error: string;
}

/**
 * Response for POST /camera/recording/start
 */
export interface RecordingStartResponse {
    success: boolean;
    session?: {
        sessionId: string;
        sessionPath: string;
        startTime: Date;
    };
    error?: string;
}

/**
 * Response for POST /camera/recording/stop
 */
export interface RecordingStopResponse {
    success: boolean;
    message?: string;
    error?: string;
}

/**
 * Response for GET /camera/recording/status
 */
export interface RecordingStatusResponse {
    isRecording: boolean;
    sessionId?: string;
    sessionPath?: string;
    startTime?: string;
    cameras?: string[];
    frameCounts?: Record<string, number>;
    totalFrames?: number;
}
