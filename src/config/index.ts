export interface AppConfig {
    redis: {
        host: string;
        port: number;
        channelPattern: string;
    };
    server: {
        port: number;
    };
    camera: {
        unsubscribeDelay: number;  // Seconds to wait before unsubscribing
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
            channelPattern: process.env.REDIS_CHANNEL_PATTERN || 'camera_stream:*',
        },
        server: {
            port: parseInt(process.env.SERVER_PORT || '5000', 10),
        },
        camera: {
            unsubscribeDelay: parseInt(process.env.UNSUBSCRIBE_DELAY || '30', 10),
        },
        recording: {
            savePath: process.env.FRAME_SAVE_PATH || './data/frames',
        },
    };
};