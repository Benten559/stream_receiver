#!/bin/bash

# Stream Receiver Podman Deployment Script for Raspberry Pi
set -e

echo "🐙 Stream Receiver Podman Deployment Script"
echo "=========================================="

# Configuration
POD_NAME="stream-pod"
REDIS_VOLUME="redis_data"
LOG_VOLUME="stream_logs"

# Check if Podman is available
check_podman() {
    if ! command -v podman &> /dev/null; then
        echo "❌ Podman is not installed. Please install Podman first."
        echo "   sudo apt update && sudo apt install podman"
        exit 1
    fi
    
    # Check for podman-compose if using compose
    if [[ "${USE_COMPOSE:-false}" == "true" ]] && ! command -v podman-compose &> /dev/null; then
        echo "⚠️  podman-compose not found. Install with: pip3 install podman-compose"
        echo "   Falling back to manual pod deployment..."
        USE_COMPOSE=false
    fi
}

# Setup volumes and directories
setup_storage() {
    echo "📁 Setting up storage..."
    
    # Create log directory
    sudo mkdir -p /var/log/redis
    sudo chmod 755 /var/log/redis
    
    # Create named volumes
    podman volume exists $REDIS_VOLUME 2>/dev/null || podman volume create $REDIS_VOLUME
    podman volume exists $LOG_VOLUME 2>/dev/null || podman volume create $LOG_VOLUME
    
    echo "✅ Storage setup complete"
}

# Build container images
build_images() {
    echo "🔨 Building container images..."
    
    echo "  Building stream receiver..."
    podman build -t stream-receiver -f Dockerfile .
    
    if [[ "$1" == "with-camera" ]]; then
        echo "  Building camera client..."
        podman build -t camera-client -f Dockerfile.camera .
    fi
    
    echo "✅ Images built successfully"
}

# Create pod for services
create_pod() {
    echo "📦 Creating pod: $POD_NAME"
    
    # Remove existing pod if it exists
    podman pod exists $POD_NAME && podman pod rm -f $POD_NAME
    
    # Create new pod with exposed ports
    podman pod create --name $POD_NAME -p 5000:5000 -p 6379:6379
    
    echo "✅ Pod created"
}

# Deploy Redis service
deploy_redis() {
    echo "🗄️  Deploying Redis..."
    
    podman run -d \
        --name redis-broker \
        --pod $POD_NAME \
        -v $REDIS_VOLUME:/data:Z \
        -v /var/log/redis:/var/log/redis:Z \
        --restart unless-stopped \
        docker.io/library/redis:alpine \
        redis-server --loglevel verbose --logfile /var/log/redis/redis.log --appendonly yes
    
    echo "✅ Redis deployed"
}

# Deploy stream receiver
deploy_receiver() {
    echo "🖥️  Deploying Stream Receiver..."
    
    podman run -d \
        --name stream_receiver \
        --pod $POD_NAME \
        -e REDIS_HOST=localhost \
        -e REDIS_PORT=6379 \
        -e REDIS_CHANNEL=camera_stream \
        -e FLASK_ENV=production \
        -e HOST=0.0.0.0 \
        -e PORT=5000 \
        -e MAX_VIEWERS=10 \
        -v ./app/logs:/app/logs:Z \
        --restart unless-stopped \
        stream-receiver
    
    echo "✅ Stream Receiver deployed"
}

# Deploy camera client
deploy_camera() {
    echo "📷 Deploying Camera Client..."
    
    # Check if camera device exists
    if [[ ! -e /dev/video0 ]]; then
        echo "⚠️  Warning: /dev/video0 not found. Camera may not be available."
    fi
    
    podman run -d \
        --name camera_client \
        --pod $POD_NAME \
        --device /dev/video0:/dev/video0 \
        -e REDIS_HOST=localhost \
        -e REDIS_PORT=6379 \
        -e CAMERA_CHANNEL=camera_stream \
        -e FRAME_WIDTH=480 \
        -e FRAME_HEIGHT=320 \
        -e FRAME_RATE=24 \
        --restart unless-stopped \
        camera-client
    
    echo "✅ Camera Client deployed"
}

# Deploy using podman-compose
deploy_compose() {
    echo "🐙 Deploying with podman-compose..."
    
    if [[ "$1" == "with-camera" ]]; then
        podman-compose --profile camera up -d
    else
        podman-compose up -d redis stream-receiver
    fi
    
    echo "✅ Services deployed with compose"
}

# Generate systemd service files
setup_systemd() {
    echo "⚙️  Setting up systemd services..."
    
    # Generate service files
    podman generate systemd --new --name $POD_NAME --files
    
    # Create user systemd directory
    mkdir -p ~/.config/systemd/user
    
    # Move service files
    mv *.service ~/.config/systemd/user/
    
    # Reload and enable
    systemctl --user daemon-reload
    systemctl --user enable pod-$POD_NAME.service
    
    echo "✅ Systemd services configured"
    echo "   Enable auto-start: sudo loginctl enable-linger $USER"
    echo "   Start manually: systemctl --user start pod-$POD_NAME.service"
}

# Show deployment status
show_status() {
    echo "📊 Deployment Status:"
    echo "==================="
    
    echo "Pod Status:"
    podman pod ps
    echo ""
    
    echo "Container Status:"
    podman ps --pod
    echo ""
    
    echo "Recent Logs (last 10 lines):"
    echo "Redis:"
    podman logs --tail=10 redis-broker 2>/dev/null || echo "  Redis not running"
    echo "Stream Receiver:"
    podman logs --tail=10 stream_receiver 2>/dev/null || echo "  Stream Receiver not running"
    echo "Camera Client:"
    podman logs --tail=10 camera_client 2>/dev/null || echo "  Camera Client not running"
}

# Stop all services
stop_services() {
    echo "🛑 Stopping services..."
    
    podman pod stop $POD_NAME 2>/dev/null || true
    
    echo "✅ Services stopped"
}

# Remove all services and pod
cleanup() {
    echo "🧹 Cleaning up..."
    
    # Stop and remove containers
    podman pod rm -f $POD_NAME 2>/dev/null || true
    
    # Remove systemd services
    systemctl --user disable pod-$POD_NAME.service 2>/dev/null || true
    rm -f ~/.config/systemd/user/pod-$POD_NAME.service
    rm -f ~/.config/systemd/user/container-*.service
    systemctl --user daemon-reload 2>/dev/null || true
    
    echo "✅ Cleanup complete"
}

# Main deployment function
deploy_receiver_only() {
    check_podman
    setup_storage
    build_images
    create_pod
    deploy_redis
    deploy_receiver
    
    echo ""
    echo "🎉 Stream Receiver deployed successfully!"
    echo "   Web interface: http://localhost:5000"
    echo "   Status API: http://localhost:5000/status"
    echo ""
    show_status
}

# Full deployment with camera
deploy_full_stack() {
    check_podman
    setup_storage
    build_images with-camera
    create_pod
    deploy_redis
    deploy_receiver
    deploy_camera
    
    echo ""
    echo "🎉 Full stack deployed successfully!"
    echo "   Web interface: http://localhost:5000"
    echo "   Status API: http://localhost:5000/status"
    echo ""
    show_status
}

# Parse command line arguments
case "${1:-help}" in
    "receiver")
        if [[ "${USE_COMPOSE:-false}" == "true" ]]; then
            check_podman
            setup_storage
            deploy_compose
        else
            deploy_receiver_only
        fi
        ;;
    "full")
        if [[ "${USE_COMPOSE:-false}" == "true" ]]; then
            check_podman
            setup_storage
            deploy_compose with-camera
        else
            deploy_full_stack
        fi
        ;;
    "systemd")
        setup_systemd
        ;;
    "status")
        show_status
        ;;
    "stop")
        stop_services
        ;;
    "cleanup")
        cleanup
        ;;
    "logs")
        service=${2:-}
        if [[ -z "$service" ]]; then
            echo "Available services: redis-broker, stream_receiver, camera_client"
            echo "Usage: $0 logs <service-name>"
        else
            podman logs -f $service
        fi
        ;;
    "shell")
        service=${2:-stream_receiver}
        podman exec -it $service /bin/bash
        ;;
    "build")
        build_images ${2:-}
        ;;
    "help"|*)
        echo "Usage: $0 {receiver|full|status|stop|cleanup|logs|systemd|build|shell}"
        echo ""
        echo "Commands:"
        echo "  receiver  - Deploy Redis + Stream Receiver only"
        echo "  full      - Deploy Redis + Stream Receiver + Camera Client"
        echo "  status    - Show deployment status and logs"
        echo "  stop      - Stop all services"
        echo "  cleanup   - Remove all containers, pod, and systemd services"
        echo "  logs      - Show logs for specific service"
        echo "  shell     - Open shell in container"
        echo "  systemd   - Setup systemd services for auto-start"
        echo "  build     - Build container images"
        echo ""
        echo "Environment variables:"
        echo "  USE_COMPOSE=true   - Use podman-compose instead of manual deployment"
        echo ""
        echo "Examples:"
        echo "  $0 receiver                    # Deploy receiver only"
        echo "  $0 full                        # Deploy with camera on Pi"
        echo "  USE_COMPOSE=true $0 receiver   # Use podman-compose"
        echo "  $0 logs stream_receiver        # View receiver logs"
        echo "  $0 shell camera_client         # Open camera client shell"
        echo "  $0 systemd                     # Setup auto-start services"
        ;;
esac