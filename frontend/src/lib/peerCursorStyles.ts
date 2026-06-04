'use client';

// Single-stylesheet peer cursor registry for y-monaco awareness.
//
// y-monaco renders remote selections by adding `yRemoteSelection-<clientID>`
// and `yRemoteSelectionHead-<clientID>` classes to Monaco's view zones.
// Each peer therefore needs its own colored CSS rule.
//
// The naive approach (one <style> per peer in <head>) means N CSSOM mutations,
// N stylesheet parses, and N getElementById lookups every time awareness ticks.
// For a 20-peer room that's noticeable jank.
//
// This module maintains ONE shared <style> element and a Map<clientID, rules>.
// Awareness ticks call `syncPeerCursors(states, localId)` which:
//   1. Diffs current vs desired peer set in O(states + active).
//   2. If anything changed, schedules a single rAF that rewrites the
//      style element's textContent in one go.
//
// Net result: O(1) DOM writes per frame regardless of peer count.

interface PeerStyle {
  color: string;
  name: string;
}

interface AwarenessUser {
  name?: string;
  color?: string;
}

interface AwarenessState {
  user?: AwarenessUser;
}

const STYLE_ID = 'yRemoteCursors';
const GLOBAL_STYLE_ID = 'yRemoteCursorGlobals';

// Active peers across all editors in the page. Maps clientID → style data.
const activePeers = new Map<number, PeerStyle>();
let rafId = 0;

function ensureGlobalStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(GLOBAL_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = GLOBAL_STYLE_ID;
  // Hit-target + tooltip behaviour (color-independent).
  el.textContent = `
.yRemoteSelectionHead::before {
  content: '';
  position: absolute;
  top: 0;
  left: -10px;
  width: 24px;
  height: 100%;
  cursor: default;
  z-index: 99;
}
.yRemoteSelectionHead::after {
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}
.yRemoteSelectionHead:hover::after {
  opacity: 1;
}
`;
  document.head.appendChild(el);
}

function ensureSheet(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;
  ensureGlobalStyles();
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

function escapeForCssContent(s: string): string {
  // CSS content strings — escape the four chars that can terminate the literal.
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function rebuild() {
  rafId = 0;
  const el = ensureSheet();
  if (!el) return;
  // Build a single string — much cheaper than N appendChild calls.
  const parts: string[] = [];
  for (const [clientID, { color, name }] of activePeers) {
    const escapedName = escapeForCssContent(name);
    parts.push(
      `.yRemoteSelection-${clientID}{background-color:${color}20 !important;}` +
        `.yRemoteSelectionHead-${clientID}{position:absolute;border-left:2px solid ${color} !important;box-sizing:border-box;height:100% !important;}` +
        `.yRemoteSelectionHead-${clientID}::after{content:'${escapedName}';position:absolute;color:#fff;background-color:${color};font-family:'Inter',sans-serif;font-size:11px;font-weight:600;line-height:1;padding:2px 6px 3px;border-radius:3px 3px 3px 0;white-space:nowrap;bottom:100%;left:-2px;z-index:100;}`,
    );
  }
  el.textContent = parts.join('');
}

function scheduleRebuild() {
  if (rafId) return;
  if (typeof requestAnimationFrame === 'undefined') {
    rebuild();
    return;
  }
  rafId = requestAnimationFrame(rebuild);
}

/**
 * Diff `states` (from y-protocols/awareness.getStates()) against the current
 * peer set, mutating `activePeers` in place. Schedules ONE rAF to rewrite the
 * stylesheet if anything changed.
 *
 * Cost: O(states.size + activePeers.size). The `Map.has(states, id)` lookup
 * is O(1), so the cleanup pass is linear in current peers.
 */
export function syncPeerCursors(
  states: Map<number, AwarenessState>,
  localId: number,
): void {
  let dirty = false;

  // Add / update.
  states.forEach((state, clientID) => {
    if (clientID === localId) return;
    const user = state.user;
    if (!user?.color || !user?.name) return;
    const existing = activePeers.get(clientID);
    if (!existing || existing.color !== user.color || existing.name !== user.name) {
      activePeers.set(clientID, { color: user.color, name: user.name });
      dirty = true;
    }
  });

  // Drop peers that no longer exist in the awareness map.
  for (const id of activePeers.keys()) {
    if (!states.has(id)) {
      activePeers.delete(id);
      dirty = true;
    }
  }

  if (dirty) scheduleRebuild();
}

/**
 * Remove a single peer (e.g. on local editor unmount). Doesn't tear down the
 * whole stylesheet — other editors on the page may still need it.
 */
export function dropPeer(clientID: number): void {
  if (activePeers.delete(clientID)) scheduleRebuild();
}

/**
 * Clear all peer styles. Useful when leaving a room and we know no editor
 * is bound anymore.
 */
export function clearAllPeers(): void {
  if (activePeers.size === 0) return;
  activePeers.clear();
  scheduleRebuild();
}
