// ════════════════════════════════════════════════════════════════════════
// electron/appProfiles.ts — frontmost-app -> AppProfile mapping + the per-
// profile AUTO_FORMAT instruction blocks.
//
// ONE extensible data table maps darwin bundle ids AND win32 process names to a
// formatting profile. detectProfile() does case-insensitive exact/substring
// matching (com.jetbrains.* is a PREFIX match). profilePromptBlock() returns
// the instruction block appended to the BASE RULES in
// prompts.buildAutoFormatPrompt().
//
// Imported by: sessionManager.ts (resolve profile at session start),
// prompts.ts (profilePromptBlock).
// ════════════════════════════════════════════════════════════════════════

import type { AppProfile } from '../shared/types'

// Re-export so importers can reach the type through this module (the type still
// LIVES in shared/types.ts per the contract).
export type { AppProfile }

/**
 * Match style for one identifier entry. `exact` = case-insensitive equality;
 * `prefix` = case-insensitive startsWith (used for `com.jetbrains.*`).
 */
type MatchKind = 'exact' | 'prefix'

interface ProfileRule {
  /** Lowercased identifier (darwin bundle id OR win32 process name). */
  id: string
  kind: MatchKind
}

/**
 * THE mapping table. Add a new app by appending one row here. Identifiers are
 * stored lowercase; detectProfile lowercases its inputs before comparing.
 * Anything not matched (browsers included) falls through to 'default'.
 */
const PROFILE_TABLE: Record<Exclude<AppProfile, 'default'>, ProfileRule[]> = {
  email: [
    { id: 'com.apple.mail', kind: 'exact' },
    { id: 'com.microsoft.outlook', kind: 'exact' },
    { id: 'com.readdle.smartemail', kind: 'exact' },
    { id: 'com.superhuman.electron', kind: 'exact' },
    { id: 'com.missiveapp.missive', kind: 'exact' },
    { id: 'olk.exe', kind: 'exact' },
    { id: 'outlook.exe', kind: 'exact' }
  ],
  'chat-ai': [
    { id: 'com.openai.chat', kind: 'exact' },
    { id: 'com.anthropic.claudefordesktop', kind: 'exact' },
    { id: 'ai.perplexity.mac', kind: 'exact' },
    { id: 'chatgpt.exe', kind: 'exact' },
    { id: 'claude.exe', kind: 'exact' }
  ],
  'code-editor': [
    { id: 'com.microsoft.vscode', kind: 'exact' },
    { id: 'com.todesktop.230313mzl4w4u92', kind: 'exact' }, // Cursor
    { id: 'com.google.antigravity', kind: 'exact' },
    { id: 'dev.zed.zed', kind: 'exact' },
    { id: 'com.exafunction.windsurf', kind: 'exact' },
    { id: 'com.jetbrains.', kind: 'prefix' }, // IntelliJ/WebStorm/PyCharm/etc.
    { id: 'com.sublimetext.4', kind: 'exact' },
    { id: 'code.exe', kind: 'exact' },
    { id: 'cursor.exe', kind: 'exact' },
    { id: 'antigravity.exe', kind: 'exact' },
    { id: 'windsurf.exe', kind: 'exact' },
    { id: 'idea64.exe', kind: 'exact' }
  ],
  messaging: [
    { id: 'com.tinyspeck.slackmacgap', kind: 'exact' },
    { id: 'com.hnc.discord', kind: 'exact' },
    { id: 'net.whatsapp.whatsapp', kind: 'exact' },
    { id: 'ru.keepcoder.telegram', kind: 'exact' },
    { id: 'com.microsoft.teams2', kind: 'exact' },
    { id: 'com.apple.mobilesms', kind: 'exact' },
    { id: 'slack.exe', kind: 'exact' },
    { id: 'discord.exe', kind: 'exact' },
    { id: 'teams.exe', kind: 'exact' },
    { id: 'whatsapp.exe', kind: 'exact' },
    { id: 'telegram.exe', kind: 'exact' }
  ],
  notes: [
    { id: 'notion.id', kind: 'exact' },
    { id: 'md.obsidian', kind: 'exact' },
    { id: 'com.apple.notes', kind: 'exact' },
    { id: 'net.shinyfrog.bear', kind: 'exact' },
    { id: 'com.lukilabs.lukiapp', kind: 'exact' }, // Craft
    { id: 'notion.exe', kind: 'exact' },
    { id: 'obsidian.exe', kind: 'exact' }
  ]
}

// Deterministic iteration order for matching (email -> chat-ai -> code-editor
// -> messaging -> notes). No identifier appears under two profiles, so order
// only affects which loop short-circuits first; the explicit order keeps the
// behavior obvious.
const PROFILE_ORDER: Exclude<AppProfile, 'default'>[] = [
  'email',
  'chat-ai',
  'code-editor',
  'messaging',
  'notes'
]

function matchesRule(candidate: string, rule: ProfileRule): boolean {
  if (rule.kind === 'prefix') return candidate.startsWith(rule.id)
  return candidate === rule.id
}

/**
 * Resolve the AppProfile for a detected frontmost app. Matches the bundle id /
 * process name FIRST (the reliable signal); the localized name is a secondary
 * fallback so a renamed/loosely-identified app can still match by substring.
 * Case-insensitive throughout. Unknown apps (browsers included) -> 'default'.
 */
export function detectProfile(appId: string | null, appName: string | null): AppProfile {
  const id = (appId || '').trim().toLowerCase()
  const name = (appName || '').trim().toLowerCase()

  for (const profile of PROFILE_ORDER) {
    for (const rule of PROFILE_TABLE[profile]) {
      // Primary: match against the bundle id / process name.
      if (id && matchesRule(id, rule)) return profile
      // Secondary: tolerate the localized name carrying the identifier (e.g.
      // when only a name is available). Exact rules become a substring test on
      // the name; prefix rules use startsWith on the name.
      if (name) {
        if (rule.kind === 'prefix') {
          if (name.startsWith(rule.id)) return profile
        } else if (name.includes(rule.id)) {
          return profile
        }
      }
    }
  }
  return 'default'
}

// ════════════════════════════════════════════════════════════════════════
// Per-profile AUTO_FORMAT instruction blocks. Each is appended to the shared
// BASE RULES (in prompts.buildAutoFormatPrompt) to adapt the copy-edit pass to
// the destination app. 'default' adds nothing (BASE RULES only).
// ════════════════════════════════════════════════════════════════════════

const EMAIL_BLOCK = `TARGET: EMAIL.
* Output PLAIN TEXT only — no markdown syntax (no #, *, _, backticks, or table pipes).
* Organize the body into clear, readable paragraphs.
* Keep any dictated greeting (e.g. "Hi John,") and sign-off (e.g. "Best, Malhar") each on their own line(s).
* Keep a professional register, but PRESERVE the user's own tone and word choice — do not formalize beyond fixing mechanics.`

const CHAT_AI_BLOCK = `TARGET: AI CHAT ASSISTANT.
* MINIMAL intervention — keep the user's raw phrasing and intent intact.
* Fix only obvious transcription artifacts and punctuation; do not restructure or polish.
* When a token is UNAMBIGUOUSLY inline code or a technical identifier, wrap it in backticks; otherwise leave it as-is.`

const CODE_EDITOR_BLOCK = `TARGET: IN-IDE AI ASSISTANT PROMPT. The corrected text is a prompt typed into a code editor's AI assistant.
* Spoken filenames become @-references: "main dot py" -> @main.py, "user service dot ts" -> @userService.ts (best-effort camelCase join when the user spells a multi-word filename). A descriptive phrase like "the user service file" stays as plain text.
* Keep identifiers, API names, and technical terms VERBATIM.
* Wrap inline code/technical tokens in backticks when unambiguous.`

const MESSAGING_BLOCK = `TARGET: CASUAL MESSAGING.
* Casual register, short lines.
* NO markdown headers and no heavy formatting — keep it light and conversational.
* Use bullet lists ONLY for explicit enumerations (3+ items the user clearly listed); otherwise keep prose.`

const NOTES_BLOCK = `TARGET: NOTES / MARKDOWN DOCUMENT.
* Full markdown is allowed.
* Create a heading when the user dictates one (e.g. "heading: Project plan" -> a markdown heading).
* Use bullet and numbered lists for enumerations.
* Apply bold ONLY to words the user explicitly marks (e.g. "bold: important" -> **important**).`

/**
 * Return the per-profile instruction block appended after BASE RULES. 'default'
 * contributes nothing (BASE RULES only).
 */
export function profilePromptBlock(profile: AppProfile): string {
  switch (profile) {
    case 'email':
      return EMAIL_BLOCK
    case 'chat-ai':
      return CHAT_AI_BLOCK
    case 'code-editor':
      return CODE_EDITOR_BLOCK
    case 'messaging':
      return MESSAGING_BLOCK
    case 'notes':
      return NOTES_BLOCK
    case 'default':
    default:
      return ''
  }
}
