# Stream Receiver

Flask application for receiving and displaying camera streams via Redis pub/sub. Set up for Raspberry Pi deployments.

## Features

- Video streaming over Redis pub/sub
- Pub/Sub frame broadcasting (no frame copying)
- Support for multiple concurrent viewers
- Raspberry Pi camera support (Picamera2 + OpenCV fallback)
- Containerized deployment with Docker/Podman
- Health monitoring and status APIs

## Quick Start

### Prerequisites

- Docker or Podman
- Python 3.11+ (for non-containerized deployment)
- Redis server

## Deployment Options

### Option 1: All-in-One Raspberry Pi Setup

Deploy everything on a single Raspberry Pi with camera attached.

#### Using Docker
```bash
# Clone repository
git clone <repository-url>
cd stream_receiver

# Deploy full stack with camera
./deploy.sh full

# Check status
./deploy.sh status

# View at http://localhost:5000
```

#### Using Podman
```bash
# Deploy full stack with camera
./deploy-podman.sh full

# Check status  
./deploy-podman.sh status

# Setup auto-start services
./deploy-podman.sh systemd
sudo loginctl enable-linger $USER
```

### Option 2: Remote Server + Raspberry Pi Setup

Deploy the web interface on a remote server and run only the camera client on the Pi.

#### Step 1: Deploy Server (Remote Machine)

**Using Docker:**
```bash
# On remote server
git clone <repository-url>
cd stream_receiver

# Deploy only Redis + web interface
./deploy.sh receiver

# Web interface available at http://localhost:5000
```

**Using Podman:**
```bash
# On remote server
./deploy-podman.sh receiver
```

#### Step 2: Deploy Camera Client (Raspberry Pi)

**Option A: Using Docker**
```bash
# On Raspberry Pi
git clone <repository-url>
cd stream_receiver

# Set server IP address
export REDIS_HOST=your-server-ip

# Build camera client image
docker build -t camera-client -f Dockerfile.camera .

# Run camera client
docker run -d \
  --name camera_client \
  --device /dev/video0:/dev/video0 \
  --privileged \
  -e REDIS_HOST=$REDIS_HOST \
  -e REDIS_PORT=6379 \
  -e FRAME_WIDTH=480 \
  -e FRAME_HEIGHT=320 \
  -e FRAME_RATE=24 \
  camera-client
```

**Option B: Using Podman**
```bash
# On Raspberry Pi
export REDIS_HOST=your-server-ip

# Build and run camera client
podman build -t camera-client -f Dockerfile.camera .
podman run -d \
  --name camera_client \
  --device /dev/video0:/dev/video0 \
  -e REDIS_HOST=$REDIS_HOST \
  camera-client
```

**Option C: Direct Python (No Container)**
```bash
# On Raspberry Pi
pip install -r requirements.txt
pip install picamera2 opencv-python

# Set environment variables
export REDIS_HOST=your-server-ip
export REDIS_PORT=6379
export FRAME_WIDTH=480
export FRAME_HEIGHT=320
export FRAME_RATE=24

# Run camera client
python cam_stream_client.py
```

## Manual Setup

### Redis Server Setup

If you need to run Redis manually:

```bash
# Using Docker
docker run -d \
  --name redis-broker \
  -p 6379:6379 \
  -v /var/log/redis:/var/log/redis \
  redis:alpine \
  redis-server --loglevel verbose --logfile /var/log/redis/redis.log

# Using Podman
podman run -d \
  --name redis-broker \
  -p 6379:6379 \
  -v /var/log/redis:/var/log/redis:Z \
  redis:alpine \
  redis-server --loglevel verbose --logfile /var/log/redis/redis.log
```

### Stream Receiver Setup

```bash
# Build image
docker build -t stream-receiver .

# Run receiver
docker run -d \
  --name stream_receiver \
  -p 5000:5000 \
  -e REDIS_HOST=localhost \
  -e REDIS_PORT=6379 \
  stream-receiver
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| REDIS_HOST | localhost | Redis server hostname |
| REDIS_PORT | 6379 | Redis server port |
| REDIS_CHANNEL | camera_stream | Redis pub/sub channel |
| FLASK_ENV | production | Flask environment |
| HOST | 0.0.0.0 | Flask bind address |
| PORT | 5000 | Flask port |
| MAX_VIEWERS | 10 | Maximum concurrent viewers |
| FRAME_WIDTH | 480 | Camera frame width |
| FRAME_HEIGHT | 320 | Camera frame height |
| FRAME_RATE | 24 | Camera frame rate |

### Camera Configuration

Edit environment variables in camera client:

```bash
# Higher resolution (more bandwidth)

export FRAME_WIDTH=640
export FRAME_HEIGHT=480
export FRAME_RATE=30

# Lower resolution (less bandwidth) 
export FRAME_WIDTH=320
export FRAME_HEIGHT=240
export FRAME_RATE=15
```

## API Endpoints

- `GET /` - Web interface for viewing stream
- `GET /video_feed` - Video stream endpoint (MJPEG)
- `GET /status` - System status and statistics
- `GET /viewers` - Current viewer information
- `GET /health` - Health check endpoint

## Monitoring

### Check Service Status
```bash
# Docker
docker ps
docker logs stream_receiver
docker logs camera_client

# Podman  
podman ps
podman logs stream_receiver
podman logs camera_client
```

### View Statistics
```bash
# Web interface
curl http://localhost:5000/status

# Example response:
{
  "status": "healthy",
  "broadcaster": {
    "viewers": 2,
    "frames_received": 1250,
    "fps": 24.1
  }
}
```

## Troubleshooting

### Common Issues

**Camera not detected:**
```bash
# Check camera device
ls -la /dev/video*

# Test camera access
python -c "import cv2; cap = cv2.VideoCapture(0); print('Camera OK' if cap.isOpened() else 'Camera failed')"
```

**Redis connection failed:**
```bash
# Test Redis connectivity
redis-cli -h your-redis-host -p 6379 ping

# Check Redis logs
docker logs redis-broker
```

**Permission denied for camera:**
```bash
# Add user to video group
sudo usermod -a -G video $USER

# Reboot to apply
sudo reboot
```

**Container build fails on Pi:**
```bash
# Increase swap space
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### Raspberry Pi Setup

**Enable camera module:**
```bash
# Add to /boot/config.txt
echo "start_x=1" | sudo tee -a /boot/config.txt
echo "gpu_mem=128" | sudo tee -a /boot/config.txt

# Reboot
sudo reboot
```

**Install dependencies:**
```bash
# System packages
sudo apt update
sudo apt install python3-picamera2 python3-opencv

# Or for full build environment
sudo apt install build-essential python3-dev
```

## Development

### Local Development
```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
export FLASK_ENV=development
python -m app.main
```

### Testing
```bash
# Run tests
python -m pytest tests/

# Check application health
curl http://localhost:5000/health
```

## Architecture

```
Camera Client -> Redis Pub/Sub -> Stream Receiver
```
