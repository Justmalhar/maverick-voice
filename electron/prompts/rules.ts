// ─── electron/prompts/rules.ts — always-on USER RULES block ───
// User-toggleable instructions injected into LLM formatting prompts. Built-in
// toggles come first, then enabled custom rules. NEVER log rule text.

import type { RulesSettings } from '../../shared/types'

type BuiltinKey = 'fixGrammar' | 'removeFillers' | 'smartPunctuation' | 'professionalTone'

export const BUILTIN_RULES: { key: BuiltinKey; instruction: string }[] = [
  { key: 'fixGrammar', instruction: 'Correct grammar, spelling, and punctuation errors.' },
  {
    key: 'removeFillers',
    instruction: "Remove filler words ('um', 'uh', 'like', 'you know', 'I mean', 'basically', 'sort of')."
  },
  {
    key: 'smartPunctuation',
    instruction: 'Add proper sentence structure and punctuation; split run-ons into clear sentences.'
  },
  {
    key: 'professionalTone',
    instruction: 'Rewrite in a polished, professional tone suitable for business communication.'
  }
]

const RULES_HEADER =
  'USER RULES — the user configured these always-on rules. Apply them to the output. Where a user rule conflicts with an earlier restriction (e.g. tone preservation), the USER RULE takes precedence:'

/** Build the USER RULES block. Returns '' when nothing is enabled. */
export function buildRulesBlock(rules: RulesSettings): string {
  const lines: string[] = []
  for (const { key, instruction } of BUILTIN_RULES) {
    if (rules[key]) lines.push(instruction)
  }
  for (const rule of rules.custom) {
    if (!rule.enabled) continue
    const instruction = rule.instruction.trim()
    if (instruction) lines.push(instruction)
  }
  if (lines.length === 0) return ''
  return `${RULES_HEADER}\n${lines.map((l) => `* ${l}`).join('\n')}`
}
