// ─── Session history: sessions.json, async write-behind ───
// In-memory array cache (newest first), debounced atomic flush (tmp+rename),
// retention cap 100 / 24 h pruned on an idle timer — never inline with a save
// (SYSTEM-DESIGN §4.2, NFR8; replaces v1 better-sqlite3, LEGACY-ISSUES C9).

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { Session } from '../../shared/types'

const FLUSH_DEBOUNCE_MS = 500 // persistence write-behind, not a handshake timeout
const PRUNE_IDLE_MS = 2_000
const MAX_SESSIONS = 100
const MAX_AGE_MS = 24 * 60 * 60 * 1000

let cache: Session[] | null = null
let loadPromise: Promise<Session[]> | null = null
let dirty = false
let flushTimer: NodeJS.Timeout | null = null
let pruneTimer: NodeJS.Timeout | null = null
let writeChain: Promise<void> = Promise.resolve()

function filePath(): string {
  return path.join(app.getPath('userData'), 'sessions.json')
}

function load(): Promise<Session[]> {
  if (cache) return Promise.resolve(cache)
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(filePath(), 'utf8'))
        cache = Array.isArray(parsed) ? (parsed as Session[]) : []
      } catch (err) {
        const e = err as NodeJS.ErrnoException
        if (e?.code !== 'ENOENT') console.warn('[sessions] failed to load sessions.json:', e?.message ?? err)
        cache = []
      }
      return cache
    })()
  }
  return loadPromise
}

/** Warm the cache at boot (called from initStores). */
export async function warmSessions(): Promise<void> {
  await load()
}

async function writeAtomic(data: string): Promise<void> {
  const file = filePath()
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, file)
}

function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!dirty || !cache) return writeChain
  dirty = false
  const snapshot = JSON.stringify(cache)
  writeChain = writeChain
    .then(() => writeAtomic(snapshot))
    .catch((err) => {
      dirty = true
      console.error('[sessions] flush failed:', err instanceof Error ? err.message : err)
    })
  return writeChain
}

function scheduleFlush(): void {
  dirty = true
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flushNow(), FLUSH_DEBOUNCE_MS)
}

/** Retention pass — runs on an idle timer after saves, never inline (NFR8). */
function schedulePrune(): void {
  if (pruneTimer) clearTimeout(pruneTimer)
  pruneTimer = setTimeout(() => {
    pruneTimer = null
    try {
      if (!cache) return
      const cutoff = Date.now() - MAX_AGE_MS
      const pruned = cache
        .filter((s) => s.createdAt >= cutoff)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_SESSIONS)
      if (pruned.length !== cache.length) {
        console.log(`[sessions] pruned ${cache.length - pruned.length} session(s)`)
        cache = pruned
        scheduleFlush()
      }
    } catch (err) {
      console.error('[sessions] prune failed:', err instanceof Error ? err.message : err)
    }
  }, PRUNE_IDLE_MS)
}

/** Upsert a session (newest first); write-behind, prune scheduled on idle. */
export async function saveSession(s: Session): Promise<void> {
  const list = await load()
  const i = list.findIndex((x) => x.id === s.id)
  if (i >= 0) list[i] = s
  else list.unshift(s)
  scheduleFlush()
  schedulePrune()
}

export async function getSession(id: string): Promise<Session | null> {
  const list = await load()
  return list.find((s) => s.id === id) ?? null
}

export async function getSessions(limit = 50): Promise<Session[]> {
  const list = await load()
  return [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

/**
 * Merge a partial update into an existing session. Fields absent (undefined)
 * in the update are preserved — a failed retry must never null-out the prior
 * transcript/output (v1 bug #1).
 */
export async function updateSessionResult(id: string, u: Partial<Session>): Promise<void> {
  const list = await load()
  const target = list.find((s) => s.id === id)
  if (!target) {
    console.warn('[sessions] updateSessionResult: unknown session', id)
    return
  }
  for (const [k, v] of Object.entries(u)) {
    if (v !== undefined) (target as unknown as Record<string, unknown>)[k] = v
  }
  scheduleFlush()
}

export async function deleteSession(id: string): Promise<void> {
  const list = await load()
  const next = list.filter((s) => s.id !== id)
  if (next.length !== list.length) {
    cache = next
    scheduleFlush()
  }
}

export async function clearAllSessions(): Promise<void> {
  await load()
  cache = []
  scheduleFlush()
}

/** Quit-time flush (called from flushStores). */
export async function flushSessions(): Promise<void> {
  if (pruneTimer) {
    clearTimeout(pruneTimer)
    pruneTimer = null
  }
  await flushNow()
}
