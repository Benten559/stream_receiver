import threading
import time
import logging
import redis

logger = logging.getLogger(__name__)

class FrameBroadcaster:
    def __init__(self, redis_host='localhost', redis_port=6379, channel='camera_stream'):
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.channel = channel
        
        # Current frame storage
        self.current_frame = None
        self.frame_timestamp = 0
        self.frames_received = 0
        self.frame_lock = threading.Lock()
        
        # Running flag
        self.running = True
        
        # Start background thread
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        
        logger.info("FrameBroadcaster started")
    
    def _run(self):
        """Background thread to receive frames"""
        logger.info("FrameBroadcaster thread started")
        
        while self.running:
            try:
                # Create Redis client (exactly like our working test)
                client = redis.Redis(host=self.redis_host, port=self.redis_port, decode_responses=False)
                client.ping()
                logger.info(f"Connected to Redis at {self.redis_host}:{self.redis_port}")
                
                # Create pubsub
                pubsub = client.pubsub()
                pubsub.subscribe(self.channel)
                logger.info(f"Subscribed to {self.channel}")
                
                # Listen for messages
                while self.running:
                    try:
                        message = pubsub.get_message(timeout=1.0)
                        
                        if message and message['type'] == 'message':
                            frame_data = message['data']
                            
                            # Validate frame
                            if isinstance(frame_data, bytes) and len(frame_data) > 100:
                                with self.frame_lock:
                                    self.current_frame = frame_data
                                    self.frame_timestamp = time.time()
                                    self.frames_received += 1
                                
                                # Log every frame to see if we're getting updates
                                logger.info(f"NEW FRAME {self.frames_received} (size: {len(frame_data)}, timestamp: {self.frame_timestamp})")
                    
                    except Exception as e:
                        logger.error(f"Error getting message: {e}")
                        break
                
                # Cleanup
                pubsub.unsubscribe()
                pubsub.close()
                client.close()
                
            except Exception as e:
                logger.error(f"Redis connection error: {e}")
                time.sleep(5)  # Wait before retry
        
        logger.info("FrameBroadcaster thread stopped")
    
    def get_current_frame(self):
        """Get the current frame"""
        with self.frame_lock:
            if self.current_frame:
                return self.current_frame, self.frame_timestamp
            return None, 0
    
    def get_stats(self):
        """Get stats"""
        return {
            'frames_received': self.frames_received,
            'current_frame_available': self.current_frame is not None
        }
    
    def stop(self):
        """Stop the broadcaster"""
        self.running = False