# Camera Stream Receiver

TypeScript/Express web application for receiving and displaying camera video streams via Redis streams, with frame recording capabilities.

## Features

- Real-time MJPEG video streaming from Redis streams
- Multi-camera support with automatic stream discovery
- Frame recording to disk for algorithm development
- Hole detection notifications via Redis pub/sub
- Clean TypeScript implementation

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
│   │   ├── redis_manager.ts   # Redis stream handler
│   │   └── frame_recorder.ts  # Frame recording to disk
│   ├── types/
│   │   ├── camera.types.ts    # Camera-related type definitions
│   │   └── api.types.ts       # API response types
│   └── client/
│       └── src/
│           ├── camera_selection.ts      # Frontend entry point
│           ├── streaming/
│           │   ├── MJPEGStreamClient.ts # MJPEG frame receiver
│           │   └── canvas_renderer.ts   # Canvas rendering utilities
│           ├── features/
│           │   └── frame_recording_controls.ts  # Recording UI
│           └── types/
│               └── streaming.types.ts   # Client type definitions
├── public/
│   ├── index.html             # Web interface
│   ├── css/
│   │   └── styles.css
│   └── js/                    # Compiled client-side JS (generated)
├── dist/                      # Compiled server-side JS (generated)
├── data/frames/               # Frame recording output directory
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
└── docker-compose.dev.yml
```

## Quick Start

### Prerequisites

- Node.js 18+ (LTS recommended)
- Redis server with stream support

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
   REDIS_STREAM_PATTERN=camera_stream:*
   REDIS_HOLE_CHANNEL=hole_notifications
   REDIS_DISCOVERY_INTERVAL=5000
   SERVER_PORT=5000
   FRAME_SAVE_PATH=./data/frames
   ```

4. **Run in development mode:**
   ```bash
   npm run dev
   ```

5. **Access the web interface:**
   - Open http://localhost:5000 in your browser
   - Camera streams will appear as buttons when detected

## Docker

Multi-stage Dockerfile with `dev` and `prod` targets. The production image is published as
a multi-arch manifest (`linux/amd64` + `linux/arm64`) so the same tag runs on both a
development machine and a Raspberry Pi without any changes to the compose file.

### Running the full stack (production)

On a **Raspberry Pi**, start all services including the camera producer:

```bash
docker compose --profile pi up
```

On a **development machine** (no camera hardware), omit the profile to start only Redis and the stream-receiver:

```bash
docker compose up
```

> `camera-producer` uses Linux-specific device paths (`/dev/video0`, `/dev/media0`, etc.) and will only run correctly on the Pi. It is gated behind the `pi` profile so it is skipped by default on other platforms.

### Dev auto-reload

Builds the `dev` image locally, bind-mounts `src/` and `public/` into the container,
and starts nodemon so source changes are picked up without rebuilding.
Works on both Windows (Docker Desktop) and Linux:

```bash
npm run docker:dev
```

### Publishing a new production image

Requires a buildx builder with multi-platform support. First-time setup:

```bash
docker buildx create --use --name multiplatform --platform linux/amd64,linux/arm64
```

Then build and push:

```bash
npm run docker:push
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with auto-reload (local) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run build:server` | Compile server-side TypeScript only |
| `npm run build:client` | Compile client-side TypeScript only |
| `npm start` | Run production build |
| `npm run docker:dev` | Start dev stack in Docker with live reload |
| `npm run docker:push` | Build and push multi-arch production image |

## API Endpoints

### Camera Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/camera/available` | List of active camera IDs |
| GET | `/camera/discover` | Trigger stream discovery |
| GET | `/camera/status` | Detailed system status |
| GET | `/camera/debug/:cameraId` | Single JPEG with validation info |
| GET | `/camera/frame/:cameraId` | Latest JPEG frame |
| GET | `/camera/stream/:cameraId` | MJPEG binary stream |
| GET | `/camera/holes/sse` | Hole detection notifications (SSE) |

### Recording Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/camera/recording/start` | Start frame recording session |
| POST | `/camera/recording/stop` | Stop recording session |
| GET | `/camera/recording/status` | Recording session status |

### Example Usage

**MJPEG Stream in browser:**
```html
<img src="/camera/stream/camera1" alt="Camera Feed">
```

**MJPEG Stream with JavaScript:**
```javascript
const client = new MJPEGStreamClient('camera1');
client.addEventListener('frame', (event) => {
    const { image } = event.detail;
    ctx.drawImage(image, 0, 0);
});
client.connect();
```

## Redis Setup

The application reads from Redis streams using pattern matching (`camera_stream:*`).

### Redis Server (Docker)
```bash
docker run -d \
  --name redis-broker \
  -p 6379:6379 \
  redis:alpine
```

### Camera Publisher Example

Cameras should write JPEG-encoded frames to Redis streams like `camera_stream:cam1`.

**Python example:**
```python
import redis
import cv2

client = redis.Redis(host='localhost', port=6379)

cap = cv2.VideoCapture(0)
ret, frame = cap.read()
if ret:
    _, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    client.xadd('camera_stream:cam1', {'image': encoded.tobytes()}, maxlen=10)
```

## Architecture

```
┌─────────────┐   Redis Stream   ┌──────────────┐    MJPEG     ┌─────────────────┐
│   Camera    │ ───xadd─────────>│    Server    │ ──stream────>│  Browser Client │
│  Publisher  │   (JPEG binary)  │   (Express)  │  (binary)    │   (Canvas)      │
└─────────────┘                  └──────────────┘              └─────────────────┘
                                        │
                                        │ xrevrange
                                        ▼
                                 ┌──────────────┐
                                 │    Redis     │
                                 │   Streams    │
                                 └──────────────┘
```

### Server-Side Components

1. **RedisManager** (`src/services/redis_manager.ts`)
   - Maintains Redis connections for streams and pub/sub
   - Pattern-based stream discovery (`camera_stream:*`)
   - Reads latest frames via `XREVRANGE`
   - Subscribes to hole notification channel

2. **CameraService** (`src/services/camera_service.ts`)
   - Tracks camera states and viewer counts
   - Manages frame listeners per camera
   - Integrates frame recording

3. **FrameRecorder** (`src/services/frame_recorder.ts`)
   - Creates timestamped session directories
   - Saves frames as numbered JPEGs
   - Generates session metadata

### Client-Side Components

1. **MJPEGStreamClient** (`src/client/src/streaming/MJPEGStreamClient.ts`)
   - Connects to MJPEG binary stream
   - Emits frame events at up to 30 FPS
   - Handles connection lifecycle

2. **CanvasRenderer** (`src/client/src/streaming/canvas_renderer.ts`)
   - Renders frames to HTML canvas
   - Handles image decoding

## Frame Recording

Recording sessions save frames to disk for offline analysis:

```
data/frames/
└── 2024-01-15_14-30-00/
    ├── session_info.json
    ├── camera1/
    │   ├── frame_0001.jpg
    │   ├── frame_0002.jpg
    │   └── ...
    └── camera2/
        └── ...
```

## Dependencies

**Runtime:**
- `express` - Web framework
- `ioredis` - Redis client
- `dotenv` - Environment configuration

**Development:**
- `typescript` - Type checking and compilation
- `ts-node` - TypeScript execution
- `nodemon` - Development auto-reload

## Troubleshooting

### No cameras appearing
- Check Redis is running: `redis-cli ping`
- Verify streams exist: `redis-cli keys "camera_stream:*"`
- Check server logs for stream discovery

### Video not displaying
- Try debug endpoint: `/camera/debug/:cameraId`
- Check browser console for errors
- Verify JPEG data is valid in Redis

### Build errors
```bash
# Clean and rebuild
rm -rf dist/ public/js/
npm run build
```

## License

MIT

## Author

[Benten559](https://github.com/Benten559)
