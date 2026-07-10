// ─── electron/ipc/providerKeys.ts — provider key/model IPC registrar ───
// 'openai' and 'groq' exist in BOTH registries with one shared key; key
// validation routes STT-only ids (deepgram, local) to the STT provider and
// everything else through the LLM provider (same /models endpoint + key).

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  ProviderId,
  ProviderKeyStatus,
  ProviderKind,
  ProviderModel,
  SetProviderKeyResult,
  STTProviderId,
  TestProviderKeyResult
} from '../../shared/types'
import type { KeyTestResult } from '../providers/types'
import { getLLMProvider, getTranscriptionProvider } from '../providers/registry'
import { clearApiKey, getApiKey, getMaskedKey, hasApiKey, setApiKey } from '../store/keys'
import { getSetting } from '../store/settings'

function isSttOnly(id: ProviderId): id is STTProviderId {
  return id === 'deepgram' || id === 'local'
}

/** The Custom provider validates against the user-supplied base URL. */
function customBaseUrl(): string | undefined {
  return getSetting('llmSettings').baseUrl.trim() || undefined
}

async function testKeyForProvider(provider: ProviderId, key: string): Promise<KeyTestResult> {
  if (isSttOnly(provider)) return getTranscriptionProvider(provider).testKey(key)
  return getLLMProvider(provider).testKey(key, provider === 'custom' ? customBaseUrl() : undefined)
}

export function registerProviderKeysIpc(): void {
  ipcMain.handle(IPC.KEY_STATUS, (_e, provider: ProviderId): ProviderKeyStatus => ({
    provider,
    hasKey: hasApiKey(provider),
    maskedKey: getMaskedKey(provider)
  }))

  ipcMain.handle(IPC.KEY_SET, async (_e, provider: ProviderId, key: string): Promise<SetProviderKeyResult> => {
    try {
      // Custom with no base URL yet: store unvalidated instead of forcing the
      // user to fill the fields in a fixed order.
      if (provider === 'custom' && !customBaseUrl()) {
        setApiKey(provider, key)
        return { ok: true }
      }
      const test = await testKeyForProvider(provider, key)
      if (!test.ok) return { ok: false, error: test.error }
      setApiKey(provider, key)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to save key' }
    }
  })

  ipcMain.handle(IPC.KEY_TEST, async (_e, provider: ProviderId, key: string): Promise<TestProviderKeyResult> => {
    try {
      // Saved-key state: the renderer's input is empty — test the stored
      // (or dev .env-seeded) key instead of erroring on the blank input.
      const effectiveKey = key?.trim() || getApiKey(provider) || ''
      if (!effectiveKey) return { ok: false, error: 'No key entered or saved yet' }
      return await testKeyForProvider(provider, effectiveKey)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Key test failed' }
    }
  })

  ipcMain.on(IPC.KEY_CLEAR, (_e, provider: ProviderId) => clearApiKey(provider))

  ipcMain.handle(IPC.LIST_MODELS, async (_e, provider: ProviderId, kind: ProviderKind): Promise<ProviderModel[]> => {
    try {
      if (kind === 'stt') return getTranscriptionProvider(provider as STTProviderId).models
      // LLM: live catalog from the provider's /models endpoint (static
      // fallback inside listModels when no key / request fails).
      const llm = getLLMProvider(provider as Exclude<ProviderId, 'deepgram' | 'local'>)
      return await llm.listModels(getApiKey(provider) ?? '', provider === 'custom' ? customBaseUrl() : undefined)
    } catch {
      return []
    }
  })
}
