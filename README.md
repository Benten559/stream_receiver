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

### Images

| Tag | Stage | Purpose |
|-----|-------|---------|
| `benten559/stream-receiver:latest-prod` | `prod` | Compiled production build — what the Pi boots into |
| `benten559/stream-receiver:latest-dev` | `dev` | Nodemon hot-reload — for iterating on code changes |

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

This does **not** push anything — it is local-only and uses the `docker-compose.dev.yml` overlay.

### Publishing images

Requires a buildx builder with multi-platform support. First-time setup (one time per machine):

```bash
docker buildx create --use --name multiplatform --platform linux/amd64,linux/arm64
```

| Command | What it does |
|---------|-------------|
| `npm run docker:push:prod` | Build and push `latest-prod` (production build) |
| `npm run docker:push:dev` | Build and push `latest-dev` (nodemon hot-reload build) |
| `npm run docker:push` | Build and push both images in sequence |

**Typical dev iteration workflow:**

1. Make code changes locally
2. Test with `npm run docker:dev` (hot-reload, no push needed)
3. When ready to deploy: `npm run docker:push:prod`
4. On the Pi: `docker compose pull && docker compose up -d` to get the new image

**Promoting dev → prod:**

Both images are built from the same Dockerfile via `--target`. There is no separate "promote" step — running `npm run docker:push:prod` always builds a fresh prod image from the current working tree. If you want to update only the dev image (e.g. to share a debug build), use `npm run docker:push:dev` alone.

## Raspberry Pi Field Setup

This section documents the complete OS-level configuration to reproduce the split-radio WiFi AP on a fresh Raspberry Pi 4B. Follow these steps in order.

### Overview

The Pi uses a single physical WiFi chip (`wlan0`) carved into two virtual interfaces:

| Interface | Mode | Purpose |
|-----------|------|---------|
| `wlan0` | Client | Connects to the GL.iNet uplink router (internet-optional) |
| `uap0` | AP | Broadcasts `range-buddy` SSID, subnet 192.168.4.0/24 |

Field clients connect to `range-buddy` and reach the app at `http://192.168.4.1:5000`.
**The AP works fully offline** — `wlan0` can be disconnected or absent and `uap0` keeps broadcasting.

Boot service order: `uap0-interface` → `hostapd` + `dnsmasq` → `range-buddy-app`

### Step 1 — Install required packages

```bash
sudo apt update
sudo apt install -y hostapd dnsmasq netfilter-persistent iptables-persistent
```

Stop and mask the services until configuration is complete to prevent them from starting prematurely:

```bash
sudo systemctl stop hostapd dnsmasq
```

### Step 2 — Create the virtual AP interface service

Create `/etc/systemd/system/uap0-interface.service`:

```ini
[Unit]
Description=Create Virtual Wireless Interface uap0
After=network.target
Before=hostapd.service
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStartPre=/bin/sleep 5
ExecStart=/usr/sbin/iw dev wlan0 interface add uap0 type __ap
ExecStartPost=/usr/sbin/ip addr add 192.168.4.1/24 dev uap0
ExecStartPost=/usr/sbin/ip link set uap0 up
ExecStartPost=/usr/sbin/iw dev uap0 set power_save off
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable uap0-interface.service
```

The 5-second `ExecStartPre` sleep gives the WiFi driver time to finish initializing before carving the virtual interface.

### Step 3 — Configure hostapd

Write `/etc/hostapd/hostapd.conf`:

```ini
interface=uap0
driver=nl80211
ssid=range-buddy
hw_mode=g
channel=1
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=rb-proto-1
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
```

The modern Debian hostapd package automatically picks up `/etc/hostapd/hostapd.conf` — no edits to `/etc/default/hostapd` are needed.

```bash
sudo systemctl enable hostapd
```

### Step 4 — Configure dnsmasq

The following lines are the active configuration. Add them to `/etc/dnsmasq.conf` (the file ships heavily commented — search for existing `interface=` or `dhcp-range=` lines and replace/add as needed):

```
interface=uap0
dhcp-range=192.168.4.50,192.168.4.150,255.255.255.0,12h
domain=local
dhcp-option=3,192.168.4.1
dhcp-option=6,192.168.4.1
address=/gw.rangebuddy.local/192.168.4.1
bind-interfaces
```

What each line does:
- `interface=uap0` — dnsmasq only serves DHCP/DNS on the AP interface
- `dhcp-range` — hands out IPs in 192.168.4.50–150 with 12h leases
- `dhcp-option=3` — default gateway sent to clients is the Pi itself
- `dhcp-option=6` — DNS server sent to clients is the Pi (dnsmasq resolves locally, no internet needed)
- `address=/gw.rangebuddy.local/192.168.4.1` — convenience hostname for the Pi
- `bind-interfaces` — prevents dnsmasq from answering on other interfaces

Enforce service startup ordering so dnsmasq waits for `uap0` to exist:

```bash
sudo mkdir -p /etc/systemd/system/dnsmasq.service.d
```

Create `/etc/systemd/system/dnsmasq.service.d/override.conf`:

```ini
[Unit]
After=uap0-interface.service
Requires=uap0-interface.service
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable dnsmasq
```

### Step 5 — iptables rules

Clients typing `http://192.168.4.1` in a browser (port 80) get transparently redirected to the app on port 5000. The GL.iNet router's subnet (192.168.8.0/24) is exempted so its admin panel stays reachable from AP clients.

```bash
# Rule 1: exempt GL.iNet subnet (must be inserted before the redirect rule)
sudo iptables -t nat -A PREROUTING -p tcp -d 192.168.8.0/24 --dport 80 -j RETURN

# Rule 2: redirect all other port-80 traffic to 5000
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 5000

# Persist across reboots
sudo netfilter-persistent save
```

Verify the rule order (RETURN must be rule 1, REDIRECT must be rule 2):

```bash
sudo iptables -t nat -L PREROUTING -n --line-numbers
```

Expected output:
```
num  target     prot opt source               destination
1    RETURN     tcp  --  0.0.0.0/0            192.168.8.0/24       tcp dpt:80
2    REDIRECT   tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:80 redir ports 5000
```

If the order is wrong, flush and re-add:
```bash
sudo iptables -t nat -F PREROUTING
# then re-run the two rules above in order
sudo netfilter-persistent save
```

### Step 6 — App autostart service

Create `/etc/systemd/system/range-buddy-app.service`:

```ini
[Unit]
Description=Range Buddy camera streaming app
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/raspberrypi/poojects/repos/stream_receiver
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
```

> To also start the camera producer on boot, change `ExecStart` to:
> ```
> ExecStart=/usr/bin/docker compose --profile pi up -d
> ```

```bash
sudo systemctl daemon-reload
sudo systemctl enable range-buddy-app.service
```

### Step 7 — Reboot and verify

```bash
sudo reboot
```

After boot, run the following checks:

```bash
# AP interface and services
systemctl status uap0-interface.service   # active (exited)
systemctl status hostapd                  # active (running)
systemctl status dnsmasq                  # active (running)
ip addr show uap0                         # should have 192.168.4.1/24

# App
systemctl status range-buddy-app.service  # active (exited) — oneshot type
docker ps                                 # redis-camera and stream-receiver running
curl http://localhost:5000/camera/available
```

Connect a phone or laptop to `range-buddy` (password: `rb-proto-1`) and open `http://192.168.4.1` — it should load the camera UI.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with auto-reload (local) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run build:server` | Compile server-side TypeScript only |
| `npm run build:client` | Compile client-side TypeScript only |
| `npm start` | Run production build |
| `npm run docker:dev` | Start dev stack in Docker with live reload (local only) |
| `npm run docker:push:prod` | Build and push multi-arch production image |
| `npm run docker:push:dev` | Build and push multi-arch dev image |
| `npm run docker:push` | Build and push both images |

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

### range-buddy AP not broadcasting after reboot
```bash
# Check service chain in order
systemctl status uap0-interface.service
systemctl status hostapd
systemctl status dnsmasq
journalctl -u uap0-interface.service -u hostapd -u dnsmasq --since boot
```

Common causes:
- `uap0-interface` failed: driver not ready — increase the `ExecStartPre` sleep from 5s to 10s
- `hostapd` failed: `uap0` interface doesn't exist yet — check `uap0-interface` status first
- `dnsmasq` failed: binding conflict — confirm `bind-interfaces` is set and no other DHCP server is running on `uap0`

### Clients connect to range-buddy but can't reach the app
1. Confirm `uap0` has its IP: `ip addr show uap0` should show `192.168.4.1/24`
2. Check dnsmasq handed out a lease: `cat /var/lib/misc/dnsmasq.leases`
3. Test the redirect rule: `sudo iptables -t nat -L PREROUTING -n --line-numbers`
4. Ensure the RETURN rule for `192.168.8.0/24` is rule **1** (before the REDIRECT)

### iptables rules lost after reboot
```bash
sudo netfilter-persistent save
```

### GL.iNet admin panel (192.168.8.1) unreachable from AP clients
The RETURN rule for `192.168.8.0/24` must be rule 1 in PREROUTING. If it's missing:
```bash
sudo iptables -t nat -I PREROUTING 1 -p tcp -d 192.168.8.0/24 --dport 80 -j RETURN
sudo netfilter-persistent save
```

## License

MIT

## Author

[Benten559](https://github.com/Benten559)
