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

    // Track if we've subscribed
    private isSubscribed: boolean = false;

    constructor() {
        this.subscriber = createClient({
            socket: {
                host: this.config.redis.host,
                port: this.config.redis.port,
                // Enable automatic reconnection with exponential backoff
                reconnectStrategy: (retries: number) => {
                    if (retries > 10) {
                        console.error('Redis: Max reconnection attempts reached');
                        return new Error('Max reconnection attempts reached');
                    }
                    const delay = Math.min(retries * 100, 3000);
                    console.log(`Redis: Reconnecting in ${delay}ms (attempt ${retries})`);
                    return delay;
                },
            },
            // Don't decode responses
            disableOfflineQueue: false,
        });

        // Set up error handlers
        this.subscriber.on('error', (err) => {
            console.error('Redis subscriber error:', err);
            // Don't set isConnected = false here, let 'disconnect' event handle it
        });

        this.subscriber.on('connect', () => {
            console.log('Redis subscriber connected');
            this.isConnected = true;
        });

        this.subscriber.on('ready', async () => {
            console.log('Redis subscriber ready');
            this.isConnected = true;

            // Re-subscribe after reconnection (subscriptions are lost on disconnect)
            if (!this.isSubscribed) {
                console.log('Redis: Re-subscribing to channels after reconnection');
                try {
                    await this.setupPatternSubscription();
                } catch (error) {
                    console.error('Redis: Failed to re-subscribe:', error);
                }
            }
        });

        this.subscriber.on('reconnecting', () => {
            console.log('Redis subscriber reconnecting...');
            this.isConnected = false;
            this.isSubscribed = false; // Subscriptions are lost
        });

        this.subscriber.on('disconnect', () => {
            console.log('Redis subscriber disconnected');
            this.isConnected = false;
            this.isSubscribed = false; // Subscriptions are lost
        });

        this.subscriber.on('end', () => {
            console.log('Redis subscriber connection ended');
            this.isConnected = false;
            this.isSubscribed = false; // Subscriptions are lost
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
        // Avoid double-subscription
        if (this.isSubscribed) {
            console.log('Redis: Already subscribed, skipping');
            return;
        }

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

            this.isSubscribed = true;
            console.log(`Subscribed to pattern: ${this.config.redis.channelPattern}`);

        } catch (error) {
            console.error('Failed to set up pattern subscription:', error);
            this.isSubscribed = false;
            throw error;
        }
    }

    /**
     * Handle incoming messages from Redis
     * @description
     * Extract camera ID from channel name (e.g., "camera_stream:cam1" -> "cam1")
     * Validates JPEG format and passes frame to callback with server timestamp
     */
    private handleMessage(message: Buffer, channel: string): void {
        // Capture server timestamp immediately when frame arrives from Redis
        const serverTimestamp = Date.now();

        const cameraId = this.extractCameraId(channel);

        if (!cameraId) {
            console.warn(`Could not extract camera ID from channel: ${channel}`);
            return;
        }

        // Validate JPEG format (SOI marker: 0xFFD8, EOI marker: 0xFFD9)
        const isValidJPEG =
            message.length >= 2 &&
            message[0] === 0xFF &&
            message[1] === 0xD8 &&
            message[message.length - 2] === 0xFF &&
            message[message.length - 1] === 0xD9;

        if (!isValidJPEG) {
            console.error(
                `[Redis] Invalid JPEG data from ${cameraId}: ` +
                `length=${message.length}, ` +
                `header=${message.slice(0, 2).toString('hex')}, ` +
                `footer=${message.slice(-2).toString('hex')}`
            );
            return;
        }

        const frame: CameraFrame = {
            cameraId,
            frameData: message,
            timestamp: new Date(),
            serverTimestamp,
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