// src/services/camera_service.ts
import { RedisManager, type HoleNotification } from './redis_manager.ts';
import { FrameRecorder } from './frame_recorder.ts';
import type { CameraFrame, CameraState } from '../types/camera.types.ts';

type FrameListener = (frame: Buffer) => void;
type HoleListener = (notification: HoleNotification) => void;

export class CameraService {
    private redisManager: RedisManager;
    private cameraStates: Map<string, CameraState> = new Map();
    private frameListeners: Map<string, Set<FrameListener>> = new Map();
    private holeListeners: Set<HoleListener> = new Set();
    private frameRecorder: FrameRecorder;

    // FPS tracking
    private frameCount: number = 0;
    private lastFpsLog: number = Date.now();

    constructor() {
        this.redisManager = new RedisManager();
        this.frameRecorder = new FrameRecorder();

        // Register frame handler
        this.redisManager.onFrame((frame: CameraFrame) => {
            this.handleFrame(frame);
        });

        // Register hole notification handler
        this.redisManager.onHoleNotification((notification: HoleNotification) => {
            this.handleHoleNotification(notification);
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
     * Handle incoming camera frames from Redis Stream
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

        // Track FPS
        this.frameCount++;
        this.logFpsIfNeeded();

        // Notify all listeners for this camera
        const listeners = this.frameListeners.get(cameraId);
        if (listeners && listeners.size > 0) {
            listeners.forEach(listener => listener(frameData));
        }
    }

    /**
     * Handle hole notification from Python brain
     */
    private handleHoleNotification(notification: HoleNotification): void {
        console.log(`[HoleNotification] Hole detected at (${notification.x}, ${notification.y})`);

        // Notify all hole listeners
        this.holeListeners.forEach(listener => listener(notification));
    }

    /**
     * Log FPS stats periodically
     */
    private logFpsIfNeeded(): void {
        const now = Date.now();
        const elapsed = now - this.lastFpsLog;

        if (elapsed >= 5000) {
            const fps = ((this.frameCount / elapsed) * 1000).toFixed(1);
            console.log(`[CameraService] ${fps} FPS (${this.frameCount} frames in ${(elapsed / 1000).toFixed(1)}s)`);

            this.frameCount = 0;
            this.lastFpsLog = now;
        }
    }

    /**
     * Get list of available camera IDs
     */
    getAvailableCameras(): string[] {
        return Array.from(this.cameraStates.keys());
    }

    /**
     * Discover available streams and return camera IDs
     * This scans Redis for streams matching the pattern
     */
    async discoverCameras(): Promise<string[]> {
        return await this.redisManager.discoverStreams();
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
     * Subscribe to frames for a specific camera
     */
    subscribeToCamera(cameraId: string, listener: FrameListener): () => void {
        let listeners = this.frameListeners.get(cameraId);
        if (!listeners) {
            listeners = new Set();
            this.frameListeners.set(cameraId, listeners);
        }

        listeners.add(listener);

        const state = this.cameraStates.get(cameraId);
        if (state) {
            state.viewerCount++;
        }

        return () => {
            listeners?.delete(listener);

            const state = this.cameraStates.get(cameraId);
            if (state && state.viewerCount > 0) {
                state.viewerCount--;
            }

            if (listeners?.size === 0) {
                this.frameListeners.delete(cameraId);
            }
        };
    }

    /**
     * Subscribe to hole notifications
     */
    subscribeToHoleNotifications(listener: HoleListener): () => void {
        this.holeListeners.add(listener);

        return () => {
            this.holeListeners.delete(listener);
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
