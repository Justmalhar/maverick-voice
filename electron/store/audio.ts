// ─── Audio scratch: in-memory during recording, ONE async write at stop ───
// Replaces v1's sync per-chunk writeFileSync + inline prune scans (LEGACY-ISSUES
// C8, the worst latency source). Buffers accumulate in a Map while recording;
// persistAudio concatenates and writes once. Pruning (24 h / max 5 audio sets,
// grouped by uuid prefix so '<uuid>-dictation' + '<uuid>-instruction' form one
// set) runs on an idle setTimeout after persist — never inline (NFR8).

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

const MAX_AUDIO_SETS = 5
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const PRUNE_IDLE_MS = 2_000

// sessionId itself is a UUID (8-4-4-4-12 hex); files are '<sessionId>.webm'
// where sessionId may carry a '-dictation'/'-instruction' suffix (retry naming).
const SESSION_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

const held = new Map<string, Buffer[]>()
let pruneTimer: NodeJS.Timeout | null = null

function audioDir(): string {
  return path.join(app.getPath('userData'), 'audio')
}

function fileFor(sessionId: string): string {
  return path.join(audioDir(), `${sessionId}.webm`)
}

/** Ensure userData/audio exists (called from initStores). */
export async function ensureAudioDir(): Promise<void> {
  try {
    await fs.mkdir(audioDir(), { recursive: true })
  } catch (err) {
    console.error('[audio] failed to create audio dir:', err instanceof Error ? err.message : err)
  }
}

/** Append a recorded buffer to the in-memory scratch for a session. */
export function holdAudio(sessionId: string, buf: Buffer): void {
  const bufs = held.get(sessionId)
  if (bufs) bufs.push(buf)
  else held.set(sessionId, [buf])
}

/** Drop held memory without persisting (cancel path). */
export function releaseAudio(sessionId: string): void {
  held.delete(sessionId)
}

/**
 * Concatenate held buffers and write them in ONE async write to
 * userData/audio/<sessionId>.webm. Clears the memory either way.
 * Returns the file path, or null when nothing was held / the write failed.
 */
export async function persistAudio(sessionId: string): Promise<string | null> {
  const bufs = held.get(sessionId)
  held.delete(sessionId)
  if (!bufs || bufs.length === 0) return null
  const filePath = fileFor(sessionId)
  try {
    await fs.mkdir(audioDir(), { recursive: true })
    await fs.writeFile(filePath, Buffer.concat(bufs))
    console.log(`[audio] persisted session ${sessionId} (${bufs.length} buffer(s))`)
    schedulePrune()
    return filePath
  } catch (err) {
    console.error(`[audio] failed to persist ${sessionId}:`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function loadAudio(sessionId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(fileFor(sessionId))
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e?.code !== 'ENOENT') {
      console.error(`[audio] failed to load ${sessionId}:`, e?.message ?? err)
    }
    return null
  }
}

export async function deleteAudio(sessionId: string): Promise<void> {
  held.delete(sessionId)
  try {
    await fs.unlink(fileFor(sessionId))
    console.log(`[audio] deleted audio for session ${sessionId}`)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e?.code !== 'ENOENT') {
      console.error(`[audio] failed to delete ${sessionId}:`, e?.message ?? err)
    }
  }
}

export async function clearAllAudio(): Promise<void> {
  held.clear()
  try {
    const files = (await fs.readdir(audioDir())).filter((f) => f.endsWith('.webm'))
    await Promise.all(
      files.map((f) =>
        fs.unlink(path.join(audioDir(), f)).catch((err) => {
          console.error('[audio] failed to delete', f, err instanceof Error ? err.message : err)
        })
      )
    )
    console.log(`[audio] cleared all audio files (${files.length} removed)`)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e?.code !== 'ENOENT') {
      console.error('[audio] failed to clear audio dir:', e?.message ?? err)
    }
  }
}

/** Idle-scheduled prune — never runs inline with a save (NFR8). */
function schedulePrune(): void {
  if (pruneTimer) clearTimeout(pruneTimer)
  pruneTimer = setTimeout(() => {
    pruneTimer = null
    void prune()
  }, PRUNE_IDLE_MS)
}

async function prune(): Promise<void> {
  try {
    const dir = audioDir()
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.webm'))

    // Group by uuid prefix so a session's retry variants prune as one set.
    const sets = new Map<string, { files: string[]; mtime: number }>()
    for (const f of files) {
      let mtime: number
      try {
        mtime = (await fs.stat(path.join(dir, f))).mtimeMs
      } catch {
        continue // vanished between readdir and stat
      }
      const key = f.match(SESSION_ID_RE)?.[1] ?? f // ungrouped files are their own set
      const entry = sets.get(key)
      if (entry) {
        entry.files.push(f)
        if (mtime > entry.mtime) entry.mtime = mtime
      } else {
        sets.set(key, { files: [f], mtime })
      }
    }

    const cutoff = Date.now() - MAX_AGE_MS
    const sorted = [...sets.entries()].sort((a, b) => b[1].mtime - a[1].mtime) // newest first
    const doomed = sorted.filter(([, e], i) => i >= MAX_AUDIO_SETS || e.mtime < cutoff)
    for (const [key, entry] of doomed) {
      for (const name of entry.files) {
        await fs.unlink(path.join(dir, name)).catch((err) => {
          console.error('[audio] prune unlink failed:', name, err instanceof Error ? err.message : err)
        })
      }
      console.log(`[audio] pruned audio set ${key} (${entry.files.length} file(s))`)
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e?.code !== 'ENOENT') {
      console.error('[audio] prune failed:', e?.message ?? err)
    }
  }
}
