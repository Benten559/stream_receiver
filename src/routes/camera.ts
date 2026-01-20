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
 * @returns the latest JPEG frame for the specified camera
 */
cameraRouter.get('/frame/:cameraId', (req: Request, res: Response<Buffer | ErrorResponse>) => {
    const { cameraId } = req.params;
    const frame = cameraService.getLatestFrame(cameraId);

    if (!frame) {
        res.status(404).json({ error: `No frame available for camera: ${cameraId}` });
        return;
    }

    // Send JPEG image
    res.set('Content-Type', 'image/jpeg');
    res.send(frame);
});

/**
 * GET /camera/stream/:cameraId
 * MJPEG stream endpoint - multipart/x-mixed-replace stream for video
 * Can be used directly in an <img> tag: <img src="/camera/stream/cam1">
 */
cameraRouter.get('/stream/:cameraId', (req: Request, res: Response) => {
    const { cameraId } = req.params;

    if (!cameraId) {
        res.status(400).json({ error: 'Camera ID is required' });
        return;
    }

    // Set headers for MJPEG stream
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`Client connected to MJPEG stream: ${cameraId}`);

    // Subscribe to camera frames (serverTimestamp not used for MJPEG)
    const unsubscribe = cameraService.subscribeToCamera(cameraId, (frameData: Buffer, _serverTimestamp: number) => {
        // Check if response is still writable before attempting write
        if (!res.writable) {
            console.log(`Response not writable for ${cameraId}, unsubscribing`);
            unsubscribe();
            return;
        }

        try {
            // Send frame in multipart format
            res.write('--frame\r\n');
            res.write('Content-Type: image/jpeg\r\n');
            res.write(`Content-Length: ${frameData.length}\r\n`);
            res.write('\r\n');
            res.write(frameData);
            res.write('\r\n');
        } catch (err) {
            console.error(`Error writing frame for camera ${cameraId}:`, err);
            unsubscribe();
        }
    });

    // Send initial frame if available
    const initialFrame = cameraService.getLatestFrame(cameraId);
    if (initialFrame) {
        try {
            res.write('--frame\r\n');
            res.write('Content-Type: image/jpeg\r\n');
            res.write(`Content-Length: ${initialFrame.length}\r\n`);
            res.write('\r\n');
            res.write(initialFrame);
            res.write('\r\n');
        } catch (err) {
            console.error(`Error writing initial frame for camera ${cameraId}:`, err);
            unsubscribe();
        }
    }

    req.on('close', () => {
        console.log(`Client disconnected from MJPEG stream: ${cameraId}`);
        unsubscribe();
        res.end();
    });

    req.on('error', (err) => {
        console.error(`Request error for camera ${cameraId}:`, err);
        unsubscribe();
    });
});

/**
 * GET /camera/stream/:cameraId/sse
 * Server-Sent Events endpoint for real-time frame streaming (alternative to MJPEG)
 */
cameraRouter.get('/stream/:cameraId/sse', (req: Request, res: Response) => {
    const { cameraId } = req.params;

    if (!cameraId) {
        res.status(400).json({ error: 'Camera ID is required' });
        return;
    }

    // headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial comment to establish connection
    res.write(': connected\n\n');

    console.log(`Client connected to SSE stream: ${cameraId}`);

    // Subscribe to camera frames
    const unsubscribe = cameraService.subscribeToCamera(cameraId, (frameData: Buffer, serverTimestamp: number) => {
        // Check if response is still writable BEFORE attempting write
        if (!res.writable) {
            console.log(`SSE response not writable for ${cameraId}, unsubscribing`);
            unsubscribe();
            return;
        }

        try {
            // Convert frame to base64 for transmission
            const base64Frame = frameData.toString('base64');

            // Send JSON with frame data AND server timestamp for accurate age detection
            const framePayload = JSON.stringify({
                data: base64Frame,
                serverTimestamp,
            });

            res.write(`event: frame\n`);
            res.write(`data: ${framePayload}\n\n`);
        } catch (err) {
            console.error(`Error writing SSE frame for camera ${cameraId}:`, err);
            unsubscribe();
        }
    });

    const initialFrame = cameraService.getLatestFrame(cameraId);
    if (initialFrame) {
        try {
            const base64Frame = initialFrame.toString('base64');
            // Use current time for initial frame (it's being sent immediately)
            const framePayload = JSON.stringify({
                data: base64Frame,
                serverTimestamp: Date.now(),
            });
            res.write(`event: frame\n`);
            res.write(`data: ${framePayload}\n\n`);
        } catch (err) {
            console.error(`Error writing initial SSE frame for camera ${cameraId}:`, err);
            unsubscribe();
        }
    }

    req.on('close', () => {
        console.log(`Client disconnected from SSE stream: ${cameraId}`);
        unsubscribe();
        res.end();
    });

    req.on('error', (err) => {
        console.error(`Request error for SSE camera ${cameraId}:`, err);
        unsubscribe();
    });
});

/**
 * POST /camera/recording/start
 * Start a new recording session
 */
cameraRouter.post('/recording/start', async (req: Request, res: Response) => {
    try {
        const session = await cameraService.startRecording();
        res.json({
            success: true,
            session: {
                sessionId: session.sessionId,
                sessionPath: session.sessionPath,
                startTime: session.startTime,
            },
        });
    } catch (error: any) {
        res.status(400).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /camera/recording/stop
 * Stop the current recording session
 */
cameraRouter.post('/recording/stop', async (req: Request, res: Response) => {
    try {
        await cameraService.stopRecording();
        res.json({
            success: true,
            message: 'Recording stopped',
        });
    } catch (error: any) {
        res.status(400).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /camera/recording/status
 * Get current recording session status
 */
cameraRouter.get('/recording/status', (req: Request, res: Response) => {
    const status = cameraService.getRecordingStatus();

    if (!status) {
        res.json({
            isRecording: false,
        });
        return;
    }

    const frameCountsArray = Array.from(status.frameCounters.values()) as number[];
    const totalFrames = frameCountsArray.reduce((a, b) => a + b, 0);

    res.json({
        isRecording: status.isRecording,
        sessionId: status.sessionId,
        sessionPath: status.sessionPath,
        startTime: status.startTime,
        cameras: Array.from(status.cameras),
        frameCounts: Object.fromEntries(status.frameCounters),
        totalFrames,
    });
});

export default cameraRouter;