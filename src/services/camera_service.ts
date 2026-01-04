// src/services/camera_service.ts
import { RedisManager } from './redis_manager.ts';
import { FrameRecorder } from './frame_recorder.ts';
import type { CameraFrame, CameraState } from '../types/camera.types.ts';
import { initializeConfig } from '../config/index.ts';

type FrameListener = (frame : Buffer) => void;

export class CameraService {
    private redisManager: RedisManager;
    private cameraStates: Map<string, CameraState> = new Map();
    private frameListeners : Map<string, Set<FrameListener>> = new Map();
    private frameRecorder: FrameRecorder;

    constructor() {
        this.redisManager = new RedisManager();
        this.frameRecorder = new FrameRecorder();

        // Register frame handler
        this.redisManager.onFrame((frame: CameraFrame) => {
            this.handleFrame(frame);
        });
    }

    /**
     * Initialize the camera service and connect to Redis
     */
    async initialize(): Promise<void> {
        console.log('Initializing Redis connection...');
        await this.redisManager.connect();
        console.log('Camera service initialized');
    }

    /**
     * Handle incoming camera frames
     * @description 
     * The callback given to redis service handler, distributes frames to listeners
     * and updates attributes for status endpoint
     */
    private handleFrame(frame: CameraFrame): void {
        const { cameraId, frameData, timestamp } = frame;

        // Get or create camera state
        let state = this.cameraStates.get(cameraId);

        if (!state) {
            state = {
                cameraId,
                viewerCount: 0,
                latestFrame: null,
                lastSeen: timestamp,
                unsubscribeTimer: null,
            };
            this.cameraStates.set(cameraId, state);
            console.log(`New camera detected: ${cameraId}`);
        }

        // Update state
        state.latestFrame = frameData;
        state.lastSeen = timestamp;

        // Record frame if recording is active
        this.frameRecorder.recordFrame(cameraId, frameData).catch(err => {
            console.error(`Frame recording error for ${cameraId}:`, err);
        });

        // Notify all listeners for this camera
        const listeners = this.frameListeners.get(cameraId);
        if (listeners) {
            listeners.forEach(listener => listener(frameData));
        }
    }

    /**
     * Get list of available camera IDs
     */
    getAvailableCameras(): string[] {
        return Array.from(this.cameraStates.keys());
    }

    /**
     * Get the latest frame for a specific camera
     */
    getLatestFrame(cameraId: string | undefined): Buffer | null {
        const state = (cameraId != undefined) ? this.cameraStates.get(cameraId) : null;
        return state?.latestFrame || null;
    }

    /**
     * Get camera state information
     */
    getCameraState(cameraId: string): CameraState | undefined {
        return this.cameraStates.get(cameraId);
    }

    /**
     * Get all camera states
     */
    getAllCameraStates(): Map<string, CameraState> {
        return this.cameraStates;
    }

    /**
     * Check if Redis is connected
     */
    isConnected(): boolean {
        return this.redisManager.getConnectionStatus();
    }

    /**
     * @description Subscribe to frames for a specific camera
     * Increment viewer count, and provide routine to unsubscribe
     * @returns a callback function to unsubscribe
     */
    subscribeToCamera(cameraId: string, listener: FrameListener): () => void {
        // Get or create listeners set for this camera
        let listeners = this.frameListeners.get(cameraId);
        if (!listeners) {
            listeners = new Set();
            this.frameListeners.set(cameraId, listeners);
        }

        // Add the listener
        listeners.add(listener);

        // Increment viewer count
        const state = this.cameraStates.get(cameraId);
        if (state) {
            state.viewerCount++;
        }

        // Return unsubscribe function
        return () => {
            listeners?.delete(listener);

            // Decrement viewer count
            const state = this.cameraStates.get(cameraId);
            if (state && state.viewerCount > 0) {
                state.viewerCount--;
            }

            // Clean up empty listener sets
            if (listeners?.size === 0) {
                this.frameListeners.delete(cameraId);
            }
        };
    }

    /**
     * Start recording frames to disk
     */
    async startRecording(): Promise<any> {
        return await this.frameRecorder.startRecording();
    }

    /**
     * Stop recording frames
     */
    async stopRecording(): Promise<void> {
        return await this.frameRecorder.stopRecording();
    }

    /**
     * Get current recording status
     */
    getRecordingStatus(): any {
        return this.frameRecorder.getStatus();
    }

    /**
     * Gracefully shutdown the camera service
     */
    async shutdown(): Promise<void> {
        console.log('Shutting down camera service...');
        await this.redisManager.disconnect();
    }
}
