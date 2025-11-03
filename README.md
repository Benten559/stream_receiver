# Camera Stream Receiver

Flask web application for receiving and displaying camera video streams via Redis pub/sub.

## Project Structure

```
stream_receiver/
├── app/
│   ├── __init__.py
│   ├── main.py              # Flask application entry point
│   ├── config.py            # Configuration management
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes.py        # HTTP routes and streaming endpoints
│   ├── core/
│   │   ├── __init__.py
│   │   └── frame_broadcaster.py  # Redis frame handler
│   ├── templates/
│   │   └── index.html       # Web interface
│   └── utils/
│       ├── __init__.py
│       └── logging.py       # Logging configuration
├── requirements.txt         # Python dependencies
├── venv/                   # Python virtual environment
└── README.md
```

## Quick Start

### Prerequisites

- Python 3.11+
- Redis server (running on localhost:6379 or remote)

### Setup

1. **Clone and navigate to project:**
   ```bash
   git clone <repository-url>
   cd stream_receiver
   ```

2. **Create and activate virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application:**
   ```bash
   python -m app.main
   ```

5. **Access the web interface:**
   - Open http://localhost:5000 in your browser
   - The stream will display frames published to Redis channel `camera_stream`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| REDIS_HOST | localhost | Redis server hostname |
| REDIS_PORT | 6379 | Redis server port |
| REDIS_CHANNEL | camera_stream | Redis pub/sub channel |
| FLASK_ENV | development | Flask environment |
| HOST | 0.0.0.0 | Flask bind address |
| PORT | 5000 | Flask port |

### Example with custom Redis server:
```bash
export REDIS_HOST=192.168.1.100
export REDIS_PORT=6379
python -m app.main
```

## API Endpoints

- `GET /` - Web interface for viewing stream
- `GET /video_stream` - Direct Redis video stream (HTTP multipart)
- `GET /video_feed` - Single frame endpoint
- `GET /status` - System status and frame statistics

## Redis Setup

The application expects a Redis server with camera frames being published to the configured channel. Frames should be published as JPEG-encoded byte data.

Here is the docker command used in the typical Redis configuration:
```bash
docker run -d --name redis-broker -p 6379:6379 -v /var/log/redis:/var/log/redis redis:alpine redis-server --logevel verbose --logfile /var/log/redis/redis.log
```

### Example Redis publisher (separate camera client):
```python
import redis
import cv2

# Connect to Redis
client = redis.Redis(host='localhost', port=6379, decode_responses=False)

# Capture and publish frame
cap = cv2.VideoCapture(0)
ret, frame = cap.read()
if ret:
    _, encoded = cv2.imencode('.jpg', frame)
    client.publish('camera_stream', encoded.tobytes())
```

## Development

### Running in development mode:
```bash
export FLASK_ENV=development
python -m app.main
```

### Project dependencies:
- **Flask 3.1.1** - Web framework
- **redis 6.2.0** - Redis client library
- Supporting packages for templating and utilities

## Troubleshooting

**ModuleNotFoundError: No module named 'app'**
- Make sure you're running from the project root directory
- Use `python -m app.main` instead of `python app/main.py`
- Ensure virtual environment is activated

**Redis connection failed:**
```bash
# Test Redis connectivity
redis-cli -h localhost -p 6379 ping
```

**No video stream:**
- Check that frames are being published to Redis channel
- Verify Redis connection in application logs
- Check `/status` endpoint for frame statistics