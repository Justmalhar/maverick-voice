// ════════════════════════════════════════════════════════════════════════
// shared/copy.ts — SINGLE SOURCE OF TRUTH for all user-facing strings.
//
// Imported by BOTH the main process (electron/**) and the renderer
// (renderer/**). Must stay free of runtime imports (no electron, no node,
// no React). Edit here to update any user-visible text across the app.
//
// Organisation:
//   ERRORS     — messages from simplifyError() shown in the HUD on failure
//   KEY_TEST   — messages from testKey() shown in Settings / Onboarding
//   RETRY      — messages from the session retry handler in main.ts
//   FORMATTING — fallback notices when the LLM format pass fails
//   WIDGET     — HUD pill default strings
// ════════════════════════════════════════════════════════════════════════

// ─── Error simplification (errorUtils.ts → HUD) ──────────────────────────

export const ERRORS = {
  INVALID_API_KEY:   'Your API key looks wrong — check it in Settings.',
  RATE_LIMIT:        'Usage limit reached — check your provider dashboard.',
  AUDIO_FAILED:      "Couldn't transcribe audio — try speaking again.",
  NO_INTERNET:       'No internet connection — check your network.',
  SERVICE_DOWN:      'Service temporarily unavailable — try again soon.',
  NO_API_KEY:        'Add your API key in Settings to get started.',
  MIC_DENIED:        'Microphone access denied — check System Settings.',
  GENERIC:           'Something went wrong — please try again.',
} as const

// ─── API key validation (testKey across all providers → Settings / Onboarding) ─

export const KEY_TEST = {
  EMPTY:         'Please enter your API key.',
  INVALID:       "That API key isn't valid — double-check it.",
  SERVICE_ERROR: 'Service error — try again later.',
  NETWORK_ERROR: 'Connection error — check your internet.',
} as const

// ─── Session retry (main.ts → History row) ───────────────────────────────

export const RETRY = {
  SESSION_NOT_FOUND: 'Recording not found — it may have been cleared.',
  AUDIO_MISSING:     'Recording file is missing — try dictating again.',
  NO_SPEECH:         'No speech detected — try a longer recording.',
  FAILED:            'Retry failed — please try again.',
} as const

// ─── Formatting fallback notices (sessionManager.ts → HUD + engine notice) ─

export const FORMATTING = {
  FAILED_HAS_KEY:  'Oops, formatting failed — raw text pasted',
  FAILED_NO_KEY:   'Add an API key in Settings to enable formatting',
  HISTORY_HINT:    'Open History to view full transcript',
} as const

// ─── Widget / HUD pill defaults (Widget.tsx + WidgetApp.tsx) ─────────────

export const WIDGET = {
  ERROR_DEFAULT:    'Something went wrong',
  ERROR_RETRY_HINT: 'Retry from History to regenerate',
  FALLBACK_DEFAULT: 'Oops, formatting failed — raw text pasted',
  MIC_START_FAILED: 'Microphone access denied — check System Settings.',
} as const
