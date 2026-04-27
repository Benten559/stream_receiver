#!/usr/bin/env python3
"""
Raspberry Pi Camera Streamer
Captures frames using Picamera2 and publishes to Redis
"""

import os
import time
import io
import logging
import redis
from picamera2 import Picamera2
from libcamera import Transform

# --- CONFIGURATION FROM ENVIRONMENT ---
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
CAMERA_ID = os.getenv("CAMERA_ID", "raspberrypi")
STREAM_NAME = f"camera_stream:{CAMERA_ID}"

# Camera settings
WIDTH = int(os.getenv("WIDTH", "1920"))
HEIGHT = int(os.getenv("HEIGHT", "1080"))
JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "85"))

# Redis Stream settings
MAX_STREAM_LEN = int(os.getenv("MAX_STREAM_LEN", "1"))
APPROX_TRIM = os.getenv("APPROX_TRIM", "False").lower() == "true"

# Logging
_log_level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(
    level=_log_level,
    format='%(asctime)s - %(levelname)s - %(message)s'
)


class RedisCameraProducer:
    def __init__(self):
        # Initialize Redis connection
        self.redis_client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            decode_responses=False  # Keep binary data
        )

        # Test connection
        try:
            self.redis_client.ping()
            logging.info(f"✓ Redis connected: {REDIS_HOST}:{REDIS_PORT}")
        except redis.ConnectionError as e:
            logging.error(f"✗ Redis connection failed: {e}")
            raise

        # Initialize camera
        self.picam2 = Picamera2()

        # Video configuration for continuous capture
        config = self.picam2.create_video_configuration(
            main={"size": (WIDTH, HEIGHT), "format": "YUV420"},
            transform=Transform(hflip=True, vflip=True)  # Flip upside down
        )

        self.picam2.configure(config)
        logging.info(f"✓ Camera configured: {WIDTH}x{HEIGHT}, flipped 180°")
        logging.info(f"✓ Streaming to: {STREAM_NAME}")

        # Performance tracking
        self.frame_count = 0
        self.last_log = time.time()
        self.running = False

    def start(self):
        """Start camera and streaming loop"""
        self.picam2.start()
        logging.info(f"✓ Camera started")
        self.running = True

        try:
            self._streaming_loop()
        except KeyboardInterrupt:
            logging.info("Shutting down...")
        finally:
            self.stop()

    def _streaming_loop(self):
        """Main capture and publish loop"""
        while self.running:
            try:
                # Capture JPEG directly from hardware
                buf = io.BytesIO()

                # Hardware JPEG encoding
                try:
                    self.picam2.capture_file(buf, format='jpeg', quality=JPEG_QUALITY)
                except TypeError:
                    # Fallback for older Picamera2 versions
                    self.picam2.capture_file(buf, format='jpeg')

                frame_bytes = buf.getvalue()

                self.redis_client.xadd(
                    STREAM_NAME,
                    {"image": frame_bytes},
                    maxlen=MAX_STREAM_LEN,
                    approximate=APPROX_TRIM
                )

                self.frame_count += 1

                # Periodic performance logging
                self._log_performance(frame_bytes)

            except redis.RedisError as e:
                logging.error(f"Redis error: {e}")
                time.sleep(1)  # Back off on error
            except Exception as e:
                logging.error(f"Capture error: {e}")
                time.sleep(0.1)

    def _log_performance(self, frame_bytes):
        """Log FPS and frame size every 2 seconds"""
        now = time.time()
        elapsed = now - self.last_log

        if elapsed >= 2.0:
            fps = self.frame_count / elapsed
            size_kb = len(frame_bytes) / 1024

            logging.info(
                f"📊 {fps:.1f} FPS | {size_kb:.0f} KB/frame | "
                f"{fps * size_kb:.0f} KB/s"
            )

            self.frame_count = 0
            self.last_log = now

    def stop(self):
        """Cleanup camera and Redis"""
        self.running = False
        if hasattr(self, 'picam2'):
            self.picam2.stop()
            logging.info("✓ Camera stopped")
        if hasattr(self, 'redis_client'):
            self.redis_client.close()
            logging.info("✓ Redis connection closed")


if __name__ == "__main__":
    logging.info("=== Redis Camera Producer Starting ===")
    logging.info(f"Camera ID: {CAMERA_ID}")
    logging.info(f"Resolution: {WIDTH}x{HEIGHT}")
    logging.info(f"JPEG Quality: {JPEG_QUALITY}")
    logging.info(f"Redis: {REDIS_HOST}:{REDIS_PORT}")
    
    producer = RedisCameraProducer()
    producer.start()
