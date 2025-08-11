#!/bin/bash

# Stream Receiver Deployment Script for Raspberry Pi
set -e

echo "🚀 Stream Receiver Deployment Script"
echo "=================================="

# Check if Docker and Docker Compose are available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create necessary directories
echo "📁 Creating log directories..."
sudo mkdir -p /var/log/redis
sudo chmod 755 /var/log/redis

# Function to deploy receiver only (for remote viewing)
deploy_receiver() {
    echo "🖥️  Deploying Stream Receiver (without camera)..."
    docker-compose up -d redis stream-receiver
    
    echo "✅ Stream Receiver deployed successfully!"
    echo "   Web interface: http://localhost:5000"
    echo "   Status API: http://localhost:5000/status"
    echo ""
    echo "   To view logs: docker-compose logs -f stream-receiver"
    echo "   To stop: docker-compose down"
}

# Function to deploy full stack with camera
deploy_with_camera() {
    echo "📷 Deploying Full Stack (with camera client)..."
    docker-compose --profile camera up -d
    
    echo "✅ Full stack deployed successfully!"
    echo "   Web interface: http://localhost:5000"
    echo "   Status API: http://localhost:5000/status"
    echo ""
    echo "   To view logs:"
    echo "     Receiver: docker-compose logs -f stream-receiver"
    echo "     Camera:   docker-compose logs -f camera-client"
    echo "   To stop: docker-compose --profile camera down"
}

# Function to show status
show_status() {
    echo "📊 Current deployment status:"
    docker-compose ps
    echo ""
    echo "📋 Service logs (last 10 lines):"
    docker-compose logs --tail=10
}

# Parse command line arguments
case "${1:-help}" in
    "receiver")
        deploy_receiver
        ;;
    "full")
        deploy_with_camera
        ;;
    "status")
        show_status
        ;;
    "stop")
        echo "🛑 Stopping all services..."
        docker-compose --profile camera down
        echo "✅ All services stopped."
        ;;
    "logs")
        docker-compose logs -f ${2:-}
        ;;
    "help"|*)
        echo "Usage: $0 {receiver|full|status|stop|logs [service]}"
        echo ""
        echo "Commands:"
        echo "  receiver  - Deploy only Redis + Stream Receiver (for remote viewing)"
        echo "  full      - Deploy Redis + Stream Receiver + Camera Client"
        echo "  status    - Show current deployment status"
        echo "  stop      - Stop all services"
        echo "  logs      - Show logs for all services or specific service"
        echo ""
        echo "Examples:"
        echo "  $0 receiver              # Deploy receiver for remote viewing"
        echo "  $0 full                  # Deploy on Pi with camera"
        echo "  $0 logs camera-client    # Show camera client logs"
        echo "  $0 status                # Check service status"
        ;;
esac