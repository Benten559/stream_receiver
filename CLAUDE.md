# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stream Receiver is a web server that receives and displays camera video streams via Redis pub/sub. Originally a Python/Flask application, it has been refactored to TypeScript/Express (branch: `feature/javascript-refactor`).

The application subscribes to Redis channels using a pattern (`camera_stream:*`) to support multiple camera streams simultaneously. Each camera publishes JPEG-encoded frames to its own channel (e.g., `camera_stream:cam1`, `camera_stream:cam2`).

## Development Commands

### Install Dependencies
```bash
npm install
```

### Development Mode (auto-reload on changes)
```bash
npm run dev
# or manually:
npx nodemon --exec ts-node src/server.ts
```

### Build TypeScript to JavaScript
```bash
npm run build
# Compiles src/ to dist/ using tsconfig.json
```

### Run Production Build
```bash
npm start
# Runs compiled JavaScript from dist/server.js
```

### Direct TypeScript Execution (for testing)
```bash
npm test
# or manually:
npx ts-node src/server.ts
```

## Architecture

### Core Components

**Entry Point Flow:**
1. `src/server.ts` - Loads environment config via dotenv, initializes config, starts Express server
2. `src/app.ts` - Configures Express app, registers middleware and routes
3. Server listens on port 8000 (default) or `SERVER_PORT` env variable

**Redis Pattern Subscription:**
- `src/services/redis_manager.ts` (`RedisManager` class) - Manages Redis connection and pattern-based pub/sub
- Uses `pSubscribe()` to listen to `camera_stream:*` pattern (configurable via `REDIS_CHANNEL_PATTERN`)
- Extracts camera ID from channel name (e.g., `camera_stream:cam1` → `cam1`)
- Emits `CameraFrame` objects via callback when frames arrive

**Camera State Management:**
- `CameraState` interface tracks per-camera metadata: viewer count, latest frame, last seen timestamp, unsubscribe timer
- Unsubscribe delay allows graceful cleanup when no viewers are watching (default: 30 seconds)

**Routes:**
- `src/routes/camera.ts` - Camera-related HTTP endpoints (currently stub implementations)
  - `GET /camera/available` - Intended to list available camera channels from Redis
  - `POST /camera` - Placeholder for camera operations

### Type System

**`src/types/camera.types.ts`:**
- `CameraFrame` - Individual frame with cameraId, frameData (Buffer), timestamp
- `CameraState` - Runtime state for each camera stream

### Configuration

**`src/config/index.ts`** - Centralized configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | localhost | Redis server hostname |
| `REDIS_PORT` | 6379 | Redis server port |
| `REDIS_CHANNEL_PATTERN` | camera_stream:* | Pattern for camera stream channels |
| `SERVER_PORT` | 8000 | Express server port |
| `UNSUBSCRIBE_DELAY` | 30 | Seconds to wait before unsubscribing from unused channels |

## TypeScript Configuration

- **Module System:** CommonJS (`module: "commonjs"`)
- **Target:** ESNext
- **Strict Mode:** Enabled with additional checks (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Output:** `src/` → `dist/` with source maps and declaration files
- **Import Extensions:** File imports use `.ts` extensions in source (will resolve to `.js` in compiled output)

## Redis Setup

The application expects a Redis server with cameras publishing JPEG frames to channels matching the pattern `camera_stream:<camera_id>`.

**Typical Redis Docker command:**
```bash
docker run -d --name redis-broker -p 6379:6379 -v /var/log/redis:/var/log/redis redis:alpine redis-server --loglevel verbose --logfile /var/log/redis/redis.log
```

**Camera publisher format:**
Frames should be published as raw JPEG-encoded bytes (Buffer) to channels like `camera_stream:cam1`.

## Branch Strategy

- Main branch: `develop`
- Current feature branch: `feature/javascript-refactor` (TypeScript/Express refactor from Python/Flask)
