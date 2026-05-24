# CodeCollab

**Real-time collaborative code editor built for teams.**

CodeCollab is a browser-based collaborative coding platform that lets multiple developers edit the same codebase in real time. It pairs a Monaco editor frontend with a purpose-built WebSocket collaboration server, delivering low-latency synchronization powered by Yjs CRDTs and a control channel for room management, chat, and file sharing.

---

## Table of Contents

- [Platform Overview](#platform-overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Key Features](#key-features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Monaco Load Fix](#monaco-load-fix)

---

## Platform Overview

CodeCollab is designed for lightweight, zero-install collaboration in the browser. A host creates a room and shares a short room code, collaborators join instantly, and every keystroke is synchronized across peers with conflict-free merging.

The platform focuses on three principles:

1. **Conflict-free real-time editing.** All document synchronization uses Yjs CRDTs for deterministic, server-agnostic convergence.
2. **Minimal infrastructure footprint.** The collaboration server is a single stateless Node.js process with in-memory room state.
3. **Production-grade editor experience.** Monaco provides a VS Code-class editor surface with rich language tooling.

---

## Architecture

CodeCollab follows a two-service architecture with clear separation of concerns:

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
| `/doc/:roomId/:fileId` | Binary (Yjs) | Document synchronization channel carrying Yjs sync and awareness protocol messages |

This separation ensures that heavy binary document traffic never competes with lightweight JSON control messages. Each shared file gets its own `Y.Doc` instance on the server, allowing independent synchronization lifecycles.

### Conflict Resolution

All concurrent edits are resolved using Yjs CRDTs. Unlike OT systems that require central sequencing, CRDTs allow each peer to apply operations in any order and converge to the same state deterministically.

---

## Technology Stack

### Frontend (Next.js app)

| Technology | Role |
|------------|------|
| Next.js 16 (Turbopack) | App framework and routing |
| React 19 | Component framework |
| TypeScript | Type safety |
| Monaco Editor | Code editing surface |
| Tailwind CSS 3 | Styling system |
| Yjs + y-monaco | CRDT document binding |
| y-protocols | Sync and awareness wire protocols |

### Collaboration Server

| Technology | Role |
|------------|------|
| Node.js 20+ | Runtime |
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
- Peer presence tracking with colored avatars and display names
- Room-wide file sharing with automatic content synchronization

### Code Editor
- Monaco Editor with VS Code-class editing experience
- Syntax highlighting, bracket pair colorization, and minimap
- Configurable font size and word wrap

### Chat System
- Real-time room-wide chat over the control channel
- Server-stamped messages with peer identity and timestamps

### GitHub Integration
- OAuth-based GitHub authentication via Next.js route handlers
- Repository browsing and file import directly into the editor
- Support for private repositories with appropriate scopes

---

## Project Structure

```
collabify/
├── code-collab/         # Next.js 16 app (UI + API routes)
└── socket-provider/     # Node.js WebSocket server for Yjs sync + room control
```

---

## Getting Started

### Prerequisites

- Node.js 20.9 or later
- A GitHub OAuth App (for repository import)

### 1. Start the Socket Provider

```bash
cd socket-provider
npm install
cp .env.example .env
npm run dev          # listens on ws://localhost:4000
```

Health endpoints:

- `http://localhost:4000/health`
- `http://localhost:4000/stats`

### 2. Start the CodeCollab App

```bash
cd code-collab
npm install
cp .env.example .env # fill in GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
npm run dev          # serves http://localhost:3000
```

Open `http://localhost:3000`.

---

## Environment Variables

### `code-collab/.env`

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_COLLAB_URL` | WebSocket URL of socket-provider | `ws://localhost:4000` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | Required |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | Required |
| `GITHUB_OAUTH_SCOPES` | OAuth scopes requested during authorization | `repo read:org read:user` |
| `APP_PUBLIC_URL` | Public URL of this app (used for OAuth redirect) | `http://localhost:3000` |

### `socket-provider/.env`

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | WebSocket server listen port | `4000` |
| `HOST` | WebSocket server listen host | `0.0.0.0` |
| `SOCKET_DEBUG` | `true` for verbose per-message logging | `false` |

---

## Monaco Load Fix

Monaco is bundled directly from npm (`monaco-editor`) and passed to the `@monaco-editor/react` loader using `loader.config({ monaco })`. Web workers are wired through Turbopack via `new Worker(new URL(...))`, so the editor loads reliably without any CDN dependency.

See `code-collab/src/lib/monacoBootstrap.ts`.
