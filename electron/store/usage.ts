// ─── Provider usage tracking: usage.json, additive in memory ───
// Raw units per local-day+model; dollars computed at read from PRICING
// (hardcoded estimates, documented drift). Recording is best-effort — a
// failure here must NEVER throw into the pipeline (ported from v1
// usageTracker.ts; storage moved from SQLite to JSON per SYSTEM-DESIGN §4.2).

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { PRICING } from '../config'
import type { UsageSummary, UsageWindow } from '../../shared/types'

interface UsageEntry {
  sttSeconds: number
  inputTokens: number
  outputTokens: number
}
type UsageData = Record<string, Record<string, UsageEntry>> // date → model → units

const FLUSH_DEBOUNCE_MS = 500 // persistence write-behind, not a handshake timeout

let data: UsageData = {} // pre-load recordings accumulate here; load merges additively
let loaded = false
let loadPromise: Promise<void> | null = null
let dirty = false
let flushTimer: NodeJS.Timeout | null = null
let writeChain: Promise<void> = Promise.resolve()

function filePath(): string {
  return path.join(app.getPath('userData'), 'usage.json')
}

function load(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(filePath(), 'utf8')) as UsageData
        if (parsed && typeof parsed === 'object') {
          // Additive merge: anything recorded before the file finished loading
          // is preserved on top of the persisted totals.
          for (const [date, models] of Object.entries(parsed)) {
            for (const [model, e] of Object.entries(models)) {
              bump(date, model, e.sttSeconds || 0, e.inputTokens || 0, e.outputTokens || 0)
            }
          }
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException
        if (e?.code !== 'ENOENT') console.warn('[usage] failed to load usage.json:', e?.message ?? err)
      }
      loaded = true
    })()
  }
  return loadPromise
}

/** Warm the cache at boot (called from initStores). */
export async function warmUsage(): Promise<void> {
  await load()
}

/** Local calendar date as YYYY-MM-DD (buckets usage by day). */
function localDateStr(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function bump(date: string, model: string, stt: number, inTok: number, outTok: number): void {
  const day = (data[date] ??= {})
  const e = (day[model] ??= { sttSeconds: 0, inputTokens: 0, outputTokens: 0 })
  e.sttSeconds += stt
  e.inputTokens += inTok
  e.outputTokens += outTok
}

async function writeAtomic(json: string): Promise<void> {
  const file = filePath()
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, json, 'utf8')
  await fs.rename(tmp, file)
}

function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!dirty) return writeChain
  dirty = false
  writeChain = writeChain
    .then(() => load()) // never persist before the file's totals are merged in
    .then(() => writeAtomic(JSON.stringify(data)))
    .catch((err) => {
      dirty = true
      console.error('[usage] flush failed:', err instanceof Error ? err.message : err)
    })
  return writeChain
}

function scheduleFlush(): void {
  dirty = true
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flushNow(), FLUSH_DEBOUNCE_MS)
}

/** Record a transcription. `seconds` = the audio duration the provider billed. */
export function recordSttUsage(model: string, seconds: number): void {
  try {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    void load().catch(() => {})
    bump(localDateStr(), model, seconds, 0, 0)
    scheduleFlush()
  } catch (err) {
    console.warn('[usage] failed to record STT usage:', err instanceof Error ? err.message : err)
  }
}

/** Record an LLM completion from its `usage` token counts. */
export function recordLlmUsage(model: string, inTok: number, outTok: number): void {
  try {
    const input = Number.isFinite(inTok) && inTok > 0 ? inTok : 0
    const output = Number.isFinite(outTok) && outTok > 0 ? outTok : 0
    if (input <= 0 && output <= 0) return
    void load().catch(() => {})
    bump(localDateStr(), model, 0, input, output)
    scheduleFlush()
  } catch (err) {
    console.warn('[usage] failed to record LLM usage:', err instanceof Error ? err.message : err)
  }
}

/** Estimated USD for one model's units. Absent from PRICING → $0. */
function cost(model: string, e: UsageEntry): number {
  const p = PRICING[model]
  if (!p) return 0
  let usd = 0
  if (p.perAudioHour) usd += (e.sttSeconds / 3600) * p.perAudioHour
  if (p.perMInputTokens) usd += (e.inputTokens / 1_000_000) * p.perMInputTokens
  if (p.perMOutputTokens) usd += (e.outputTokens / 1_000_000) * p.perMOutputTokens
  return usd
}

function emptyWindow(): UsageWindow {
  return { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} }
}

function addTo(w: UsageWindow, model: string, e: UsageEntry, usd: number): void {
  w.sttSeconds += e.sttSeconds
  w.inputTokens += e.inputTokens
  w.outputTokens += e.outputTokens
  w.costUsd += usd
  const m = (w.byModel[model] ??= { costUsd: 0, sttSeconds: 0, inputTokens: 0, outputTokens: 0 })
  m.costUsd += usd
  m.sttSeconds! += e.sttSeconds
  m.inputTokens! += e.inputTokens
  m.outputTokens! += e.outputTokens
}

/** Today / this-month / all-time windows, priced at read. */
export async function getUsageSummary(): Promise<UsageSummary> {
  const today = emptyWindow()
  const month = emptyWindow()
  const allTime = emptyWindow()
  try {
    await load()
    const todayStr = localDateStr()
    const monthStr = todayStr.slice(0, 7) // YYYY-MM
    for (const [date, models] of Object.entries(data)) {
      for (const [model, e] of Object.entries(models)) {
        const usd = cost(model, e)
        addTo(allTime, model, e, usd)
        if (date.startsWith(monthStr)) addTo(month, model, e, usd)
        if (date === todayStr) addTo(today, model, e, usd)
      }
    }
  } catch (err) {
    console.warn('[usage] failed to summarize usage:', err instanceof Error ? err.message : err)
  }
  return { today, month, allTime }
}

/** Wipe all recorded usage (Settings "Reset" button). */
export async function resetUsage(): Promise<void> {
  try {
    await load() // let any in-flight merge finish so it can't resurrect data
    data = {}
    dirty = true
    await flushNow()
  } catch (err) {
    console.warn('[usage] failed to reset usage:', err instanceof Error ? err.message : err)
  }
}

/** Quit-time flush (called from flushStores). */
export async function flushUsage(): Promise<void> {
  await flushNow()
}
