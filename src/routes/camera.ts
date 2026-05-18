import type { Request, Response } from 'express';
import { Router } from 'express';
import { cameraService } from '../server.ts';
import type { AvailableCamerasResponse, ErrorResponse } from '../types/api.types.ts';

const cameraRouter = Router();

/**
 * GET /camera/available
 * @returns list of available camera IDs that are currently streaming
 */
cameraRouter.get('/available', (req: Request, res: Response<AvailableCamerasResponse>) => {
    const cameras = cameraService.getAvailableCameras();
    res.json({
        cameras,
        count: cameras.length,
    });
});

/**
 * GET /camera/discover
 * Triggers stream discovery and returns available camera IDs
 */
cameraRouter.get('/discover', async (req: Request, res: Response<AvailableCamerasResponse>) => {
    const cameras = await cameraService.discoverCameras();
    res.json({
        cameras,
        count: cameras.length,
    });
});

/**
 * GET /camera/debug/:cameraId
 * Debug endpoint - serves a single JPEG frame with validation info
 * Use this to test if binary data from Redis is valid
 */
cameraRouter.get('/debug/:cameraId', (req: Request, res: Response) => {
    const { cameraId } = req.params;
    const frame = cameraService.getLatestFrame(cameraId);

    if (!frame) {
        res.status(404).json({ error: `No frame for camera: ${cameraId}`, availableCameras: cameraService.getAvailableCameras() });
        return;
    }

    const isBuffer = Buffer.isBuffer(frame);
    const typeName = frame?.constructor?.name || typeof frame;
    const header = isBuffer ? frame.slice(0, 4).toString('hex') : 'N/A';
    const isValidJPEG = isBuffer && frame.length >= 2 && frame[0] === 0xFF && frame[1] === 0xD8;

    // Log debug info
    console.log(`[DEBUG] Frame for ${cameraId}: type=${typeName}, isBuffer=${isBuffer}, length=${frame.length}, header=${header}, validJPEG=${isValidJPEG}`);

    if (!isValidJPEG) {
        res.status(500).json({
            error: 'Invalid JPEG data',
            type: typeName,
            isBuffer,
            length: frame.length,
            header,
            firstBytes: isBuffer ? [...frame.slice(0, 10)] : []
        });
        return;
    }

    // Serve as JPEG image
    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Length', String(frame.length));
    res.send(frame);
});

/**
 * GET /camera/status
 * @returns detailed status information for debugging
 */
cameraRouter.get('/status', (req: Request, res: Response) => {
    const cameras = cameraService.getAvailableCameras();
    const cameraStates = cameraService.getAllCameraStates();
    const isConnected = cameraService.isConnected();

    const statesInfo = Array.from(cameraStates.entries()).map(([id, state]) => ({
        cameraId: id,
        viewerCount: state.viewerCount,
        hasFrame: state.latestFrame !== null,
        frameSize: state.latestFrame?.length || 0,
        lastSeen: state.lastSeen.toISOString(),
    }));

    res.json({
        redisConnected: isConnected,
        availableCameras: cameras,
        cameraCount: cameras.length,
        cameraStates: statesInfo,
        timestamp: new Date().toISOString(),
    });
});

/**
 * GET /camera/frame/:cameraId
 */
cameraRouter.get('/frame/:cameraId', (req: Request, res: Response<Buffer | ErrorResponse>) => {
    const { cameraId } = req.params;
    if (!cameraId) {
        res.status(400).json({ error: 'Camera ID is required' });
        return;
    }

    const frame = cameraService.getLatestFrame(cameraId);
    if (!frame) {
        res.status(404).json({ error: `No frame available for camera: ${cameraId}` });
        return;
    }

    res.set('Content-Type', 'image/jpeg');
    res.send(frame);
});

/**
 * GET /camera/stream/:cameraId
 * MJPEG stream endpoint (Binary multipart)
 */
cameraRouter.get('/stream/:cameraId', (req: Request, res: Response) => {
    const { cameraId } = req.params;

    if (!cameraId) {
        res.status(400).json({ error: 'Camera ID is required' });
        return;
    }

    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    let isWriting = false;

const unsubscribe = cameraService.subscribeToCamera(cameraId, (frameData: Buffer) => {
    // If the previous frame is still being pushed to the network, 
    // DROP this current frame to keep the stream 'Live'.
    if (isWriting || !res.writable) return;

    isWriting = true;
    try {
        res.write('--frame\r\n');
        res.write('Content-Type: image/jpeg\r\n');
        res.write(`Content-Length: ${frameData.length}\r\n`);
        res.write('\r\n');
        
        // Pass a callback to res.write to reset 'isWriting' only 
        // after the data has actually been cleared from the buffer
        res.write(frameData, () => {
            res.write('\r\n');
            isWriting = false; 
        });
    } catch (err) {
        isWriting = false;
        unsubscribe();
    }
});

    req.on('close', () => unsubscribe());
});

/**
 * GET /camera/holes/sse
 */
cameraRouter.get('/holes/sse', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(': connected\n\n');

    const unsubscribe = cameraService.subscribeToHoleNotifications((notification) => {
        if (!res.writable) {
            unsubscribe();
            return;
        }

        try {
            const payload = JSON.stringify({
                x: notification.x,
                y: notification.y,
                timestamp: notification.timestamp,
            });
            res.write(`event: hole\n`);
            res.write(`data: ${payload}\n\n`);
        } catch (err) {
            unsubscribe();
        }
    });

    req.on('close', () => unsubscribe());
});

/**
 * POST /camera/command
 * Publishes a command string to the Python backend via Redis pub/sub
 */
const VALID_COMMANDS = new Set([
    'reset',
    'calibrate',
    'reset_calibration',
    'toggle_off',
    'toggle_on',
    'stream_view_on',
    'stream_view_off',
]);

cameraRouter.post('/command', async (req: Request, res: Response) => {
    const { command } = req.body;

    if (!command || typeof command !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "command" field' });
        return;
    }

    if (!VALID_COMMANDS.has(command)) {
        res.status(400).json({
            error: `Unknown command: '${command}'`,
            validCommands: [...VALID_COMMANDS],
        });
        return;
    }

    try {
        await cameraService.sendCommand(command);
        res.json({ success: true, command });
    } catch (err: any) {
        res.status(500).json({ error: `Failed to publish command: ${err.message}` });
    }
});

/**
 * Recording Routes
 */
cameraRouter.post('/recording/start', async (req: Request, res: Response) => {
    try {
        const session = await cameraService.startRecording();
        res.json({ success: true, session });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

cameraRouter.post('/recording/stop', async (req: Request, res: Response) => {
    try {
        await cameraService.stopRecording();
        res.json({ success: true, message: 'Recording stopped' });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * GET /camera/recording/status
 * FIX: Explicitly typed the reduce accumulator as 'number' to fix TS18046
 */
cameraRouter.get('/recording/status', (req: Request, res: Response) => {
    const status = cameraService.getRecordingStatus();
    if (!status) return res.json({ isRecording: false });

    // Explicitly casting the accumulator 'a' and current value 'b' as numbers
    const totalFrames = Array.from(status.frameCounters.values()).reduce(
        (a: number, b: any) => a + (b as number),
        0
    );

    res.json({
        isRecording: status.isRecording,
        sessionId: status.sessionId,
        sessionPath: status.sessionPath,
        startTime: status.startTime,
        cameras: Array.from(status.cameras),
        frameCounts: Object.fromEntries(status.frameCounters),
        totalFrames
    });
});

export default cameraRouter;