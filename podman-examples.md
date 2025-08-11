# Podman Deployment Examples

## Quick Start Commands

### 1. Run Redis Broker
```bash
# Start Redis with your exact configuration
podman run -d \
  --name redis-broker \
  -p 6379:6379 \
  -v /var/log/redis:/var/log/redis:Z \
  -v redis_data:/data:Z \
  redis:alpine \
  redis-server --loglevel verbose --logfile /var/log/redis/redis.log --appendonly yes
```

### 2. Build and Run Stream Receiver
```bash
# Build the stream receiver image
podman build -t stream-receiver -f Dockerfile .

# Run the stream receiver
podman run -d \
  --name stream_receiver \
  -p 5000:5000 \
  -e REDIS_HOST=redis-broker \
  -e REDIS_PORT=6379 \
  -e REDIS_CHANNEL=camera_stream \
  -e FLASK_ENV=production \
  -v ./app/logs:/app/logs:Z \
  --pod stream-pod \
  stream-receiver
```

### 3. Build and Run Camera Client (on Pi)
```bash
# Build camera client image
podman build -t camera-client -f Dockerfile.camera .

# Run camera client with device access
podman run -d \
  --name camera_client \
  -e REDIS_HOST=redis-broker \
  -e REDIS_PORT=6379 \
  -e CAMERA_CHANNEL=camera_stream \
  -e FRAME_WIDTH=480 \
  -e FRAME_HEIGHT=320 \
  -e FRAME_RATE=24 \
  --device /dev/video0:/dev/video0 \
  --pod stream-pod \
  camera-client
```

## Using Podman Pods (Recommended)

Podman pods group containers together, similar to Kubernetes pods:

```bash
# Create a pod for all services
podman pod create --name stream-pod -p 5000:5000 -p 6379:6379

# Run Redis in the pod
podman run -d \
  --name redis-broker \
  --pod stream-pod \
  -v /var/log/redis:/var/log/redis:Z \
  -v redis_data:/data:Z \
  redis:alpine \
  redis-server --loglevel verbose --logfile /var/log/redis/redis.log --appendonly yes

# Run stream receiver in the pod
podman run -d \
  --name stream_receiver \
  --pod stream-pod \
  -e REDIS_HOST=localhost \
  -e REDIS_PORT=6379 \
  -v ./app/logs:/app/logs:Z \
  stream-receiver

# Run camera client in the pod (on Pi)
podman run -d \
  --name camera_client \
  --pod stream-pod \
  --device /dev/video0:/dev/video0 \
  -e REDIS_HOST=localhost \
  camera-client
```

## Using Podman Compose

Podman supports docker-compose files with `podman-compose`:

```bash
# Install podman-compose
pip3 install podman-compose

# Use existing docker-compose.yml
podman-compose up -d

# Or for full deployment with camera
podman-compose --profile camera up -d
```

## Systemd Integration (Rootless)

Generate systemd service files for automatic startup:

```bash
# Generate service files for the pod
podman generate systemd --new --name stream-pod --files

# Move service files to user systemd directory
mkdir -p ~/.config/systemd/user
mv *.service ~/.config/systemd/user/

# Enable and start services
systemctl --user daemon-reload
systemctl --user enable pod-stream-pod.service
systemctl --user start pod-stream-pod.service

# Enable lingering for startup without login
sudo loginctl enable-linger $USER
```

## Network Configuration Examples

### Bridge Network (Default)
```bash
podman network create stream-network

# Run with custom network
podman run -d --network stream-network --name redis-broker redis:alpine
podman run -d --network stream-network --name stream_receiver -p 5000:5000 stream-receiver
```

### Host Network (Pi Camera Access)
```bash
# Run with host network for easier camera access
podman run -d \
  --network host \
  --name camera_client \
  --device /dev/video0:/dev/video0 \
  -e REDIS_HOST=127.0.0.1 \
  camera-client
```

## Volume Management

```bash
# Create named volumes
podman volume create redis_data
podman volume create stream_logs

# Use volumes in containers
podman run -d \
  --name redis-broker \
  -v redis_data:/data:Z \
  -v stream_logs:/var/log/redis:Z \
  redis:alpine
```

## Monitoring and Debugging

```bash
# View pod status
podman pod ps

# View container logs
podman logs -f stream_receiver
podman logs -f camera_client

# Execute commands in running containers
podman exec -it stream_receiver /bin/bash

# View resource usage
podman stats

# Inspect pod/container details
podman pod inspect stream-pod
podman inspect stream_receiver
```

## Common Podman Commands

```bash
# Build images
podman build -t stream-receiver .
podman build -t camera-client -f Dockerfile.camera .

# List images and containers
podman images
podman ps -a

# Stop and remove
podman stop stream_receiver camera_client redis-broker
podman rm stream_receiver camera_client redis-broker
podman pod rm stream-pod

# Clean up
podman system prune -a
```

## Raspberry Pi Specific Tips

### 1. Enable camera module
```bash
# Add to /boot/config.txt
start_x=1
gpu_mem=128

# Reboot after changes
sudo reboot
```

### 2. Install Podman on Raspberry Pi OS
```bash
sudo apt update
sudo apt install podman

# Or for newer versions
echo 'deb http://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/stable/Debian_11/ /' | sudo tee /etc/apt/sources.list.d/devel:kubic:libcontainers:stable.list
curl -L https://download.opensuse.org/repositories/devel:kubic:libcontainers:stable/Debian_11/Release.key | sudo apt-key add -
sudo apt update
sudo apt install podman
```

### 3. Rootless containers with camera access
```bash
# Add user to video group
sudo usermod -a -G video $USER

# Configure subuid/subgid for rootless containers
echo "$USER:100000:65536" | sudo tee -a /etc/subuid
echo "$USER:100000:65536" | sudo tee -a /etc/subgid

# Reboot to apply changes
sudo reboot
```

## Environment Files

Create `.env` file for easier configuration:

```bash
# .env file
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_CHANNEL=camera_stream
FLASK_ENV=production
FRAME_WIDTH=480
FRAME_HEIGHT=320
FRAME_RATE=24
```

Use with Podman:
```bash
podman run --env-file .env -d stream-receiver
```

## Security Considerations

```bash
# Run as non-root user
podman run --user 1000:1000 stream-receiver

# Use SELinux labels for volumes
podman run -v ./logs:/app/logs:Z stream-receiver

# Limit resources
podman run --memory=512m --cpus=1 stream-receiver
```