# stream_receiver — Project Context

RPi4B camera streaming system. Python captures frames via Picamera2 and publishes to Redis. A Node/TypeScript Express server reads from Redis and serves an MJPEG stream + web UI to connected clients. Everything runs in Docker containers on the host network.

## Architecture

```
Picamera2 (Python) → Redis streams → Express (TypeScript) → MJPEG → Browser
```

- **Redis** — message broker, runs as `redis:7-alpine`
- **camera-producer** — Python container, publishes JPEG frames to `camera_stream:<CAMERA_ID>` and high-res frames to `camera_hires:<CAMERA_ID>`
- **stream-receiver** — Node/TypeScript container, serves `/camera/stream/:id` as MJPEG, also records frames to disk on demand
- All containers use `network_mode: host` in production so they can communicate via localhost and the camera-producer can reach Pi hardware

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production compose — uses prebuilt images |
| `docker-compose-debug.yml` | Debug compose — builds locally, bind mounts source |
| `Dockerfile` | Node server image build |
| `pi_fast_contained.py` | Standalone Python camera producer script (not the container entrypoint — container source is at `../Stream4Pi`) |
| `src/services/frame_recorder.ts` | Saves JPEG frames to disk during recording sessions |
| `src/config/index.ts` | Environment-based config; `FRAME_SAVE_PATH` controls where frames are written |

## Open Goals

### 1. Field WiFi (AP mode) — broken connectivity

The RPi broadcasts its own WiFi hotspot in the field (no internet). Clients connect to that AP but cannot reach the web UI.

**What's likely broken:** The Pi's AP config (`hostapd` + `dnsmasq` or `dhcpcd`) isn't routing traffic correctly when acting as AP. The containers are fine — they use `network_mode: host` so they bind to all interfaces. The fix is at the OS level: ensure `dnsmasq` hands out a DNS/gateway pointing at the Pi's AP interface IP, and that IP tables/forwarding is set up. The web UI is on port `5000`.

**Not a Docker issue** — containers already listen on all interfaces via host network mode.

---

### 2. Debug docker-compose — in progress

`docker-compose-debug.yml` exists and covers most of this, but needs review:

- **Node hot-reload**: debug compose bind-mounts source (`.:/app`) and uses `build: .` — just make sure the container CMD runs `npm run dev` (nodemon) instead of `npm start`
- **Python verbose logging**: `pi_fast_contained.py` uses `logging.basicConfig(level=logging.INFO)` — needs a `LOG_LEVEL` env var to switch to `DEBUG`. The camera-producer in compose points to `../Stream4Pi` (sibling repo), not to `pi_fast_contained.py`
- **Device fallback env vars**: when the Pi hardware devices (`/dev/video0`, `/dev/media*`) don't exist on a dev machine, compose will fail — need conditional device mounts or a `--profile` flag
- **Network mismatch**: debug compose switches from `network_mode: host` to a bridge network `camera-network`. This means `REDIS_HOST` must be the service name (`redis`), not `localhost`. Already done in debug compose, but watch for this when toggling between files.

---

### 3. External SSD — detection + write permissions

An external SSD is attached in the field and mapped via `DATA_PATH` env var → `/data` in the container. Two problems:

**Detection/fallback**: If `DATA_PATH` is unset or the SSD isn't mounted, `docker-compose.yml` falls back to `./local_data` (already handled by `${DATA_PATH:-./local_data}`). But the application itself doesn't know whether it's writing to SSD or local disk — adding a startup log or health-check that prints where `FRAME_SAVE_PATH` resolves would help.

**Write permissions**: The Dockerfile creates `/data/frames` and chowns it to `stream:nodejs` (uid 1001). When the SSD is bind-mounted at runtime, the mounted filesystem's ownership won't match uid 1001 — writes fail. Fix options:
- Add an entrypoint script that `chown`s the mount point before dropping to the `stream` user
- Or run the container as root (set `user: root` in compose) and rely on filesystem permissions on the SSD
- Entrypoint approach is cleaner for production; root is fine for debug

Current branch `bugfix/file-write` is likely addressing this.

## Environment Variables (stream-receiver)

| Var | Default | Description |
|-----|---------|-------------|
| `NODE_ENV` | `production` | `development` enables verbose logging |
| `REDIS_HOST` | `localhost` | Use service name in bridge network mode |
| `REDIS_PORT` | `6379` | |
| `REDIS_CHANNEL_PATTERN` | `camera_stream:*` | Stream discovery pattern |
| `SERVER_PORT` | `5000` | |
| `FRAME_SAVE_PATH` | `/data/frames` | Where recording sessions are saved |
| `DATA_PATH` | `./local_data` | Host-side mount for `/data` (set to SSD path when attached) |

## Environment Variables (camera-producer)

| Var | Default | Description |
|-----|---------|-------------|
| `CAMERA_ID` | `raspberrypi` | Sets stream key `camera_stream:<id>` |
| `WIDTH` / `HEIGHT` | `4056` / `3040` | Full sensor resolution |
| `L_WIDTH` / `L_HEIGHT` | `1024` / `768` | Low-res stream resolution |
| `ROT` | `90` | Rotation degrees |
| `FPS` | `30` | |
| `JPEG_QUALITY` | `85` | |

## Branch Notes

- Main working branch: `develop`
- Current: `bugfix/file-write` — fixing the SSD write permissions issue
