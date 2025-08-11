import queue
import uuid
import logging

logger = logging.getLogger(__name__)


class ViewerConnection:
    def __init__(self, viewer_id, broadcaster):
        self.viewer_id = viewer_id
        self.broadcaster = broadcaster
        self.frame_queue = queue.Queue(maxsize=2)  # Small buffer
        self.last_frame_timestamp = 0
        self.active = True
    
    def notify_new_frame(self):
        if not self.active:
            raise ConnectionError("Viewer disconnected")
        
        try:
            self.frame_queue.put_nowait("new_frame")
        except queue.Full:
            logger.debug(f"Dropped frame for slow viewer {self.viewer_id[:8]}")
    
    def get_frame_generator(self):
        def frame_generator():
            try:
                logger.debug(f"Starting generator for viewer {self.viewer_id[:8]}")
                
                while self.active:
                    try:
                        self.frame_queue.get(timeout=5.0)
                        
                        frame_data, frame_timestamp = self.broadcaster.get_current_frame_data()
                        
                        if frame_data and frame_timestamp > self.last_frame_timestamp:
                            yield b'--frame\r\n'
                            yield b'Content-Type: image/jpeg\r\n\r\n'
                            yield frame_data  # Direct reference to shared frame
                            yield b'\r\n'
                            
                            self.last_frame_timestamp = frame_timestamp
                    
                    except queue.Empty:
                        logger.debug(f"Timeout for viewer {self.viewer_id[:8]}")
                        continue
                    except Exception as e:
                        logger.error(f"Error in viewer {self.viewer_id[:8]}: {e}")
                        break
            
            finally:
                self.active = False
                self.broadcaster.remove_viewer(self.viewer_id)
                logger.debug(f"Generator stopped for viewer {self.viewer_id[:8]}")
        
        return frame_generator()