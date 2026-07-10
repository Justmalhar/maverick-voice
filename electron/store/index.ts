// ─── Store lifecycle: boot warm-up + quit flush (wired in main.ts) ───

import { warmSessions, flushSessions } from './sessions'
import { warmUsage, flushUsage } from './usage'
import { loadKeys } from './keys'
import { ensureAudioDir } from './audio'

/** Ensure dirs + warm every cache. Never throws into boot. */
export async function initStores(): Promise<void> {
  const guarded = (label: string, p: Promise<void>) =>
    p.catch((err) => console.error(`[store] ${label} init failed:`, err instanceof Error ? err.message : err))
  await Promise.all([
    guarded('keys', loadKeys()),
    guarded('sessions', warmSessions()),
    guarded('usage', warmUsage()),
    guarded('audio', ensureAudioDir())
  ])
}

/** Quit-time flush of the write-behind stores. */
export async function flushStores(): Promise<void> {
  await Promise.all([flushSessions(), flushUsage()])
}
