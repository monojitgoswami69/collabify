# Collabify

**Real-time collaborative code editor built for teams.**

Collabify is a browser-based collaborative coding platform that lets multiple developers edit the same codebase in real time. It pairs a Monaco editor frontend with a purpose-built WebSocket collaboration server, delivering low-latency synchronization powered by Yjs CRDTs and a control channel for room management, chat, and file sharing.

---

## Table of Contents

- [Platform Overview](#platform-overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Key Features](#key-features)
- [Security Model](#security-model)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Development & Tests](#development--tests)
- [Monaco Loader](#monaco-loader)

---

## Platform Overview

Collabify is designed for lightweight, zero-install collaboration in the browser. A host creates a room and shares a short room code, collaborators join and are approved by the host, and every keystroke is synchronized across peers with conflict-free merging.

The platform focuses on three principles:

1. **Conflict-free real-time editing.** All document synchronization uses Yjs CRDTs for deterministic, server-agnostic convergence.
2. **Minimal infrastructure footprint.** The collaboration server is a single stateless Node.js process with in-memory room state.
3. **Production-grade editor experience.** Monaco provides a VS Code-class editor surface with rich language tooling.

---

## Architecture

Collabify follows a two-service architecture with clear separation of concerns:

```
			  +--------------------+
			  |    Next.js App     |
			  |  React + Monaco    |
			  |  API Route Handlers|
			  +---------+----------+
				    |
		 +------------------+------------------+
		 |                                     |
	+--------v--------+                   +--------v--------+
	|  Socket Provider |                   |   GitHub API    |
	|  Node.js + ws    |                   |  OAuth + REST   |
	|                  |                   |                 |
	| - Room lifecycle |                   |                 |
	| - Yjs doc sync   |                   |                 |
	| - Chat broadcast |                   |                 |
	| - File sharing   |                   |                 |
	+------------------+                   +-----------------+
```

### Dual WebSocket Channel Design

The socket provider exposes two distinct WebSocket paths per room:

| Path | Protocol | Purpose |
|------|----------|---------|
| `/room/:roomId` | JSON | Control channel for room management, join/approve workflows, file sharing metadata, and chat messages |
| `/doc/:roomId/:fileId?token=…` | Binary (Yjs) | Document synchronization channel carrying Yjs sync and awareness protocol messages |

This separation ensures that heavy binary document traffic never competes with lightweight JSON control messages. Each shared file gets its own `Y.Doc` instance on the server, allowing independent synchronization lifecycles.

### Document Access Control

Every approved room member receives a per-member doc token (delivered in the `room-created` / `approved` control messages). Doc-channel connections must present this token as a query parameter; it is revoked when the member is kicked or disconnects, at which point their doc sockets are closed. The host-controlled approval workflow therefore applies to document content, not just to the control channel.

### Conflict Resolution

All concurrent edits are resolved using Yjs CRDTs. Unlike OT systems that require central sequencing, CRDTs allow each peer to apply operations in any order and converge to the same state deterministically.

---

## Technology Stack

### Frontend (`frontend/` — Next.js app)

| Technology | Role |
|------------|------|
| Next.js 16 (Turbopack) | App framework and routing |
| React 19 | Component framework |
| TypeScript | Type safety |
| Monaco Editor | Code editing surface |
| Tailwind CSS 4 | Styling system |
| Yjs + y-monaco | CRDT document binding |
| y-protocols | Sync and awareness wire protocols |
| Magika | AI-based content language detection |

### Collaboration Server (`socket-provider/`)

| Technology | Role |
|------------|------|
| Node.js 24+ | Runtime |
| ws | WebSocket server |
| Yjs (server) | Server-side CRDT doc sync |
| lib0 | Binary encoding/decoding utilities |

---

## Key Features

### Collaborative Editing
- Conflict-free real-time document synchronization via Yjs CRDTs
- Live remote cursor and selection rendering with color-coded peer indicators
- Per-file Yjs sessions with independent sync and awareness

### Room Management
- Host-controlled rooms with join request and approval workflow
- Kicking a member revokes document access immediately (doc sockets are closed and their token invalidated)
- Room locking; host promotion when the host leaves
- Peer presence tracking with colored avatars and display names

### Code Editor
- Monaco Editor with VS Code-class editing experience
- Syntax highlighting, bracket pair colorization, and minimap
- Configurable font size and word wrap

### Chat System
- Real-time room-wide chat over the control channel
- Server-stamped messages with peer identity and timestamps, rate-limited per peer

### GitHub Integration
- OAuth-based GitHub authentication (with CSRF `state` validation) via Next.js route handlers
- Repository browsing and file import directly into the editor
- Support for private repositories with appropriate scopes

---

## Security Model

- **Room codes** are generated with the Web Crypto CSPRNG (8 characters, 32-symbol alphabet).
- **Doc tokens** are 192-bit server-generated capabilities; one per member, revoked on kick/leave.
- **Identity validation**: room/file ids are validated at the upgrade boundary; malformed encodings and ids containing `/` are rejected.
- **HTTP surface**: `/health` exposes counts only; `/stats` exposes aggregates (no room ids).
- **Input limits**: 2 MiB per WebSocket message, 1 MiB per shared file, 200 files per room, 2 000 chars per chat message (10 per 5 s per peer).
- **File proxy** (`/api/github/file`): GitHub-host allowlist enforced on every redirect hop, 5 MiB response cap, 15 s timeout, default ports only.
- **OAuth**: random `state` bound to a short-lived httpOnly cookie and verified in the callback; token-bearing pages are served `Cache-Control: no-store`.

---

## Project Structure

```
collabify/
├── frontend/            # Next.js 16 app (UI + API routes)
│   └── src/
│       ├── app/         # Pages and API route handlers
│       ├── components/  # Editor, modals, chat, file explorer
│       ├── hooks/       # React hooks (collab room, theme, resize)
│       ├── lib/         # Monaco bootstrap, themes, editor config
│       ├── services/    # Collab WS client, GitHub client, storage
│       └── utils/       # Language detection
└── socket-provider/     # Node.js WebSocket server for Yjs sync + room control
    ├── src/
    └── test/            # Integration + regression test suite (node:test)
```

---

## Getting Started

### Prerequisites

- Node.js 20.9 or later for the frontend; Node.js 24 or later for the socket provider (hard requirement in its `engines` field)
- A GitHub OAuth App (for repository import)

### 1. Start the Socket Provider

```bash
cd socket-provider
npm install
cp .env.example .env
npm run dev          # listens on ws://localhost:4000
```

Health endpoints:

- `http://localhost:4000/health` — liveness + counts
- `http://localhost:4000/stats` — aggregate room/doc/member counts

### 2. Start the Collabify App

```bash
cd frontend
npm install
cp .env.example .env # fill in GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
npm run dev          # serves http://localhost:3000
```

Open `http://localhost:3000`.

---

## Environment Variables

### `frontend/.env`

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_COLLAB_URL` | WebSocket URL of socket-provider (no usable default — if unset, the client falls back to the page's own origin, which only works when the socket provider is reverse-proxied behind the same host; set it explicitly in dev and production) | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | Required |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | Required |
| `GITHUB_OAUTH_SCOPES` | OAuth scopes requested during authorization (`repo` includes write access to private repos — the app itself only reads) | `repo read:org read:user` |
| `APP_PUBLIC_URL` | Public URL of this app (used for the OAuth redirect_uri) | `http://localhost:3000` |

### `socket-provider/.env`

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | WebSocket server listen port | `4000` |
| `HOST` | WebSocket server listen host | `0.0.0.0` |
| `SOCKET_DEBUG` | `true` for verbose per-message logging | `false` |
| `TLS_CERT` | Path to TLS certificate (enables HTTPS/WSS; omit for plain HTTP/WS) | — |
| `TLS_KEY` | Path to TLS private key | — |
| `DOC_GC_DELAY_MS` | Optional: idle-doc GC delay | `30000` |
| `MAX_ROOMS` | Optional: global room ceiling | `5000` |
| `MAX_MEMBERS_PER_ROOM` | Optional: members per room | `64` |
| `MAX_PENDING_PER_ROOM` | Optional: pending join requests per room | `50` |

---

## Development & Tests

### Socket provider

```bash
cd socket-provider
npm test        # node:test integration suite (spawns a real server per file)
```

The suite covers the room lifecycle (create/join/approve/kick/lock/chat), doc lifecycle (share/unshare/GC/destroy), and regressions for every previously-found crash and authorization bypass (malformed URIs, null reorder elements, doc tokens, room takeover, kick revocation, `/stats` enumeration).

### Frontend

```bash
cd frontend
npm run typecheck   # tsc --noEmit
npm run build       # production build (also type-checks)
```

---

## Monaco Loader

Monaco is bundled directly from npm (`monaco-editor`) and passed to the `@monaco-editor/react` loader using `loader.config({ monaco })`. Web workers are wired through Turbopack via `new Worker(new URL(...))`, so the editor loads reliably without any CDN dependency.

See `frontend/src/lib/monacoBootstrap.ts`.
