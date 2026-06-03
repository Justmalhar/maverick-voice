// ─── Provider usage tracking (local cost estimate) ───
// Every provider call (Groq STT, OpenAI/OpenRouter LLM) funnels its usage here
// after a successful response. We persist raw units (audio seconds, token
// counts) per day+model in SQLite and compute an estimated dollar figure on
// read from the hardcoded price table (config.ts). Recording is best-effort: a
// failure here must NEVER break the pipeline, so everything is in try/catch.

import { PRICING, type ModelPricing } from './config'
import { addUsage, getUsageRows, clearUsage, type UsageRow } from './db'
import type { UsageSummary, UsageWindow } from '../shared/types'

/** Local calendar date as YYYY-MM-DD (used to bucket usage by day). */
function localDateStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Record a transcription. `seconds` is the audio duration the provider billed. */
export function recordSttUsage(model: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  try {
    addUsage(localDateStr(), model, { sttSeconds: seconds })
  } catch (err) {
    console.warn('[usage] failed to record STT usage:', err instanceof Error ? err.message : err)
  }
}

/** Record an LLM chat completion from its `usage` token counts. */
export function recordLlmUsage(model: string, inputTokens: number, outputTokens: number): void {
  const input = Number.isFinite(inputTokens) ? inputTokens : 0
  const output = Number.isFinite(outputTokens) ? outputTokens : 0
  if (input <= 0 && output <= 0) return
  try {
    addUsage(localDateStr(), model, { inputTokens: input, outputTokens: output })
  } catch (err) {
    console.warn('[usage] failed to record LLM usage:', err instanceof Error ? err.message : err)
  }
}

/**
 * Estimated USD for a single usage row, priced from PRICING (config.ts).
 * Keys PURELY on row.model — providers MUST record the EXACT model string they
 * sent. A model absent from PRICING contributes $0 (e.g. unknown OpenRouter
 * slugs estimate at $0).
 */
function rowCost(row: UsageRow): number {
  const price: ModelPricing | undefined = PRICING[row.model]
  if (!price) return 0
  let cost = 0
  if (price.perAudioHour) cost += (row.stt_seconds / 3600) * price.perAudioHour
  if (price.perMInputTokens) cost += (row.input_tokens / 1_000_000) * price.perMInputTokens
  if (price.perMOutputTokens) cost += (row.output_tokens / 1_000_000) * price.perMOutputTokens
  return cost
}

function emptyWindow(): UsageWindow {
  return { cost: 0, inputTokens: 0, outputTokens: 0, sttSeconds: 0 }
}

function addRow(w: UsageWindow, row: UsageRow, cost: number): void {
  w.cost += cost
  w.inputTokens += row.input_tokens
  w.outputTokens += row.output_tokens
  w.sttSeconds += row.stt_seconds
}

/** Per-window estimated cost + raw usage across today / this month / all-time. */
export function getUsageSummary(): UsageSummary {
  const today = emptyWindow()
  const month = emptyWindow()
  const allTime = emptyWindow()
  try {
    const todayStr = localDateStr()
    const monthStr = todayStr.slice(0, 7) // YYYY-MM
    for (const row of getUsageRows()) {
      const cost = rowCost(row)
      addRow(allTime, row, cost)
      if (row.date.startsWith(monthStr)) addRow(month, row, cost)
      if (row.date === todayStr) addRow(today, row, cost)
    }
  } catch (err) {
    console.warn('[usage] failed to summarize usage:', err instanceof Error ? err.message : err)
  }
  return { today, month, allTime }
}

/** Wipe all recorded usage (the Settings "Reset" button). */
export function resetUsage(): void {
  try {
    clearUsage()
  } catch (err) {
    console.warn('[usage] failed to reset usage:', err instanceof Error ? err.message : err)
  }
}
