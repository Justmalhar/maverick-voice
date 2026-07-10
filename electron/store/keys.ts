// ─── Secure multi-provider API key vault (Electron safeStorage) ───
// Each key is encrypted at rest (Keychain / DPAPI) at userData/<provider>-key.enc
// and never written in plaintext. Only main touches keys; the renderer only
// sees set/unset and a masked preview. Ported from legacy/electron/keyStore.ts.
//
// Getters are synchronous against an in-memory cache warmed by loadKeys()
// (called from initStores) — no sync fs anywhere. Dev-only .env seed: when no
// key is stored AND !app.isPackaged, the matching env var is consulted
// (read-only, never persisted). NEVER log key material.

import { app, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { ProviderId } from '../../shared/types'

/** Env var consulted as the dev-mode fallback per provider. */
const ENV_VAR: Record<ProviderId, string> = {
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  custom: 'CUSTOM_API_KEY',
  local: 'LOCAL_API_KEY' // optional — local servers usually need none
}
const PROVIDERS = Object.keys(ENV_VAR) as ProviderId[]

// undefined (absent) => not loaded yet; null => loaded, no stored key.
const cache = new Map<ProviderId, string | null>()
let warned = false

function keyFilePath(provider: ProviderId): string {
  return path.join(app.getPath('userData'), `${provider}-key.enc`)
}

/**
 * Tiny KEY=VALUE .env loader (dev only — no dotenv dep). Real environment
 * variables win; values are only filled in when the var is unset.
 */
async function loadDotEnv(): Promise<void> {
  try {
    const text = await fs.readFile(path.join(app.getAppPath(), '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      const k = t.slice(0, eq).trim()
      let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (k && v && process.env[k] === undefined) process.env[k] = v
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e?.code !== 'ENOENT') console.warn('[keyStore] failed to read .env:', e?.message ?? err)
  }
}

async function loadOne(provider: ProviderId): Promise<void> {
  if (cache.has(provider)) return
  cache.set(provider, null)
  try {
    const encrypted = await fs.readFile(keyFilePath(provider))
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(`[keyStore] OS encryption unavailable — cannot read stored ${provider} key`)
      return
    }
    cache.set(provider, safeStorage.decryptString(encrypted))
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e?.code !== 'ENOENT') {
      console.error(`[keyStore] failed to load ${provider} key:`, e?.message ?? err)
    }
  }
}

/** Warm the vault at boot (called from initStores). Loads .env first in dev. */
export async function loadKeys(): Promise<void> {
  if (!app.isPackaged) await loadDotEnv()
  await Promise.all(PROVIDERS.map(loadOne))
}

/** Dev-mode .env seed — read-only, never written to disk or the cache. */
function envSeed(provider: ProviderId): string | null {
  if (app.isPackaged) return null
  const trimmed = process.env[ENV_VAR[provider]]?.trim()
  return trimmed || null
}

/** Decrypted key for a provider, or null. Falls back to the dev .env seed. */
export function getApiKey(provider: ProviderId): string | null {
  if (!cache.has(provider) && !warned) {
    warned = true
    console.warn('[keyStore] getApiKey before loadKeys() — vault not warmed yet')
  }
  return cache.get(provider) ?? envSeed(provider)
}

/** Whether a key is currently available (stored or via .env). */
export function hasApiKey(provider: ProviderId): boolean {
  return !!getApiKey(provider)
}

/**
 * Encrypt + persist a key (empty string clears). Throws if OS encryption is
 * unavailable. Cache is primed synchronously; the disk write is async.
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
  cache.set(provider, trimmed)
  fs.writeFile(keyFilePath(provider), encrypted)
    .then(() => console.log(`[keyStore] ${provider} API key saved (encrypted)`))
    .catch((err) =>
      console.error(`[keyStore] failed to persist ${provider} key:`, err instanceof Error ? err.message : err)
    )
}

/** Delete the stored key for a provider. */
export function clearApiKey(provider: ProviderId): void {
  cache.set(provider, null)
  fs.unlink(keyFilePath(provider)).catch((err) => {
    const e = err as NodeJS.ErrnoException
    if (e?.code !== 'ENOENT') {
      console.error(`[keyStore] failed to clear ${provider} key:`, e?.message ?? err)
    }
  })
}

/**
 * Masked preview for the UI, e.g. "gsk_••••1234". Null if no key.
 * Detects known prefixes; otherwise the first 4 chars.
 */
export function getMaskedKey(provider: ProviderId): string | null {
  const key = getApiKey(provider)
  if (!key) return null
  let prefix: string
  if (key.startsWith('gsk_')) prefix = 'gsk_'
  else if (key.startsWith('sk-or-')) prefix = 'sk-or-'
  else if (key.startsWith('sk-')) prefix = 'sk-'
  else prefix = key.slice(0, 4)
  return `${prefix}••••${key.slice(-4)}`
}
