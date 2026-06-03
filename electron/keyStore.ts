// ─── Secure multi-provider API key storage (Electron safeStorage) ───
// Each provider's API key is encrypted at rest with the OS keychain (Keychain
// on macOS, DPAPI on Windows) and never written in plaintext. Only the main
// process touches the keys; the renderer only ever sees whether a key is set
// and a masked preview.
//
// Ported from unmute-dictation/electron/keyStore.ts, generalized to the three
// providers {groq, openai, openrouter}. Per-provider files live at
// `userData/${provider}-key.enc`. A per-provider in-memory cache loads once.
//
// .env dev-mode seed: when no key is stored for a provider, fall back (READ
// ONLY, never written) to the matching environment variable — GROQ_API_KEY,
// OPENAI_API_KEY, OPENROUTER_API_KEY. Useful for local development; production
// users enter keys via the Settings UI.

import { app, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { ProviderId } from '../shared/types'

/** The environment variable consulted as a dev-mode fallback per provider. */
const ENV_VAR: Record<ProviderId, string> = {
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

function keyFilePath(provider: ProviderId): string {
  return path.join(app.getPath('userData'), `${provider}-key.enc`)
}

// Per-provider cache: undefined => not loaded yet; null => loaded, no stored key.
const cache = new Map<ProviderId, string | null>()

/** Load + decrypt the stored key for a provider into memory (once). */
function load(provider: ProviderId): void {
  if (cache.has(provider)) return
  cache.set(provider, null)
  try {
    const file = keyFilePath(provider)
    if (!fs.existsSync(file)) return
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(`[keyStore] OS encryption unavailable — cannot read stored ${provider} key`)
      return
    }
    const encrypted = fs.readFileSync(file)
    cache.set(provider, safeStorage.decryptString(encrypted))
  } catch (err) {
    console.error(`[keyStore] Failed to load ${provider} key:`, err instanceof Error ? err.message : err)
    cache.set(provider, null)
  }
}

/**
 * Read the .env dev-mode seed for a provider, if present. Never persisted.
 *
 * Gated to development ONLY (`!app.isPackaged`). A packaged build still inherits
 * the real process environment, so without this guard an exported GROQ_API_KEY /
 * OPENAI_API_KEY / OPENROUTER_API_KEY would silently seed (or override the
 * absence of) a provider key with no opt-in. In production, users enter keys via
 * the Settings UI.
 */
function envSeed(provider: ProviderId): string | null {
  if (app.isPackaged) return null
  const raw = process.env[ENV_VAR[provider]]
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

/**
 * Returns the decrypted API key for a provider, or null if none is set.
 * Falls back to the matching environment variable when nothing is stored.
 */
export function getApiKey(provider: ProviderId): string | null {
  load(provider)
  const stored = cache.get(provider) ?? null
  if (stored) return stored
  // Dev-mode .env fallback: read-only, never written to disk or the cache.
  return envSeed(provider)
}

/** Whether a key is currently available for a provider (stored or via .env). */
export function hasApiKey(provider: ProviderId): boolean {
  return !!getApiKey(provider)
}

/**
 * Encrypt + persist the key for a provider (or clear it when given an empty
 * string). Throws if OS encryption is unavailable.
 */
export function setApiKey(provider: ProviderId, key: string): void {
  const trimmed = (key || '').trim()
  if (!trimmed) {
    clearApiKey(provider)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable — cannot store API key securely')
  }
  const encrypted = safeStorage.encryptString(trimmed)
  fs.writeFileSync(keyFilePath(provider), encrypted)
  // Prime the cache to avoid a re-read.
  cache.set(provider, trimmed)
  console.log(`[keyStore] ${provider} API key saved (encrypted)`)
}

/** Delete the stored key for a provider. */
export function clearApiKey(provider: ProviderId): void {
  try {
    const file = keyFilePath(provider)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch (err) {
    console.error(`[keyStore] Failed to clear ${provider} key:`, err instanceof Error ? err.message : err)
  }
  cache.set(provider, null)
}

/**
 * A masked preview for the UI, e.g. "gsk_••••1234" / "sk-or-••••1234" /
 * "sk-••••1234". Null if no key. Detects the known prefixes; otherwise uses the
 * first 4 chars.
 */
export function getMaskedKey(provider: ProviderId): string | null {
  const key = getApiKey(provider)
  if (!key) return null
  let prefix: string
  if (key.startsWith('gsk_')) prefix = 'gsk_'
  else if (key.startsWith('sk-or-')) prefix = 'sk-or-'
  else if (key.startsWith('sk-')) prefix = 'sk-'
  else prefix = key.slice(0, 4)
  const last4 = key.slice(-4)
  return `${prefix}••••${last4}`
}
