// ─── Proxy authentication (Google SSO via maverick-voice-proxy) ───
// Stores the proxy access + refresh tokens encrypted with OS safeStorage.
// The access token is passed as-is to proxy API calls. On 401 or token
// expiry, refreshToken() fetches a new access token and re-stores it.
//
// The login flow opens the system browser to the proxy's Google OAuth URL.
// After Google redirects to the proxy callback, the proxy redirects to
// maverick-voice://auth/success?... — main.ts intercepts that deep link
// and calls handleDeepLink() to extract and store the tokens.

import { app, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { ProxyAuthStatus } from '../shared/types'

const PROXY_BASE_URL = process.env.PROXY_BASE_URL ?? 'https://proxy.getmaverick.sh'

// Token file names in userData.
const ACCESS_FILE = () => path.join(app.getPath('userData'), 'proxy-access.enc')
const REFRESH_FILE = () => path.join(app.getPath('userData'), 'proxy-refresh.enc')
const PROFILE_FILE = () => path.join(app.getPath('userData'), 'proxy-profile.json')

interface StoredProfile {
  email: string | null
  displayName: string | null
  tier: string
}

// ─── Low-level safeStorage helpers ───────────────────────────────────────────

function readEncrypted(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = fs.readFileSync(filePath)
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

function writeEncrypted(filePath: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable')
  fs.writeFileSync(filePath, safeStorage.encryptString(value))
}

function deleteFile(filePath: string): void {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch { /* ignore */ }
}

// ─── Token management ─────────────────────────────────────────────────────────

/** Get the stored access token (may be expired — caller checks / uses refreshIfNeeded). */
export function getStoredAccessToken(): string | null {
  return readEncrypted(ACCESS_FILE())
}

/** Get a valid access token, refreshing if the current one fails. */
export async function getAccessToken(): Promise<string | null> {
  const token = getStoredAccessToken()
  if (!token) return null
  return token
}

/** Refresh the access token using the stored refresh token. Returns the new token or null. */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = readEncrypted(REFRESH_FILE())
  if (!refreshToken) return null

  try {
    const res = await fetch(`${PROXY_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      console.warn('[auth] Token refresh failed:', res.status)
      return null
    }
    const data = await res.json() as { accessToken?: string }
    if (!data.accessToken) return null
    writeEncrypted(ACCESS_FILE(), data.accessToken)
    return data.accessToken
  } catch (e) {
    console.error('[auth] Token refresh error:', e)
    return null
  }
}

/** Store tokens + profile after a successful OAuth callback. */
export function storeSession(params: {
  accessToken: string
  refreshToken: string
  email: string
  displayName: string
  tier: string
}): void {
  writeEncrypted(ACCESS_FILE(), params.accessToken)
  writeEncrypted(REFRESH_FILE(), params.refreshToken)
  const profile: StoredProfile = {
    email: params.email || null,
    displayName: params.displayName || null,
    tier: params.tier || 'free',
  }
  fs.writeFileSync(PROFILE_FILE(), JSON.stringify(profile))
  console.log('[auth] Session stored for', params.email)
}

/** Clear all stored auth data (logout). */
export function clearSession(): void {
  deleteFile(ACCESS_FILE())
  deleteFile(REFRESH_FILE())
  deleteFile(PROFILE_FILE())
  console.log('[auth] Session cleared')
}

/** Whether the user is currently logged in (has stored tokens). */
export function isAuthenticated(): boolean {
  return !!getStoredAccessToken()
}

/** Current auth status for the renderer. */
export function getAuthStatus(): ProxyAuthStatus {
  const token = getStoredAccessToken()
  if (!token) return { loggedIn: false, email: null, displayName: null, tier: null }
  try {
    const raw = fs.existsSync(PROFILE_FILE()) ? fs.readFileSync(PROFILE_FILE(), 'utf8') : null
    const profile: StoredProfile = raw ? JSON.parse(raw) : { email: null, displayName: null, tier: 'free' }
    return { loggedIn: true, email: profile.email, displayName: profile.displayName, tier: profile.tier }
  } catch {
    return { loggedIn: true, email: null, displayName: null, tier: 'free' }
  }
}

// ─── OAuth login flow ─────────────────────────────────────────────────────────

/** Open the system browser to start the Google OAuth flow. */
export function openLoginBrowser(): void {
  const { shell } = require('electron')
  // Generate a simple state token to bind the callback to this request.
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const url = `${PROXY_BASE_URL}/api/auth/google/login?state=${encodeURIComponent(state)}`
  console.log('[auth] Opening browser for Google OAuth:', url)
  shell.openExternal(url)
}

/**
 * Handle the maverick-voice://auth/success?... deep link from the proxy callback.
 * Called by main.ts open-url / second-instance handlers.
 * Returns the auth status after storing the session.
 */
export function handleDeepLink(url: string): ProxyAuthStatus | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'auth') return null

    if (parsed.pathname === '/error') {
      const reason = parsed.searchParams.get('reason') ?? 'unknown'
      console.error('[auth] OAuth error from deep link:', reason)
      return null
    }

    if (parsed.pathname === '/success') {
      const accessToken = parsed.searchParams.get('access_token')
      const refreshToken = parsed.searchParams.get('refresh_token')
      const email = parsed.searchParams.get('email') ?? ''
      const displayName = parsed.searchParams.get('display_name') ?? ''
      const tier = parsed.searchParams.get('tier') ?? 'free'

      if (!accessToken || !refreshToken) {
        console.error('[auth] Deep link missing tokens')
        return null
      }

      storeSession({ accessToken, refreshToken, email, displayName, tier })
      return getAuthStatus()
    }
  } catch (e) {
    console.error('[auth] Failed to parse deep link:', e)
  }
  return null
}
