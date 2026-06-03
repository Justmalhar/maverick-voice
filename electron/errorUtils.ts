// ─── User-Facing Error Simplification ───
// Maps raw provider/API errors to simple, non-technical messages.
// Raw errors are still logged to console and the Developer error log.
//
// Retuned for BYO-key: Maverick Voice has NO auth/sign-in flow — keys are
// entered per-provider in Settings — so auth-shaped errors point at the API
// key, and "not configured / no api key" points at adding a key in Settings.
//
// First-match-wins: the order of these checks is load-bearing — do NOT reorder.

export function simplifyError(rawError: string): string {
  const lower = rawError.toLowerCase()

  // Auth / token errors — a bad or missing API key
  if (lower.includes('not authenticated') || lower.includes('auth') || lower.includes('token') || lower.includes('unauthorized') || lower.includes('401')) {
    return 'Check your API key in Settings.'
  }

  // Rate limit / usage limit — the provider account hit a cap
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('limit reached') || lower.includes('usage limit') || lower.includes('daily limit')) {
    return 'Usage limit reached. Check your provider dashboard.'
  }

  // Transcription / audio issues
  if (lower.includes('transcription failed') || lower.includes('whisper') || lower.includes('no audio')) {
    return "Couldn't process audio. Try again."
  }

  // Network / connection errors
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('econnrefused') || lower.includes('timeout') || lower.includes('enotfound') || lower.includes('socket')) {
    return 'Connection error. Check your internet.'
  }

  // API / server errors
  if (lower.includes('api error') || lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('internal server error') || lower.includes('service unavailable')) {
    return 'Service temporarily unavailable.'
  }

  // Configuration errors — no key set for the selected provider
  if (lower.includes('not configured') || lower.includes('url not configured') || lower.includes('no api key')) {
    return 'Add your API key in Settings.'
  }

  // Mic errors
  if (lower.includes('mic') || lower.includes('microphone') || lower.includes('notallowederror') || lower.includes('permission')) {
    return 'Mic error. Check permissions.'
  }

  // Default fallback
  return 'Something went wrong. Try again.'
}
