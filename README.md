# Camera Stream Receiver

TypeScript/Express web application for receiving and displaying camera video streams via Redis pub/sub.

## Features

- Real-time MJPEG video streaming from Redis pub/sub
- Multi-camera support with pattern-based subscriptions
- Server-Sent Events (SSE) alternative streaming method
- Type-safe TypeScript implementation
- Production-ready build system

## Project Structure

```
stream_receiver/
├── src/
│   ├── server.ts              # Application entry point
│   ├── app.ts                 # Express app configuration
│   ├── config/
│   │   └── index.ts           # Environment-based configuration
│   ├── routes/
│   │   └── camera.ts          # Camera streaming endpoints
│   ├── services/
│   │   ├── camera_service.ts  # Camera state and subscription management
│   │   └── redis_manager.ts   # Redis pub/sub handler
│   ├── types/
│   │   ├── camera.types.ts    # Camera-related type definitions
│   │   └── api.types.ts       # API response types
│   └── client/
│       └── src/
│           └── camera_selection.ts  # Frontend TypeScript
├── public/
│   ├── index.html             # Web interface
│   ├── css/
│   │   └── styles.css
│   └── js/                    # Compiled client-side JS
├── dist/                      # Compiled server-side JS (generated)
├── package.json
├── tsconfig.json
└── nodemon.json
```

## Quick Start

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm or yarn
- Redis server (running locally or remote)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Benten559/stream_receiver.git
   cd stream_receiver
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the project root:
   ```env
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_CHANNEL_PATTERN=camera_stream:*
   SERVER_PORT=8000
   UNSUBSCRIBE_DELAY=30
   ```

4. **Run in development mode:**
   ```bash
   npm run dev
   ```

5. **Access the web interface:**
   - Open http://localhost:8000 in your browser
   - Camera streams will appear as buttons when detected

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with auto-reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run production build |
| `npm test` | Run TypeScript directly (for testing) |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | localhost | Redis server hostname |
| `REDIS_PORT` | 6379 | Redis server port |
| `REDIS_CHANNEL_PATTERN` | camera_stream:* | Pattern for camera stream channels |
| `SERVER_PORT` | 8000 | Express server port |
| `UNSUBSCRIBE_DELAY` | 30 | Seconds to wait before unsubscribing from unused channels |

### Example with remote Redis server:
```bash
REDIS_HOST=192.168.8.100 REDIS_PORT=6379 npm start
```

## API Endpoints

### Camera Endpoints

- `GET /camera/available` - List of active camera IDs
- `GET /camera/status` - Detailed system status and camera states
- `GET /camera/frame/:cameraId` - Get latest JPEG frame for a camera
- `GET /camera/stream/:cameraId` - MJPEG stream (use in `<img>` tag)
- `GET /camera/stream/:cameraId/sse` - Server-Sent Events stream (base64 encoded)

### Example Usage

**MJPEG Stream (recommended):**
```html
<img src="/camera/stream/raspberrypi" alt="Camera Feed">
```

**Server-Sent Events:**
```javascript
const eventSource = new EventSource('/camera/stream/raspberrypi/sse');
eventSource.addEventListener('frame', (event) => {
    const base64Frame = event.data;
    img.src = `data:image/jpeg;base64,${base64Frame}`;
});
```

## Redis Setup

The application subscribes to Redis channels using pattern matching (`camera_stream:*`) to support multiple cameras. Each camera should publish JPEG frames to its own channel.

### Redis Server (Docker)
```bash
docker run -d \
  --name redis-broker \
  -p 6379:6379 \
  -v /var/log/redis:/var/log/redis \
  redis:alpine \
  redis-server --loglevel verbose --logfile /var/log/redis/redis.log
```

### Camera Publisher Example

Cameras should publish JPEG-encoded frames to channels like `camera_stream:cam1`, `camera_stream:cam2`, etc.

**Python example:**
```python
import redis
import cv2

# Connect to Redis (important: decode_responses=False for binary data)
client = redis.Redis(host='localhost', port=6379, decode_responses=False)

# Capture and publish frame
cap = cv2.VideoCapture(0)
ret, frame = cap.read()
if ret:
    _, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    client.publish('camera_stream:raspberrypi', encoded.tobytes())
```

## Architecture

### Core Components

1. **RedisManager** (`src/services/redis_manager.ts`)
   - Manages Redis connection with buffer mode enabled
   - Pattern-based subscription to `camera_stream:*`
   - Emits camera frames via callback

2. **CameraService** (`src/services/camera_service.ts`)
   - Tracks camera states and viewer counts
   - Manages frame listeners per camera
   - Handles graceful unsubscribe with delay

3. **Camera Routes** (`src/routes/camera.ts`)
   - MJPEG multipart streaming
   - SSE-based streaming
   - Camera metadata endpoints

### Key Implementation Details

**Critical: Redis Buffer Mode**

The Redis client must be configured to receive binary data as Buffers (not decoded strings) to preserve JPEG integrity:

```typescript
await this.subscriber.pSubscribe(
    channelPattern,
    (message: Buffer, channel: Buffer) => {
        // Handle binary JPEG data
    },
    true  // ← Enable buffer mode
);
```

## Development

### TypeScript Configuration

- **Module System:** ESNext with CommonJS output
- **Target:** ESNext
- **Strict Mode:** Enabled
- **Output:** `src/` → `dist/`
- **Source Maps:** Enabled

### Adding a New Camera Endpoint

1. Add route in `src/routes/camera.ts`
2. Update types in `src/types/api.types.ts`
3. Rebuild: `npm run build`

## Troubleshooting

### No cameras appearing
- Check Redis is running: `redis-cli ping`
- Verify publisher is sending to correct channel pattern
- Check server logs for "New camera detected"

### Video not displaying
- Ensure Redis buffer mode is enabled (see Architecture section)
- Check browser console for errors
- Verify JPEG data is valid (check server logs)
- Try accessing stream URL directly: `http://localhost:8000/camera/stream/your-camera-id`

### Build errors
```bash
# Clean and rebuild
rm -rf dist/
npm run build
```

### Redis connection issues
```bash
# Test Redis connectivity
redis-cli -h localhost -p 6379 ping

# Check Redis channels
redis-cli -h localhost -p 6379 pubsub channels "camera_stream:*"
```

## License

MIT

## Author

[Benten559](https://github.com/Benten559)
