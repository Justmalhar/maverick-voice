// ─── electron/session/flows.ts — pure flow-type routing ───
// v2 CHANGE from legacy determineFlowType (LEGACY-ISSUES §3 item 6): a
// pre-existing selection no longer hijacks plain dictation into `quote` — a
// dictation session with non-junk dictation text is ALWAYS routed as
// 'dictation', selection or not. `quote` now requires that the INSTRUCTION
// key was engaged (a selection was captured for it) but nothing was actually
// spoken — i.e. the user held the instruction key over a selection with no
// command, so the intent collapses to "just quote this" rather than sending
// an empty instruction to the LLM.

import type { FlowType } from '../../shared/types'

export interface FlowInputs {
  /** Non-empty, non-junk dictation transcript present. */
  hasDictationText: boolean
  /** Non-empty, non-junk instruction transcript present. */
  hasInstructionText: boolean
  /** Instruction-mode audio was captured this session, regardless of whether
   *  it produced usable text (Caps Lock was engaged). */
  hasInstructionAudio: boolean
  /** A selection was captured at session start (either role). */
  hasSelection: boolean
}

export function determineFlowType(i: FlowInputs): FlowType {
  const { hasDictationText, hasInstructionText, hasInstructionAudio, hasSelection } = i

  // Chained dictation + instruction (spoken command applied to dictated content).
  if (hasDictationText && hasInstructionText) return 'transform'

  // Instruction key held over a selection, but no command was actually spoken.
  if (hasInstructionAudio && hasSelection && !hasDictationText && !hasInstructionText) return 'quote'

  // Instruction + selection, command present → run it against the selection.
  if (hasInstructionText && hasSelection && !hasDictationText) return 'context'

  // Plain dictation — selection present or not, it NEVER hijacks into quote.
  if (hasDictationText) return 'dictation'

  if (hasInstructionText) return 'instruction'

  // Nothing usable on either channel and no quote-eligible selection — the
  // pipeline's junk/empty-output guard handles this before output; 'dictation'
  // is a harmless default (empty text, no-op).
  return 'dictation'
}
