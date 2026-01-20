export interface AppConfig {
    redis: {
        host: string;
        port: number;
        // Pattern for discovering camera streams (e.g., "camera_stream:*")
        streamPattern: string;
        // Pub/Sub channel for hole detection notifications
        holeNotificationChannel: string;
        // How often to scan for new streams (ms)
        streamDiscoveryInterval: number;
    };
    server: {
        port: number;
    };
    recording: {
        savePath: string;  // Base directory for frame storage
    };
}

export const initializeConfig = (): AppConfig => {
    return {
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            streamPattern: process.env.REDIS_STREAM_PATTERN || 'camera_stream:*',
            holeNotificationChannel: process.env.REDIS_HOLE_CHANNEL || 'hole_notifications',
            streamDiscoveryInterval: parseInt(process.env.REDIS_DISCOVERY_INTERVAL || '5000', 10),
        },
        server: {
            port: parseInt(process.env.SERVER_PORT || '5000', 10),
        },
        recording: {
            savePath: process.env.FRAME_SAVE_PATH || './data/frames',
        },
    };
};