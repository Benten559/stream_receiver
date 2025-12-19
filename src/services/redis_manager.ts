// src/services/RedisManager.ts
import redis from 'redis';
import { initializeConfig } from '../config/index.ts';
import type { CameraFrame } from '../types/camera.types.ts';

const { createClient } = redis;
type RedisClientType = ReturnType<typeof createClient>;

export class RedisManager {
    private subscriber: RedisClientType;
    private config = initializeConfig();
    private isConnected: boolean = false;
    private frameCallback?: (frame: CameraFrame) => void;

    constructor() {
        this.subscriber = createClient({
            socket: {
                host: this.config.redis.host,
                port: this.config.redis.port,
            },
            // Don't decode responses
            disableOfflineQueue: false,
        });

        // Set up error handlers
        this.subscriber.on('error', (err) => {
            console.error('Redis subscriber error:', err);
        });

        this.subscriber.on('connect', () => {
            console.log('Redis subscriber connected');
            this.isConnected = true;
        });

        this.subscriber.on('disconnect', () => {
            console.log('Redis subscriber disconnected');
            this.isConnected = false;
        });
    }

    /**
     * Connect to Redis and set up pattern subscription
     */
    async connect(): Promise<void> {
        try {
            await this.subscriber.connect();
            console.log(`Connected to Redis at ${this.config.redis.host}:${this.config.redis.port}`);
            
            // Set up pattern subscription
            await this.setupPatternSubscription();
            
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            throw error;
        }
    }

    /**
     * Set up pattern subscription for camera channels
     */
    private async setupPatternSubscription(): Promise<void> {
        try {
            await this.subscriber.pSubscribe(
                this.config.redis.channelPattern,
                (message: Buffer, channel: Buffer) => {
                    // In buffer mode, both message and channel are Buffers
                    const channelString = channel.toString('utf-8');
                    this.handleMessage(message, channelString);
                },
                true // Request bufferMode to get binary data as Buffers
            );

            console.log(`Subscribed to pattern: ${this.config.redis.channelPattern}`);

        } catch (error) {
            console.error('Failed to set up pattern subscription:', error);
            throw error;
        }
    }

    /**
     * Handle incoming messages from Redis
     * @description
     * Extract camera ID from channel name (e.g., "camera_stream:cam1" -> "cam1")
     */
    private handleMessage(message: Buffer, channel: string): void {
        const cameraId = this.extractCameraId(channel);

        if (!cameraId) {
            console.warn(`Could not extract camera ID from channel: ${channel}`);
            return;
        }

        const frame: CameraFrame = {
            cameraId,
            frameData: message,
            timestamp: new Date(),
        };

        if (this.frameCallback) {
            this.frameCallback(frame);
        }
    }

    /**
     * Extract camera ID from channel name
     */
    private extractCameraId(channel: string): string | null {
        // Assumes channel format: "camera_stream:cam1"
        const parts = channel.split(':');
        return parts.length > 1 ? (parts[1] ?? null) : null;
    }

    /**
     * Register a callback to be called when frames arrive
     */
    onFrame(callback: (frame: CameraFrame) => void): void {
        this.frameCallback = callback;
    }

    /**
     * Check if Redis is connected
     */
    getConnectionStatus(): boolean {
        return this.isConnected;
    }

    /**
     * Gracefully disconnect from Redis
     */
    async disconnect(): Promise<void> {
        try {
            await this.subscriber.pUnsubscribe();
            await this.subscriber.quit();
            console.log('Redis subscriber disconnected gracefully');
        } catch (error) {
            console.error('Error disconnecting from Redis:', error);
        }
    }
}