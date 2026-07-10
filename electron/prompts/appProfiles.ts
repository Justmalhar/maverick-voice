// ─── electron/prompts/appProfiles.ts — frontmost-app → AppProfile mapping ───
// Data table + per-profile AUTO_FORMAT instruction blocks, ported VERBATIM
// from v1 appProfiles.ts. detectProfile() does case-insensitive exact/prefix
// matching (com.jetbrains.* is a PREFIX match); profilePromptBlock() returns
// the block appended to BASE RULES in prompts.buildAutoFormatPrompt().

import type { AppProfile } from '../../shared/types'

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
 * THE mapping table. Add a new app by appending one row. Identifiers are
 * stored lowercase; detectProfile lowercases its inputs before comparing.
 * Anything not matched (browsers included) falls through to 'default'.
 * Grouped macOS bundle id → Windows .exe → Linux process name.
 */
const PROFILE_TABLE: Record<Exclude<AppProfile, 'default'>, ProfileRule[]> = {
  email: [
    // macOS
    { id: 'com.apple.mail', kind: 'exact' },
    { id: 'com.microsoft.outlook', kind: 'exact' },
    { id: 'com.readdle.smartemail', kind: 'exact' }, // Spark (Readdle)
    { id: 'com.sparkmailapp.spark-desktop', kind: 'exact' }, // Spark Desktop 3.x
    { id: 'com.superhuman.electron', kind: 'exact' },
    { id: 'com.missiveapp.missive', kind: 'exact' },
    { id: 'it.bloop.airmail2', kind: 'exact' }, // Airmail 5
    { id: 'com.mimestream.mimestream', kind: 'exact' }, // Mimestream (Gmail-native)
    { id: 'com.hey.hey', kind: 'exact' }, // HEY
    { id: 'com.postbox.postboxapp', kind: 'exact' },
    { id: 'org.mozilla.thunderbird', kind: 'exact' },
    // Windows
    { id: 'olk.exe', kind: 'exact' },
    { id: 'outlook.exe', kind: 'exact' },
    { id: 'thunderbird.exe', kind: 'exact' },
    { id: 'postbox.exe', kind: 'exact' },
    { id: 'hiri.exe', kind: 'exact' },
    // Linux
    { id: 'thunderbird', kind: 'exact' },
    { id: 'evolution', kind: 'exact' },
    { id: 'geary', kind: 'exact' },
    { id: 'kmail', kind: 'exact' },
    { id: 'claws-mail', kind: 'exact' }
  ],
  'chat-ai': [
    // macOS
    { id: 'com.openai.chat', kind: 'exact' },
    { id: 'com.anthropic.claudefordesktop', kind: 'exact' },
    { id: 'ai.perplexity.mac', kind: 'exact' },
    { id: 'com.poe.poe', kind: 'exact' }, // Poe
    { id: 'com.google.gemini', kind: 'exact' }, // Gemini desktop
    { id: 'com.mistral.lechat', kind: 'exact' }, // Mistral Le Chat
    // Windows
    { id: 'chatgpt.exe', kind: 'exact' },
    { id: 'claude.exe', kind: 'exact' },
    { id: 'perplexity.exe', kind: 'exact' },
    { id: 'poe.exe', kind: 'exact' },
    { id: 'gemini.exe', kind: 'exact' },
    // Linux (most use web; cover Electron wrappers by name)
    { id: 'chatgpt', kind: 'exact' },
    { id: 'claude', kind: 'exact' }
  ],
  'code-editor': [
    // macOS
    { id: 'com.microsoft.vscode', kind: 'exact' },
    { id: 'com.todesktop.230313mzl4w4u92', kind: 'exact' }, // Cursor
    { id: 'com.todesktop.', kind: 'prefix' }, // other Todesktop-wrapped editors
    { id: 'com.google.antigravity', kind: 'exact' }, // Project IDX
    { id: 'dev.zed.zed', kind: 'exact' },
    { id: 'com.exafunction.windsurf', kind: 'exact' },
    { id: 'com.jetbrains.', kind: 'prefix' }, // IntelliJ/WebStorm/PyCharm/GoLand/Rider/…
    { id: 'com.sublimetext.4', kind: 'exact' },
    { id: 'com.sublimetext.3', kind: 'exact' },
    { id: 'com.apple.dt.xcode', kind: 'exact' }, // Xcode
    { id: 'com.panic.nova', kind: 'exact' }, // Nova (macOS-only)
    { id: 'org.gnu.emacs', kind: 'exact' },
    { id: 'com.bbedit.bbedit', kind: 'exact' }, // BBEdit
    { id: 'com.github.atom', kind: 'exact' },
    { id: 'dev.warp.warp', kind: 'exact' }, // Warp terminal
    { id: 'com.googlecode.iterm2', kind: 'exact' }, // iTerm2
    { id: 'com.apple.terminal', kind: 'exact' }, // macOS Terminal
    // Windows
    { id: 'code.exe', kind: 'exact' },
    { id: 'cursor.exe', kind: 'exact' },
    { id: 'antigravity.exe', kind: 'exact' },
    { id: 'windsurf.exe', kind: 'exact' },
    { id: 'idea64.exe', kind: 'exact' },
    { id: 'webstorm64.exe', kind: 'exact' },
    { id: 'pycharm64.exe', kind: 'exact' },
    { id: 'goland64.exe', kind: 'exact' },
    { id: 'clion64.exe', kind: 'exact' },
    { id: 'rider64.exe', kind: 'exact' },
    { id: 'fleet64.exe', kind: 'exact' }, // JetBrains Fleet
    { id: 'devenv.exe', kind: 'exact' }, // Visual Studio
    { id: 'sublime_text.exe', kind: 'exact' },
    { id: 'notepad++.exe', kind: 'exact' },
    { id: 'atom.exe', kind: 'exact' },
    { id: 'zed.exe', kind: 'exact' },
    { id: 'wt.exe', kind: 'exact' }, // Windows Terminal
    { id: 'powershell.exe', kind: 'exact' },
    { id: 'pwsh.exe', kind: 'exact' }, // PowerShell Core
    // Linux
    { id: 'code', kind: 'exact' }, // VS Code
    { id: 'cursor', kind: 'exact' },
    { id: 'zed', kind: 'exact' },
    { id: 'subl', kind: 'exact' }, // Sublime Text
    { id: 'atom', kind: 'exact' },
    { id: 'emacs', kind: 'exact' },
    { id: 'nvim', kind: 'exact' },
    { id: 'vim', kind: 'exact' },
    { id: 'kate', kind: 'exact' }, // KDE Advanced Text Editor
    { id: 'gnome-terminal', kind: 'exact' },
    { id: 'konsole', kind: 'exact' },
    { id: 'kitty', kind: 'exact' },
    { id: 'alacritty', kind: 'exact' },
    { id: 'warp', kind: 'exact' }
  ],
  messaging: [
    // macOS
    { id: 'com.tinyspeck.slackmacgap', kind: 'exact' },
    { id: 'com.hnc.discord', kind: 'exact' },
    { id: 'net.whatsapp.whatsapp', kind: 'exact' },
    { id: 'ru.keepcoder.telegram', kind: 'exact' },
    { id: 'com.microsoft.teams2', kind: 'exact' },
    { id: 'com.microsoft.teams', kind: 'exact' },
    { id: 'com.apple.mobilesms', kind: 'exact' }, // Messages
    { id: 'com.facebook.archon', kind: 'exact' }, // Messenger for Mac
    { id: 'com.skype.skype', kind: 'exact' },
    { id: 'jp.naver.line.mac', kind: 'exact' }, // LINE
    { id: 'org.whispersystems.signal-desktop', kind: 'exact' },
    { id: 'com.zoom.us', kind: 'exact' },
    { id: 'com.lark.electronapp', kind: 'exact' }, // Lark / Feishu
    { id: 'com.viber.desktop', kind: 'exact' },
    { id: 'com.google.chat', kind: 'exact' }, // Google Chat
    { id: 'com.rocketchat.rocketdesktop', kind: 'exact' }, // Rocket.Chat
    // Windows
    { id: 'slack.exe', kind: 'exact' },
    { id: 'discord.exe', kind: 'exact' },
    { id: 'teams.exe', kind: 'exact' },
    { id: 'whatsapp.exe', kind: 'exact' },
    { id: 'telegram.exe', kind: 'exact' },
    { id: 'signal.exe', kind: 'exact' },
    { id: 'messenger.exe', kind: 'exact' },
    { id: 'skype.exe', kind: 'exact' },
    { id: 'line.exe', kind: 'exact' },
    { id: 'zoom.exe', kind: 'exact' },
    { id: 'viber.exe', kind: 'exact' },
    { id: 'googlechat.exe', kind: 'exact' },
    // Linux
    { id: 'slack', kind: 'exact' },
    { id: 'discord', kind: 'exact' },
    { id: 'telegram-desktop', kind: 'exact' },
    { id: 'signal-desktop', kind: 'exact' },
    { id: 'teams', kind: 'exact' },
    { id: 'teams-for-linux', kind: 'exact' },
    { id: 'skypeforlinux', kind: 'exact' },
    { id: 'element-desktop', kind: 'exact' }, // Matrix/Element
    { id: 'zoom', kind: 'exact' }
  ],
  notes: [
    // macOS
    { id: 'notion.id', kind: 'exact' },
    { id: 'md.obsidian', kind: 'exact' },
    { id: 'com.apple.notes', kind: 'exact' },
    { id: 'net.shinyfrog.bear', kind: 'exact' },
    { id: 'com.lukilabs.lukiapp', kind: 'exact' }, // Craft
    { id: 'com.evernote.evernote', kind: 'exact' },
    { id: 'com.microsoft.onenote', kind: 'exact' },
    { id: 'app.simplenote.simplenote', kind: 'exact' },
    { id: 'com.soulmen.ulysses3', kind: 'exact' }, // Ulysses
    { id: 'com.logseq.logseq', kind: 'exact' },
    { id: 'com.dayoneapp.dayone', kind: 'exact' },
    { id: 'com.roamresearch.app', kind: 'exact' }, // Roam Research
    { id: 'app.inkdrop.inkdrop', kind: 'exact' },
    { id: 'com.omnigroup.omnioutliner5', kind: 'exact' },
    { id: 'com.microsoft.word', kind: 'exact' }, // Word (document editing)
    { id: 'com.apple.iwork.pages', kind: 'exact' }, // Pages
    // Windows
    { id: 'notion.exe', kind: 'exact' },
    { id: 'obsidian.exe', kind: 'exact' },
    { id: 'onenote.exe', kind: 'exact' },
    { id: 'evernote.exe', kind: 'exact' },
    { id: 'logseq.exe', kind: 'exact' },
    { id: 'joplin.exe', kind: 'exact' },
    { id: 'typora.exe', kind: 'exact' },
    { id: 'marktext.exe', kind: 'exact' },
    { id: 'simplenote.exe', kind: 'exact' },
    { id: 'winword.exe', kind: 'exact' }, // Microsoft Word
    // Linux
    { id: 'obsidian', kind: 'exact' },
    { id: 'logseq', kind: 'exact' },
    { id: 'joplin', kind: 'exact' },
    { id: 'zettlr', kind: 'exact' },
    { id: 'marktext', kind: 'exact' },
    { id: 'typora', kind: 'exact' },
    { id: 'cherrytree', kind: 'exact' },
    { id: 'vnote', kind: 'exact' },
    { id: 'notion', kind: 'exact' }
  ]
}

// Deterministic iteration order for matching. No identifier appears under two
// profiles, so order only affects which loop short-circuits first.
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
 * Case-insensitive throughout. Unknown apps (browsers included) → 'default'.
 */
export function detectProfile(appId: string | null, appName: string | null): AppProfile {
  const id = (appId || '').trim().toLowerCase()
  const name = (appName || '').trim().toLowerCase()

  for (const profile of PROFILE_ORDER) {
    for (const rule of PROFILE_TABLE[profile]) {
      if (id && matchesRule(id, rule)) return profile
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

// ─── Per-profile AUTO_FORMAT instruction blocks (v1 verbatim) ───

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
 * Return the per-profile instruction block appended after BASE RULES.
 * 'default' contributes nothing (BASE RULES only).
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
