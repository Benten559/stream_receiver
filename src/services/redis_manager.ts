import { Redis } from 'ioredis';
import { initializeConfig } from '../config/index.ts';
import type { CameraFrame } from '../types/camera.types.ts';

export interface HoleNotification {
    x: number;
    y: number;
    timestamp: number;
}

export class RedisManager {
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
    private loggedFirstFrame: boolean = false;

    // FPS for debugging
    private frameCount: number = 0;
    private lastLogTime: number = Date.now();

    constructor() {
        const redisConfig = {
            host: this.config.redis.host,
            port: this.config.redis.port,
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

    public getClient(): Redis {
        return this.streamClient;
    }

    async connect(): Promise<void> {
        try {
            await Promise.all([
                this.waitForReady(this.streamClient),
                this.waitForReady(this.pubsubClient),
                this.waitForReady(this.scanClient),
            ]);

            console.log(`Connected to Redis at ${this.config.redis.host}:${this.config.redis.port}`);

            await this.subscribeToHoleNotifications();
            await this.discoverStreams();
            await this.clearOldFrames();
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
                    console.log(`Discovered stream: ${streamName} starting from latest`);
                }
            }

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

    /**
     * On a fresh connection anything buffered will be trimmed off
     */
    private async clearOldFrames(): Promise<void> {
        try {
            for (const streamName of this.activeStreams.keys()) {
                await this.streamClient.xtrim(streamName, 'MAXLEN', 1);
                console.log(`[RedisManager] Cleared old frames from ${streamName}`);
            }
        } catch (error) {
            console.error('Failed to clear old frames:', error);
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

    /**
     * XREVRANGE to always get the absolute latest frame
     */
    private async startStreamReader(): Promise<void> {
        if (this.isReading) return;
        this.isReading = true;

        // Track multiple lastIds
        const streamsToRead = [
            "camera_stream:raspberrypi",
            "camera_stream:processed"
        ];
        let lastIds = streamsToRead.map(() => '$');

        while (this.isReading && this.isConnected) {
            try {
                const data = await this.streamClient.xreadBuffer(
                    'COUNT', 1,
                    'BLOCK', 0,
                    'STREAMS', ...streamsToRead, ...lastIds
                );

                if (data) {
                    for (const [streamNameBuffer, entries] of data) {
                        const streamName = streamNameBuffer.toString();

                        // Check if entries array has items before destructuring
                        if (entries.length > 0) {
                            const entry = entries[0];
                            if (entry) {
                                const [idBuffer, fields] = entry;

                                // Update the specific lastId for this stream
                                const streamIndex = streamsToRead.indexOf(streamName);
                                if (streamIndex !== -1) lastIds[streamIndex] = idBuffer.toString();

                                const message: Record<string, Buffer> = {};
                                for (let i = 0; i < fields.length; i += 2) {
                                    const key = fields[i];
                                    const value = fields[i + 1];
                                    if (key && value) {
                                        message[key.toString()] = value;
                                    }
                                }

                                this.handleStreamEntry(streamName, idBuffer.toString(), message);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('[RedisManager] XREAD Error:', error);
                await new Promise(r => setTimeout(r, 1000));
            }
        }
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

        // Log frame rate every 2 seconds
        this.frameCount++;
        const now = Date.now();
        if (now - this.lastLogTime >= 2000) {
            const fps = this.frameCount / ((now - this.lastLogTime) / 1000);
            console.log(`[RedisManager] Consumer FPS: ${fps.toFixed(1)}`);
            this.frameCount = 0;
            this.lastLogTime = now;
        }

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

    async publishCommand(channel: string, command: string): Promise<number> {
        return this.scanClient.publish(channel, command);
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
