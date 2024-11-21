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
        self.setup_socket()

    def setup_socket(self):
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            app.logger.info("Setting up server socket")
            self.server_socket.bind(('0.0.0.0', self.bind_port))
            self.server_socket.listen(1)
            app.logger.info(f"Listening on port {self.bind_port}")
        except socket.error as e:
            app.logger.error(f"Failed to bind: {e}")
            sys.exit(1)

    def receive_frames(self):
        """Background thread to receive frames from Raspberry Pi"""
        while True:
            app.logger.info("Waiting for connection...")
            try:
                client_socket, addr = self.server_socket.accept()
                app.logger.info(f"Connected to {addr}")
                
                try:
                    while True:
                        # Receive frame size first (4 bytes)
                        size_data = self.recvall(client_socket, 4)
                        if not size_data:
                            break
                        
                        frame_size = struct.unpack('!I', size_data)[0]
                        
                        # Receive frame data
                        frame_data = self.recvall(client_socket, frame_size)
                        if not frame_data:
                            break
                        
                        if frame_queue.full():
                            frame_queue.get()
                        frame_queue.put(frame_data)
                
                except socket.error as e:
                    app.logger.error(f"Socket error: {e}")
                
                finally:
                    client_socket.close()
                    app.logger.info("Connection closed")
            except Exception as e:
                app.logger.error(f"Accept error: {e}")
                time.sleep(1)  # Prevent tight loop on error
    
    def recvall(self, sock, n):
        """Helper function to receive n bytes or return None if EOF is hit"""
        data = bytearray()
        while len(data) < n:
            packet = sock.recv(n - len(data))
            if not packet:
                return None
            data.extend(packet)
        return data

def generate_frames():
    """Generator function for streaming frames"""
    while True:
        if not frame_queue.empty():
            frame = frame_queue.get()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        else:
            time.sleep(0.01)

@app.route('/')
def index():
    app.logger.info("Index page accessed")
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    app.logger.info("Video feed accessed")
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

# Initialize the receiver and start thread when module loads
app.logger.info("Initializing StreamReceiver")
receiver = StreamReceiver(5555)  # Hardcoded port for production
receiver_thread = threading.Thread(target=receiver.receive_frames, daemon=True)
receiver_thread.start()
app.logger.info("StreamReceiver thread started")

# Main function only used for development
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
