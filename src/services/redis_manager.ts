// src/services/redis_manager.ts
import { Redis } from 'ioredis';
import { initializeConfig } from '../config/index.ts';
import type { CameraFrame } from '../types/camera.types.ts';

export interface HoleNotification {
    x: number;
    y: number;
    timestamp: number;
}

export class RedisManager {
    // ioredis clients
    private streamClient: Redis;
    private pubsubClient: Redis;
    private scanClient: Redis;

    private config = initializeConfig();
    private isConnected: boolean = false;
    private isReading: boolean = false;

    private frameCallback?: (frame: CameraFrame) => void;
    private holeCallback?: (notification: HoleNotification) => void;

    private activeStreams: Map<string, string> = new Map();
    private discoveryInterval: NodeJS.Timeout | null = null;

    // Debug flag
    private loggedFirstFrame: boolean = false;

    constructor() {
        const redisConfig = {
            host: this.config.redis.host,
            port: this.config.redis.port,
            // ioredis returns Buffers by default for binary data
            // but we can also explicitly request it
            retryStrategy: (times: number) => {
                if (times > 10) {
                    console.error('Redis: Max reconnection attempts reached');
                    return null;
                }
                return Math.min(times * 500, 5000);
            }
        };

        this.streamClient = new Redis(redisConfig);
        this.pubsubClient = new Redis(redisConfig);
        this.scanClient = new Redis(redisConfig);

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.streamClient.on('error', (err: Error) => console.error('Redis Stream error:', err));
        this.streamClient.on('ready', () => {
            console.log('Redis Stream client ready');
            this.isConnected = true;
        });
        this.streamClient.on('close', () => {
            console.log('Redis Stream client disconnected');
            this.isConnected = false;
        });

        this.pubsubClient.on('error', (err: Error) => console.error('Redis PubSub error:', err));
        this.scanClient.on('error', (err: Error) => console.error('Redis Scan error:', err));
    }

    public getConnectionStatus(): boolean {
        return this.isConnected;
    }

    async connect(): Promise<void> {
        try {
            // ioredis connects automatically, but we wait for ready
            await Promise.all([
                this.waitForReady(this.streamClient),
                this.waitForReady(this.pubsubClient),
                this.waitForReady(this.scanClient),
            ]);

            console.log(`Connected to Redis at ${this.config.redis.host}:${this.config.redis.port}`);

            await this.subscribeToHoleNotifications();
            await this.discoverStreams();
            this.startStreamDiscovery();
            this.startStreamReader();
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            throw error;
        }
    }

    private waitForReady(client: Redis): Promise<void> {
        return new Promise((resolve, reject) => {
            if (client.status === 'ready') {
                resolve();
                return;
            }
            client.once('ready', () => resolve());
            client.once('error', (err: Error) => reject(err));
        });
    }

    async discoverStreams(): Promise<string[]> {
        const pattern = this.config.redis.streamPattern;
        const discoveredStreams = new Set<string>();

        try {
            let cursor = '0';
            do {
                // ioredis scanStream or manual scan
                const [newCursor, keys] = await this.scanClient.scan(
                    cursor,
                    'MATCH', pattern,
                    'COUNT', '100',
                    'TYPE', 'stream'
                );
                cursor = newCursor;
                keys.forEach((key: string) => discoveredStreams.add(key));
            } while (cursor !== '0');

            for (const streamName of discoveredStreams) {
                if (!this.activeStreams.has(streamName)) {
                    this.activeStreams.set(streamName, '$');
                    console.log(`Discovered stream: ${streamName}`);
                }
            }

            // Return extracted camera IDs
            const cameraIds: string[] = [];
            for (const streamName of this.activeStreams.keys()) {
                const cameraId = this.extractCameraId(streamName) || streamName;
                cameraIds.push(cameraId);
            }
            return cameraIds;
        } catch (e) {
            console.error('Stream discovery error:', e);
            return [];
        }
    }

    private startStreamDiscovery(): void {
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
        }
        this.discoveryInterval = setInterval(() => this.discoverStreams(), 5000);
    }

    private async subscribeToHoleNotifications(): Promise<void> {
        try {
            await this.pubsubClient.subscribe(this.config.redis.holeNotificationChannel);

            this.pubsubClient.on('message', (channel: string, message: string) => {
                if (channel === this.config.redis.holeNotificationChannel) {
                    try {
                        const data = JSON.parse(message);
                        if (this.holeCallback) {
                            this.holeCallback({ ...data, timestamp: Date.now() });
                        }
                    } catch (e) {
                        console.error('PubSub parse error:', e);
                    }
                }
            });

            console.log(`Subscribed to hole notifications: ${this.config.redis.holeNotificationChannel}`);
        } catch (error) {
            console.error('Failed to subscribe to hole notifications:', error);
        }
    }

    private async startStreamReader(): Promise<void> {
        if (this.isReading) return;
        this.isReading = true;

        console.log(`[RedisManager] Stream reader started`);

        while (this.isReading && this.isConnected) {
            try {
                if (this.activeStreams.size === 0) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }

                // Build XREAD arguments for ioredis
                // Format: XREAD BLOCK ms COUNT n STREAMS key1 key2 ... id1 id2 ...
                const keys = Array.from(this.activeStreams.keys());
                const ids = Array.from(this.activeStreams.values());

                // Use xreadBuffer to get binary data as Buffers
                // ioredis signature: xreadBuffer('BLOCK', ms, 'COUNT', n, 'STREAMS', ...keys, ...ids)
                const response = await this.streamClient.xreadBuffer(
                    'COUNT', 1,
                    'BLOCK', 1000,
                    'STREAMS', ...keys, ...ids
                ) as [Buffer, [Buffer, Buffer[]][]][] | null;

                if (response) {
                    // ioredis xreadBuffer returns: [[streamName, [[entryId, [field, value, ...]]]]]
                    for (const [streamNameBuf, entries] of response) {
                        const streamName = streamNameBuf.toString();

                        for (const [entryIdBuf, fields] of entries) {
                            const entryId = entryIdBuf.toString();

                            // fields is [field1, value1, field2, value2, ...]
                            const message: Record<string, Buffer> = {};
                            for (let i = 0; i < fields.length; i += 2) {
                                const fieldName = fields[i]!.toString();
                                const fieldValue = fields[i + 1]!; // Keep as Buffer
                                message[fieldName] = fieldValue;
                            }

                            this.handleStreamEntry(streamName, entryId, message);
                            this.activeStreams.set(streamName, entryId);
                        }
                    }
                }
            } catch (error) {
                if (this.isReading) {
                    console.error('[RedisManager] XREAD Error:', error);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }

        console.log('[RedisManager] Stream reader stopped');
    }

    private handleStreamEntry(streamName: string, id: string, message: Record<string, Buffer>): void {
        const frameData = message['image'];

        if (!frameData) {
            console.warn(`[RedisManager] No 'image' field in message from ${streamName}`);
            return;
        }

        // Debug: Log first frame details
        if (!this.loggedFirstFrame) {
            this.loggedFirstFrame = true;
            const isBuffer = Buffer.isBuffer(frameData);
            const header = frameData.slice(0, 4).toString('hex');
            const isValidJPEG = frameData.length >= 2 && frameData[0] === 0xFF && frameData[1] === 0xD8;
            console.log(`[RedisManager] First frame: isBuffer=${isBuffer}, length=${frameData.length}, header=${header}, validJPEG=${isValidJPEG}`);
        }

        // Extract camera ID from stream name
        const cameraId = this.extractCameraId(streamName) || streamName;

        if (this.frameCallback) {
            this.frameCallback({ cameraId, frameData, timestamp: new Date() });
        }
    }

    private extractCameraId(streamName: string): string | null {
        const parts = streamName.split(':');
        return parts.length > 1 ? (parts[1] ?? null) : null;
    }

    onFrame(callback: (frame: CameraFrame) => void): void {
        this.frameCallback = callback;
    }

    onHoleNotification(callback: (notification: HoleNotification) => void): void {
        this.holeCallback = callback;
    }

    async disconnect(): Promise<void> {
        this.isReading = false;

        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }

        try {
            await this.pubsubClient.unsubscribe();
            await Promise.all([
                this.streamClient.quit(),
                this.pubsubClient.quit(),
                this.scanClient.quit(),
            ]);
            console.log('Redis clients disconnected');
        } catch (error) {
            console.error('Error disconnecting from Redis:', error);
        }
    }
}
