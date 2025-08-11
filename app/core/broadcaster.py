import threading
import time
import logging
import uuid

import redis
from .viewer import ViewerConnection

logger = logging.getLogger(__name__)


class EfficientFrameBroadcaster:
    def __init__(self, redis_host:str = 'localhost',
                 redis_port: int = 6379,
                 channel:str = 'camera_stream'):
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.channel = channel

        # Single frame storage - shared by all viewers
        self.current_frame = None
        self.frame_timestamp = 0
        self.frame_lock = threading.RLock()
        
        # Viewer management
        self.viewers = {}  # {viewer_id: ViewerConnection}
        self.viewers_lock = threading.RLock()
        
        # Redis connection
        self.redis_client = None
        self.pubsub = None
        self.running = True
        
        # Stats
        self.frames_received = 0
        self.frames_broadcasted = 0
        self.start_time = time.time()
        
        # Start the single producer thread
        self.producer_thread = threading.Thread(target=self._producer_loop, daemon=True)
        self.producer_thread.start()
        
        logger.info("EfficientFrameBroadcaster started")
    
    def _setup_redis(self):
        """Setup Redis connection - only called from producer thread"""
        try:
            self.redis_client = redis.Redis(
                host=self.redis_host,
                port=self.redis_port,
                decode_responses=False,
                socket_connect_timeout=10,
                socket_timeout=10,
                retry_on_timeout=True
            )
            self.redis_client.ping()
            logger.info(f"Connected to Redis at {self.redis_host}:{self.redis_port}")
            return True
        except Exception as e:
            logger.error(f"Redis connection failed: {e}")
            return False
    
    def _producer_loop(self):
        """Single producer thread - reads from Redis and broadcasts to all viewers"""
        logger.info("Producer thread started")
        
        while self.running:
            try:
                # Setup Redis connection
                if not self.redis_client and not self._setup_redis():
                    time.sleep(5)
                    continue
                
                # Setup pub/sub
                self.pubsub = self.redis_client.pubsub()
                self.pubsub.subscribe(self.channel)
                logger.info(f"Subscribed to Redis channel: {self.channel}")
                
                # Process messages
                while self.running:
                    try:
                        # Non-blocking get with timeout
                        message = self.pubsub.get_message(timeout=1.0)
                        
                        if message and message['type'] == 'message':
                            frame_data = message['data']
                            current_time = time.time()
                            
                            # Validate frame
                            if not isinstance(frame_data, bytes) or len(frame_data) < 100:
                                continue
                            
                            # Update shared frame (single copy in memory)
                            with self.frame_lock:
                                # Release old frame reference
                                if self.current_frame:
                                    del self.current_frame
                                
                                self.current_frame = frame_data
                                self.frame_timestamp = current_time
                                self.frames_received += 1
                            
                            # Notify all viewers (no frame copying)
                            self._broadcast_to_viewers()
                            
                            logger.debug(f"Frame {self.frames_received} broadcasted to {len(self.viewers)} viewers")
                    
                    except redis.ConnectionError as e:
                        logger.error(f"Redis connection error: {e}")
                        break
                    except Exception as e:
                        logger.error(f"Error in producer loop: {e}")
                        time.sleep(0.1)
            
            except Exception as e:
                logger.error(f"Producer loop error: {e}")
                self._cleanup_redis()
                time.sleep(5)
        
        logger.info("Producer thread stopped")
    
    def _broadcast_to_viewers(self):
        """Notify all viewers that a new frame is available"""
        with self.viewers_lock:
            # Remove disconnected viewers
            disconnected = []
            for viewer_id, viewer in list(self.viewers.items()):
                try:
                    viewer.notify_new_frame()
                    self.frames_broadcasted += 1
                except:
                    disconnected.append(viewer_id)
            
            # Clean up disconnected viewers
            for viewer_id in disconnected:
                del self.viewers[viewer_id]
                logger.debug(f"Removed disconnected viewer {viewer_id[:8]}")
    
    def _cleanup_redis(self):
        """Cleanup Redis connections"""
        if self.pubsub:
            try:
                self.pubsub.unsubscribe()
                self.pubsub.close()
            except:
                pass
            self.pubsub = None
        
        if self.redis_client:
            try:
                self.redis_client.close()
            except:
                pass
            self.redis_client = None
    
    def add_viewer(self):
        """Add a new viewer and return viewer connection"""
        viewer_id = str(uuid.uuid4())
        viewer = ViewerConnection(viewer_id, self)
        
        with self.viewers_lock:
            self.viewers[viewer_id] = viewer
        
        logger.info(f"Added viewer {viewer_id[:8]}, total viewers: {len(self.viewers)}")
        return viewer
    
    def remove_viewer(self, viewer_id):
        """Remove a viewer"""
        with self.viewers_lock:
            if viewer_id in self.viewers:
                del self.viewers[viewer_id]
        logger.info(f"Removed viewer {viewer_id[:8]}, remaining viewers: {len(self.viewers)}")
    
    def get_current_frame_data(self):
        """Get current frame data for a viewer - returns reference, not copy"""
        with self.frame_lock:
            if self.current_frame and self.frame_timestamp:
                # Return frame reference + metadata (no copying)
                return self.current_frame, self.frame_timestamp
            return None, 0
    
    def get_stats(self):
        """Get broadcaster statistics"""
        runtime = time.time() - self.start_time
        return {
            'viewers': len(self.viewers),
            'frames_received': self.frames_received,
            'frames_broadcasted': self.frames_broadcasted,
            'fps': self.frames_received / runtime if runtime > 0 else 0,
            'runtime_seconds': runtime,
            'memory_efficient': True
        }
    
    def stop(self):
        """Stop the broadcaster"""
        self.running = False
        self._cleanup_redis()
