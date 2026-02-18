/**
 * Frame Recorder Service
 * Handles recording of raw JPEG frames from camera streams to disk
 * for algorithm development and regression testing
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Redis } from 'ioredis';
import { initializeConfig } from '../config/index.ts';
import type { AppConfig } from '../config/index.ts';

interface RecordingSession {
  sessionId: string;           // YYYY-MM-DD_HH-mm-ss
  basePath: string;            // From FRAME_SAVE_PATH
  sessionPath: string;         // basePath/sessionId
  startTime: Date;
  isRecording: boolean;
  frameCounters: Map<string, number>;  // Per-camera frame counter
  lastTimestamps: Map<string, string>; // track unique frames
  cameras: Set<string>;        // Cameras recorded in this session
}

export class FrameRecorder {
  private config: AppConfig;
  private currentSession: RecordingSession | null = null;

  constructor() {
    this.config = initializeConfig();
  }

  /**
   * Start a new recording session
   * Creates timestamped directory structure
   */
  async startRecording(): Promise<RecordingSession> {
    if (this.currentSession?.isRecording) {
      throw new Error('Recording already in progress');
    }

    const sessionId = this.generateSessionId();  // YYYY-MM-DD_HH-mm-ss
    const basePath = this.config.recording.savePath;
    const sessionPath = path.join(basePath, sessionId);

    // Create session directory
    await fs.mkdir(sessionPath , { recursive: true });

    this.currentSession = {
      sessionId,
      basePath,
      sessionPath,
      startTime: new Date(),
      isRecording: true,
      frameCounters: new Map(),
      lastTimestamps: new Map(),
      cameras: new Set(),
    };

    console.log(`Recording started: ${sessionPath}`);
    return this.currentSession;
  }

  /**
   * Stop current recording session
   * Writes session metadata to disk
   */
  async stopRecording(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active recording session');
    }

    this.currentSession.isRecording = false;

    // Write session metadata
    await this.writeSessionMetadata();

    console.log(`Recording stopped: ${this.currentSession.sessionPath}`);
    this.currentSession = null;
  }

  /**
   * Record a single frame (called from CameraService)
   */
  async recordFrame(cameraId: string, redisClient: Redis): Promise<void> {
    if (!this.currentSession?.isRecording) return;
    const session = this.currentSession;

    try {
      const hiresKey = `camera_hires:${cameraId}`;

      // Get only the timestamp string
      const newTimestamp = await redisClient.hget(hiresKey, 'timestamp');
      const lastTs = session.lastTimestamps.get(cameraId);

      // is this frame has already recorded
      if (!newTimestamp || newTimestamp === lastTs) return;

      // pull the big buffer
      const hiresBuffer = await redisClient.hgetBuffer(hiresKey, 'image');

      if (hiresBuffer) {
        // Update tracking
        session.lastTimestamps.set(cameraId, newTimestamp);

        const counter = (session.frameCounters.get(cameraId) || 0) + 1;
        session.frameCounters.set(cameraId, counter);

        // Build path
        const cameraDir = path.join(session.sessionPath, cameraId);
        if (!session.cameras.has(cameraId)){
            console.log(`[FrameRecorder] First frame for ${cameraId}, creating: ${cameraDir}`);
            await fs.mkdir(cameraDir, { recursive: true });
            session.cameras.add(cameraId);
        }
        const filename = `frame_${counter.toString().padStart(4, '0')}.jpg`;
        const filePath = path.join(cameraDir, filename);


        // Non blocking write
        fs.writeFile(filePath, hiresBuffer).catch(err => {
          console.error(`Failed to write high-res frame ${filePath}:`, err);
        });
      }
    } catch (err) {
      console.error(`[FrameRecorder] Error for ${cameraId}:`, err);
    }
  }

  /**
   * Get current session status
   */
  getStatus(): RecordingSession | null {
    return this.currentSession;
  }

  /**
   * Generate session ID from timestamp
   */
  private generateSessionId(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
  }

  /**
   * Write session metadata JSON file
   */
  private async writeSessionMetadata(): Promise<void> {
    if (!this.currentSession) return;

    const session = this.currentSession;
    const metadata = {
      sessionId: session.sessionId,
      startTime: session.startTime.toISOString(),
      endTime: new Date().toISOString(),
      cameras: Array.from(session.cameras),
      frameCounts: Object.fromEntries(session.frameCounters),
      totalFrames: Array.from(session.frameCounters.values()).reduce((a, b) => a + b, 0),
    };

    const metadataPath = path.join(session.sessionPath, 'session_info.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }
}
