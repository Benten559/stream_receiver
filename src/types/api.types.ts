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
