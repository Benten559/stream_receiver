from flask import Flask, Response, render_template
import socket
import threading
from queue import Queue
import time
import logging
from logging.handlers import RotatingFileHandler
import sys
import struct
import os
import errno

app = Flask(__name__)

# Ensure log directory exists
log_dir = '/var/log/wedidit'
os.makedirs(log_dir, exist_ok=True)

# Configure logging
handler = RotatingFileHandler('/var/log/wedidit/stream_server.log', maxBytes=10000, backupCount=3)
handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
app.logger.addHandler(handler)
app.logger.setLevel(logging.INFO)

# Global frame queue
frame_queue = Queue(maxsize=10)

class StreamReceiver:
    def __init__(self, bind_port):
        self.bind_port = bind_port
        self.running = True
        self.server_socket = None
        self.current_client = None
        self.setup_socket()

    def setup_socket(self):
        """Set up the server socket with error handling"""
        try:
            if self.server_socket:
                try:
                    self.server_socket.shutdown(socket.SHUT_RDWR)
                except:
                    pass
                try:
                    self.server_socket.close()
                except:
                    pass

            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            
            # Add TCP keepalive
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            # Set shorter timeouts for faster detection of disconnection
            self.server_socket.settimeout(30)  # 30 second timeout
            
            app.logger.info("Setting up server socket")
            self.server_socket.bind(('0.0.0.0', self.bind_port))
            self.server_socket.listen(1)
            app.logger.info(f"Listening on port {self.bind_port}")
            return True
        except socket.error as e:
            app.logger.error(f"Failed to bind: {e}")
            time.sleep(5)  # Wait before retry
            return False

    def cleanup_client(self):
        """Cleanup client connection"""
        if self.current_client:
            try:
                self.current_client.shutdown(socket.SHUT_RDWR)
            except:
                pass
            try:
                self.current_client.close()
            except:
                pass
            self.current_client = None

    def receive_frames(self):
        """Background thread to receive frames from Raspberry Pi"""
        while self.running:
            try:
                if not self.server_socket:
                    if not self.setup_socket():
                        continue

                app.logger.info("Waiting for connection...")
                self.current_client, addr = self.server_socket.accept()
                self.current_client.settimeout(5)  # 5 second timeout for receive operations
                app.logger.info(f"Connected to {addr}")
                
                try:
                    while self.running:
                        # Receive frame size first (4 bytes)
                        size_data = self.recvall(self.current_client, 4)
                        if not size_data:
                            raise socket.error("Connection lost while reading size")
                        
                        frame_size = struct.unpack('!I', size_data)[0]
                        if frame_size > 10000000:  # Sanity check: 10MB max
                            raise ValueError("Frame size too large")
                        
                        # Receive frame data
                        frame_data = self.recvall(self.current_client, frame_size)
                        if not frame_data:
                            raise socket.error("Connection lost while reading frame")
                        
                        if frame_queue.full():
                            frame_queue.get()
                        frame_queue.put(frame_data)
                
                except socket.timeout:
                    app.logger.warning("Socket timeout - connection may be dead")
                    raise
                except socket.error as e:
                    app.logger.error(f"Socket error: {e}")
                    raise
                except Exception as e:
                    app.logger.error(f"Unexpected error: {e}")
                    raise
                
            except Exception as e:
                app.logger.error(f"Connection error: {e}")
                self.cleanup_client()
                time.sleep(1)  # Prevent tight loop on error
            
            finally:
                self.cleanup_client()
                app.logger.info("Connection closed, ready for new connection")
    
    def recvall(self, sock, n):
        """Helper function to receive n bytes or return None if EOF is hit"""
        data = bytearray()
        start_time = time.time()
        
        while len(data) < n and time.time() - start_time < 10:  # 10 second total timeout
            try:
                packet = sock.recv(min(n - len(data), 8192))
                if not packet:
                    return None
                data.extend(packet)
            except socket.timeout:
                continue
            except socket.error as e:
                if e.errno == errno.EINTR:  # Interrupted system call
                    continue
                raise
                
        if len(data) < n:
            raise socket.timeout("Failed to receive complete data within timeout")
            
        return data

    def stop(self):
        """Stop the receiver gracefully"""
        self.running = False
        self.cleanup_client()
        if self.server_socket:
            try:
                self.server_socket.shutdown(socket.SHUT_RDWR)
            except:
                pass
            try:
                self.server_socket.close()
            except:
                pass

def generate_frames():
    """Generator function for streaming frames"""
    while True:
        try:
            if not frame_queue.empty():
                frame = frame_queue.get()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
            else:
                time.sleep(0.01)
        except Exception as e:
            app.logger.error(f"Error in generate_frames: {e}")
            time.sleep(0.1)

@app.route('/')
def index():
    app.logger.info("Index page accessed")
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    app.logger.info("Video feed accessed")
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/status')
def status():
    """Endpoint to check server status"""
    return {
        'queue_size': frame_queue.qsize(),
        'server_running': receiver.running if receiver else False
    }

# Initialize the receiver and start thread when module loads
app.logger.info("Initializing StreamReceiver")
receiver = StreamReceiver(5555)
receiver_thread = threading.Thread(target=receiver.receive_frames, daemon=True)
receiver_thread.start()
app.logger.info("StreamReceiver thread started")

# Cleanup handler
import atexit
@atexit.register
def cleanup():
    if receiver:
        receiver.stop()
