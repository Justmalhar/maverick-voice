// ════════════════════════════════════════════════════════════════════════
// electron/session/pipeline.ts — stop→paste pipeline.
//
// Transcribe (whole-or-chunked, parallel, cancellable via session.abort) →
// clean → Replacements → Snippets → junk guard → flow routing → LLM transform
// (skipped for pure dictation unless auto-format opts in) → output injection.
// A failed STT chunk degrades to a visible fallback notice, never a silent
// gap (LEGACY-ISSUES §3 item 2). NEVER logs transcript/output text — ids,
// stages, and lengths only.
// ════════════════════════════════════════════════════════════════════════

import type { AppProfile, FlowType, SessionMode } from '../../shared/types'
import { TIMEOUTS } from '../config'
import { getApiKey, hasApiKey } from '../store/keys'
import { getSetting } from '../store/settings'
import { persistAudio } from '../store/audio'
import { recordLlmUsage, recordSttUsage } from '../store/usage'
import { getLLMProvider, getTranscriptionProvider } from '../providers/registry'
import { NoApiKeyError } from '../providers/types'
import { assembleTransformMessages, buildAutoFormatPrompt } from '../prompts/prompts'
import { buildRulesBlock } from '../prompts/rules'
import { copyToClipboard, injectOutput, type HelperCommand } from '../output/inject'
import {
  applyReplacements,
  applySnippets,
  buildSttPromptHint,
  cleanTranscript,
  isJunk,
  isLLMRefusal
} from './textops'
import { determineFlowType } from './flows'
import type { SessionState } from './fsm'

const TRANSFORM_MAX_TOKENS = 4096
const MISSING_AUDIO_NOTICE = 'Part of the recording could not be transcribed — output may be missing words.'

export interface PipelineDeps {
  /** darwin CGEvent paste fast path (keyListener.command), injected by fsm.ts. */
  helperCommand?: HelperCommand
}

export interface ChunkState {
  buffer: Buffer
  transcript: string | null
  promise: Promise<void> | null
  error: string | null
}

export interface AudioTrack {
  chunks: Map<number, ChunkState>
  total: number | null
  /** This mode's recording was engaged this session, regardless of outcome. */
  engaged: boolean
}

export function newAudioTrack(engaged: boolean): AudioTrack {
  return { chunks: new Map(), total: null, engaged }
}

export type PipelineOutcome = 'output' | 'fallback' | 'skipped'

export interface PipelineResult {
  outcome: PipelineOutcome
  /** OUTPUT_FALLBACK notice text; ignored for other outcomes. */
  message?: string
  degraded?: 'clipboard-only'
}

// ── chunk transcription (fired as soon as audio arrives — session.abort
//    exists from start(), so Escape/cancel makes every in-flight call
//    cancellable, fixing LEGACY-ISSUES §3 item 2) ──────────────────────────

/** Exported for the retry flow (ipc/session.ts) — same STT call, no chunking. */
export async function transcribeOne(buffer: Buffer, signal: AbortSignal): Promise<string> {
  const stt = getSetting('sttSettings')
  const provider = getTranscriptionProvider(stt.provider)
  const key = getApiKey(stt.provider) ?? ''
  // Local server works keyless; every remote provider still fails loudly.
  if (provider.requiresKey !== false && !key) throw new NoApiKeyError(stt.provider)
  const result = await provider.transcribe(
    buffer,
    {
      model: stt.model,
      language: stt.language === 'auto' ? undefined : stt.language,
      prompt: buildSttPromptHint(getSetting('dictionary'), getSetting('replacements')),
      mimeType: 'audio/webm',
      baseUrl: stt.baseUrl || undefined
    },
    key,
    signal
  )
  recordSttUsage(stt.model, result.durationSeconds ?? 0)
  return result.text
}

/** Fire-and-forget: register a chunk and kick off its transcription now. */
export function trackChunk(session: SessionState, mode: SessionMode, chunkIndex: number, buffer: Buffer): void {
  const track = session[mode]
  const state: ChunkState = { buffer, transcript: null, promise: null, error: null }
  track.chunks.set(chunkIndex, state)
  state.promise = transcribeOne(buffer, session.abort.signal)
    .then((text) => {
      state.transcript = text
    })
    .catch((err) => {
      state.error = err instanceof Error ? err.message : String(err)
      // Error text is API/network detail (status + body excerpt) — never transcript content.
      console.warn(`[pipeline] chunk ${chunkIndex} (${mode}) transcription failed for session ${session.id}: ${state.error}`)
    })
}

interface CollateResult {
  text: string
  hadFailure: boolean
  firstError: string | null
}

async function collate(session: SessionState, mode: SessionMode): Promise<CollateResult> {
  const track = session[mode]
  await Promise.all([...track.chunks.values()].map((c) => c.promise ?? Promise.resolve()))
  const total = track.total ?? track.chunks.size
  const parts: string[] = []
  let hadFailure = false
  let firstError: string | null = null
  for (let i = 0; i < total; i++) {
    const chunk = track.chunks.get(i)
    if (!chunk || chunk.error) {
      hadFailure = true
      if (chunk?.error && !firstError) firstError = chunk.error
      continue
    }
    if (chunk.transcript) parts.push(chunk.transcript)
  }
  return { text: parts.join(' '), hadFailure, firstError }
}

// ── LLM stages ──────────────────────────────────────────────────────────

// Copy ported from legacy/shared/copy.ts FORMATTING (v2 has no shared/copy.ts
// yet, so it's inlined here — the one place this notice is produced).
function formattingNotice(): string {
  const llm = getSetting('llmSettings')
  return hasApiKey(llm.provider)
    ? 'Oops, formatting failed — raw text pasted'
    : 'Add an API key in Settings to enable formatting'
}

async function runAutoFormat(text: string, profile: AppProfile, signal: AbortSignal): Promise<string | null> {
  const llm = getSetting('llmSettings')
  if (!hasApiKey(llm.provider)) return null
  try {
    const provider = getLLMProvider(llm.provider)
    const key = getApiKey(llm.provider)!
    const rulesBlock = buildRulesBlock(getSetting('rules'))
    const system = rulesBlock ? `${buildAutoFormatPrompt(profile)}\n\n${rulesBlock}` : buildAutoFormatPrompt(profile)
    const result = await provider.complete(
      {
        model: llm.model,
        system,
        user: text,
        temperature: 0.1,
        maxTokens: TRANSFORM_MAX_TOKENS,
        baseUrl: llm.baseUrl || undefined,
        timeoutMs: TIMEOUTS.transform
      },
      key,
      signal
    )
    recordLlmUsage(llm.model, result.usage?.inputTokens ?? 0, result.usage?.outputTokens ?? 0)
    const formatted = (result.text || '').trim()
    if (!formatted || isLLMRefusal(formatted)) return null
    // Hallucination guard: auto-format must never materially grow the text.
    if (formatted.length > text.length * 2 && formatted.length - text.length > 200) return null
    return formatted
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    console.warn('[pipeline] auto-format failed for session', err instanceof Error ? err.message : err)
    return null
  }
}

async function transformWithFallback(
  flowType: FlowType,
  content: string | null,
  context: string | null,
  instruction: string | null,
  rawFallback: string,
  signal: AbortSignal
): Promise<{ output: string; fallbackMessage: string | null }> {
  const llm = getSetting('llmSettings')
  try {
    if (!hasApiKey(llm.provider)) throw new NoApiKeyError(llm.provider)
    const { system, user, temperature } = assembleTransformMessages(
      flowType,
      content,
      context,
      instruction,
      false,
      buildRulesBlock(getSetting('rules'))
    )
    const provider = getLLMProvider(llm.provider)
    const key = getApiKey(llm.provider)!
    const result = await provider.complete(
      {
        model: llm.model,
        system,
        user,
        temperature,
        maxTokens: TRANSFORM_MAX_TOKENS,
        baseUrl: llm.baseUrl || undefined,
        timeoutMs: TIMEOUTS.transform
      },
      key,
      signal
    )
    recordLlmUsage(llm.model, result.usage?.inputTokens ?? 0, result.usage?.outputTokens ?? 0)
    const output = result.text || ''
    if ((!output.trim() || isLLMRefusal(output)) && rawFallback) {
      return { output: rawFallback, fallbackMessage: formattingNotice() }
    }
    return { output, fallbackMessage: null }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    console.warn(`[pipeline] ${flowType} transform failed:`, err instanceof Error ? err.message : err)
    if (rawFallback) return { output: rawFallback, fallbackMessage: formattingNotice() }
    throw err
  }
}

// ── entry point ─────────────────────────────────────────────────────────

export async function runPipeline(session: SessionState, deps: PipelineDeps): Promise<PipelineResult> {
  const dictationCollated = await collate(session, 'dictation')
  const instructionCollated = await collate(session, 'instruction')

  // A fully-failed transcription with no partial content anywhere is a hard
  // error — never silently pasted as empty text.
  if (dictationCollated.hadFailure && instructionCollated.hadFailure && !dictationCollated.text && !instructionCollated.text) {
    throw new Error(dictationCollated.firstError || instructionCollated.firstError || 'Transcription failed')
  }

  const dictationTranscript = applySnippets(
    applyReplacements(cleanTranscript(dictationCollated.text), getSetting('replacements')),
    getSetting('snippets')
  )
  const instructionTranscript = applySnippets(
    applyReplacements(cleanTranscript(instructionCollated.text), getSetting('replacements')),
    getSetting('snippets')
  )
  session.dictationTranscript = dictationTranscript || null
  session.instructionTranscript = instructionTranscript || null

  const hasDictationText = !isJunk(dictationTranscript)
  const hasInstructionText = !isJunk(instructionTranscript)
  const flowType = determineFlowType({
    hasDictationText,
    hasInstructionText,
    hasInstructionAudio: session.instruction.engaged,
    hasSelection: !!session.selectedText
  })
  session.flowType = flowType

  const chunkNotice =
    (flowType === 'dictation' && dictationCollated.hadFailure) ||
    ((flowType === 'instruction' || flowType === 'context' || flowType === 'transform') && instructionCollated.hadFailure)
      ? MISSING_AUDIO_NOTICE
      : null

  let output: string
  let fallbackMessage: string | null = null

  switch (flowType) {
    case 'quote':
      output = `> ${session.selectedText || ''}`
      break

    case 'dictation': {
      if (!hasDictationText) return { outcome: 'skipped' }
      output = dictationTranscript
      if (getSetting('autoFormat') && output.trim()) {
        const profile = getSetting('appAwareFormatting') ? session.profile : 'default'
        const formatted = await runAutoFormat(output, profile, session.abort.signal)
        if (formatted) output = formatted
        else fallbackMessage = formattingNotice()
      }
      break
    }

    case 'context':
      ;({ output, fallbackMessage } = await transformWithFallback(
        'context',
        null,
        session.selectedText,
        instructionTranscript,
        instructionTranscript || '',
        session.abort.signal
      ))
      break

    case 'transform':
      ;({ output, fallbackMessage } = await transformWithFallback(
        'transform',
        dictationTranscript,
        session.selectedTextRole === 'context' ? session.selectedText : null,
        instructionTranscript,
        dictationTranscript || '',
        session.abort.signal
      ))
      break

    case 'instruction':
      ;({ output, fallbackMessage } = await transformWithFallback(
        'instruction',
        null,
        null,
        instructionTranscript,
        instructionTranscript || '',
        session.abort.signal
      ))
      break

    default:
      output = dictationTranscript
  }

  if (!output || !output.trim()) return { outcome: 'skipped' }

  session.output = output
  const outputMode = getSetting('outputMode')
  let degraded: 'clipboard-only' | undefined
  if (outputMode === 'paste') {
    degraded = (await injectOutput(output, { helperCommand: deps.helperCommand })).degraded
  } else {
    copyToClipboard(output)
  }

  const [dictAudioPath, instrAudioPath] = await Promise.all([
    persistAudio(`${session.id}-dictation`),
    persistAudio(`${session.id}-instruction`)
  ])
  session.audioRef = dictAudioPath || instrAudioPath || null

  if (degraded === 'clipboard-only') {
    return { outcome: 'fallback', message: 'Copied — press Ctrl+V', degraded }
  }
  const notice = fallbackMessage || chunkNotice
  if (notice) return { outcome: 'fallback', message: notice }
  return { outcome: 'output' }
}
