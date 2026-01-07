# Camera Stream Receiver

TypeScript/Express web application for receiving and displaying camera video streams via Redis pub/sub, with real-time computer vision feature processing.

## Features

### Streaming
- Real-time MJPEG video streaming from Redis pub/sub
- Multi-camera support with pattern-based subscriptions
- Server-Sent Events (SSE) alternative streaming method

### Computer Vision Pipeline
- **Feature Pipeline Architecture** - Composable, context-driven feature processing
- **Fiducial Marker Detection** - ArUco marker detection using OpenCV.js
- **Bullet Hole Detection** - Sobel edge detection, connected components, and shape analysis
- **Live Parameter Tuning** - Real-time control panels for algorithm parameters
- **Layered Rendering** - Single shared canvas with automatic feature composition

### Development
- Type-safe TypeScript implementation
- Production-ready build system
- Clean, maintainable architecture

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
│           ├── camera_selection.ts      # Frontend entry point
│           ├── streaming/
│           │   ├── sse_client.ts        # SSE frame receiver
│           │   └── canvas_renderer.ts   # Canvas rendering utilities
│           ├── features/
│           │   ├── feature_manager.ts           # Feature pipeline orchestrator
│           │   ├── setup_features.ts            # Feature toggle UI
│           │   ├── fiducial_detection.ts        # ArUco marker detection
│           │   └── bullet_hole_detection.ts     # Bullet hole detection
│           └── types/
│               └── streaming.types.ts   # Feature system types
├── public/
│   ├── index.html             # Web interface
│   ├── css/
│   │   └── styles.css
│   └── js/                    # Compiled client-side JS (generated)
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

### System Overview

```
┌─────────────┐     Redis      ┌──────────────┐     SSE      ┌─────────────────────┐
│   Camera    │ ──publish────> │    Server    │ ──stream───> │   Browser Client    │
│  Publisher  │   (JPEG)       │ (Node/Redis) │  (base64)    │  (Feature Pipeline) │
└─────────────┘                └──────────────┘              └─────────────────────┘
                                                                       │
                                                              ┌────────▼─────────┐
                                                              │  FeatureManager  │
                                                              │ (Context Pipeline)│
                                                              └────────┬─────────┘
                                                                       │
                                      ┌────────────────────────────────┼────────────────────────────┐
                                      │                                │                            │
                              ┌───────▼────────┐            ┌──────────▼──────────┐     ┌─────────▼────────┐
                              │   Fiducial     │  markers   │   Bullet Hole       │     │   Future Feature │
                              │   Detection    │ ─────────> │    Detection        │     │   (Layer N)      │
                              │   (Layer 0)    │  context   │   (Layer 1)         │     │                  │
                              └────────────────┘            └─────────────────────┘     └──────────────────┘
```

### Server-Side Components

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
   - SSE-based streaming (used by feature pipeline)
   - Camera metadata endpoints

### Client-Side Architecture

#### Feature Pipeline System

The client uses a **context pipeline architecture** where features process frames sequentially and pass data to downstream features via a shared context object.

**Core Flow:**
```
Frame arrives (SSE) → Decode once → FeatureManager.processFeatures():

  1. Prepare shared canvas (resize, clear)
  2. Initialize empty context: {}
  3. For each enabled feature (sorted by layer):
     - feature.process(imageData, sharedCanvas, context)
     - Merge returned context for next feature
  4. All features render to same canvas (layered composition)
```

#### Key Components

1. **SSEStreamClient** (`src/client/src/streaming/sse_client.ts`)
   - Connects to `/camera/stream/:cameraId/sse`
   - Receives base64-encoded JPEG frames
   - Emits 'frame' events

2. **CanvasRenderer** (`src/client/src/streaming/canvas_renderer.ts`)
   - Decodes base64 JPEG to ImageData
   - Renders frames to canvas
   - Manages canvas lifecycle

3. **FeatureManager** (`src/client/src/features/feature_manager.ts`)
   - Orchestrates feature pipeline
   - Manages single shared canvas
   - Implements context flow between features
   - Handles feature toggling and lifecycle

4. **Features** (implement `FeatureProcessor` interface)
   - Receive: `(imageData, sharedCanvas, context)`
   - Return: `context` object with new data
   - Draw visualizations to shared canvas
   - Declare pipeline metadata (layer, provides, consumes)

### Feature Pipeline Pattern

Each feature follows this pattern:

```typescript
const myFeature: Feature = {
  id: 'my-feature',
  name: 'My Feature',
  description: 'What this feature does',
  process: (imageData, sharedCanvas, context) => {
    // 1. Read data from context (from previous features)
    const markers = context.markers;

    // 2. Process the image
    const results = detectSomething(imageData, markers);

    // 3. Draw visualization
    const ctx = sharedCanvas.getContext('2d')!;
    drawResults(ctx, results);

    // 4. Return data for next features
    return { myData: results };
  },
  enabled: false,
  pipeline: {
    layer: 1,              // Drawing order (0 = bottom)
    consumes: ['markers'], // What this feature needs
    provides: ['myData'],  // What this feature outputs
  },
};
```

### Current Features

#### 1. Fiducial Marker Detection
**File:** `src/client/src/features/fiducial_detection.ts`

- **Technology:** OpenCV.js ArUco detection
- **Purpose:** Detect ArUco markers (5x5 dictionary, IDs 0-99)
- **Pipeline:** Layer 0 (base layer)
- **Provides:** `markers` - Array of detected markers with corners and centers
- **Use Case:** Camera calibration, ROI definition for other features

#### 2. Bullet Hole Detection
**File:** `src/client/src/features/bullet_hole_detection.ts`

- **Technology:** Custom computer vision 
  - Sobel edge detection
  - Connected components (flood fill)
  - Shape analysis (circularity, compactness)
- **Pipeline:** Layer 1 (draws on top of markers)
- **Consumes:** `markers` - Uses markers 0-3 to define ROI
- **Provides:** `holes` - Detected and tracked bullet holes
- **Features:**
  - Temporal tracking (hole persistence across frames)
  - ROI processing (only search within marker bounds)
  - Exclusion zones (ignore marker regions)
  - Live parameter controls (sliders for all CV parameters)
- **Performance:** ~5-10ms processing time

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

**Feature Context Flow**

Features communicate via the context object without direct dependencies:

```typescript
// Fiducial detection (Layer 0)
return { markers: detectedMarkers };

// Bullet hole detection (Layer 1)
const markers = context.markers; // Read from previous feature
// ... use markers to define ROI
return { holes: detectedHoles };
```

This enables:
- **Loose coupling** - No imports between features
- **Graceful degradation** - Features work without dependencies
- **Easy testing** - Features are pure functions
- **Extensibility** - Add features without modifying existing ones

## Development

### TypeScript Configuration

- **Module System:** ESNext with CommonJS output
- **Target:** ESNext
- **Strict Mode:** Enabled
- **Output:** `src/` → `dist/`
- **Source Maps:** Enabled

### Adding a New Feature

1. **Create feature file** in `src/client/src/features/`:

```typescript
import type { Feature, FeatureProcessor, FeatureContext } from '../types/streaming.types.js';

const myFeatureProcessor: FeatureProcessor = (
  imageData,
  sharedCanvas,
  context
): FeatureContext => {
  const ctx = sharedCanvas.getContext('2d')!;

  // Read from context
  const existingData = context.someData;

  // Process image
  const results = processImage(imageData, existingData);

  // Draw visualization
  ctx.strokeStyle = '#00ff00';
  ctx.strokeRect(10, 10, 100, 100);

  // Return data for next features
  return { myResults: results };
};

export const myFeature: Feature = {
  id: 'my-feature',
  name: 'My Feature',
  description: 'What this feature does',
  process: myFeatureProcessor,
  enabled: false,
  pipeline: {
    layer: 2,                    // Higher = drawn on top
    consumes: ['someData'],      // Optional: what you need
    provides: ['myResults'],     // Optional: what you output
  },
};
```

2. **Register feature** in `src/client/src/camera_selection.ts`:

```typescript
import { myFeature } from './features/my_feature.js';

currentFeatureManager.registerFeature(myFeature);
```

3. **Rebuild:**
```bash
npm run build:client
```

### Feature Best Practices

1. **Layer Assignment:**
   - Layer 0: Base image processing (draw base image with `putImageData`)
   - Layer 1+: Overlays (draw on top of existing canvas)

2. **Context Usage:**
   - Only read what you declare in `consumes`
   - Always return what you declare in `provides`
   - Use TypeScript interfaces for type safety

3. **Performance:**
   - Keep processing under 10ms per frame
   - Use Web Workers for heavy computation
   - Cache results when possible

4. **Error Handling:**
   - Always return a context object (even if empty)
   - Handle missing dependencies gracefully
   - Log errors but don't crash the pipeline

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

### Features not working
- **OpenCV.js not loading:**
  - Check browser console for "OpenCV.js ready" message
  - Verify OpenCV.js script is loaded in `public/index.html`
  - Wait a few seconds after page load for OpenCV.js initialization

- **Features not appearing:**
  - Check browser console for feature registration logs
  - Verify feature is enabled via toggle button
  - Check that `FeatureManager` is initialized

- **Context not flowing between features:**
  - Check feature order (lower layers process first)
  - Verify `provides` matches what you `return {}`
  - Check browser console for "Feature X provided: [...]" logs

### Build errors
```bash
# Clean and rebuild
rm -rf dist/ public/js/
npm run build

# Client-only rebuild
npm run build:client

# Server-only rebuild
npm run build:server
```

### Redis connection issues
```bash
# Test Redis connectivity
redis-cli -h localhost -p 6379 ping

# Check Redis channels
redis-cli -h localhost -p 6379 pubsub channels "camera_stream:*"
```

### Performance issues
- **Low FPS:** Check feature processing times in console logs
- **High memory usage:** Ensure OpenCV matrices are properly deleted
- **Lag in browser:** Reduce number of enabled features or lower stream resolution

## License

MIT

## Author

[Benten559](https://github.com/Benten559)
