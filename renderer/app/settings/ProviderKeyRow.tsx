import { useState, useEffect } from 'react'
import type { ProviderId } from '../../../shared/types'
import { KEY_TEST } from '../../../shared/copy'
import { ProviderGlyph } from './settingsUi'

export default function ProviderKeyRow({
  provider,
  label,
  sublabel,
  tag,
  placeholder,
  consoleUrl,
}: {
  provider: ProviderId
  label: string
  sublabel?: string
  tag?: string
  placeholder: string
  consoleUrl: string
  last?: boolean
}) {
  const [masked, setMasked] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  useEffect(() => {
    window.electronAPI
      .getProviderKeyStatus(provider)
      .then((s) => setMasked(s.hasKey ? s.masked : null))
      .catch(() => {})
  }, [provider])

  async function handleSave() {
    const key = input.trim()
    if (!key || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const test = await window.electronAPI.testProviderKey(provider, key)
      if (!test.ok) {
        setMsg({ text: test.error || 'Invalid key', type: 'err' })
        return
      }
      const res = await window.electronAPI.setProviderKey(provider, key)
      if (res.success) {
        setMasked(res.masked ?? null)
        setInput('')
        setEditing(false)
        setMsg({ text: 'Key saved securely.', type: 'ok' })
      } else {
        setMsg({ text: res.error || 'Failed to save key', type: 'err' })
      }
    } catch {
      setMsg({ text: 'Something went wrong', type: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    const key = input.trim() || ''
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await window.electronAPI.testProviderKey(provider, key)
      setMsg(res.ok ? { text: 'Key is valid.', type: 'ok' } : { text: res.error || KEY_TEST.SERVICE_ERROR, type: 'err' })
    } catch {
      setMsg({ text: KEY_TEST.NETWORK_ERROR, type: 'err' })
    } finally {
      setBusy(false)
    }
  }

  function handleClear() {
    window.electronAPI.clearProviderKey(provider)
    setMasked(null)
    setInput('')
    setEditing(false)
    setMsg(null)
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex items-center justify-center w-8 h-8 rounded-mv-md bg-mv-white-04 border border-mv-border text-mv-text-primary shrink-0 [&_svg]:grayscale">
            <ProviderGlyph provider={provider} />
            <span className={`absolute -top-0.5 -right-0.5 mv-status-dot ${masked ? 'mv-status-dot--on' : 'mv-status-dot--off'}`} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-mv-text-primary">{label}</span>
              {tag && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-mv-text-muted bg-mv-white-04 border border-mv-border rounded-mv-sm px-1.5 py-0.5 shrink-0">
                  {tag}
                </span>
              )}
            </div>
            <p className="text-[11px] text-mv-text-muted font-mono truncate mt-0.5">{masked || sublabel || 'Not set'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!editing && (
            <button
              onClick={() => {
                setEditing(true)
                setMsg(null)
              }}
              className="btn-glass !px-3 !py-1.5 !text-[11px] whitespace-nowrap"
            >
              {masked ? 'Replace' : 'Set'}
            </button>
          )}
          {!editing && masked && (
            <>
              <button onClick={handleTest} disabled={busy} className="btn-glass !px-3 !py-1.5 !text-[11px] whitespace-nowrap">
                Test
              </button>
              <button
                onClick={handleClear}
                className="text-[11px] font-medium text-mv-text-secondary hover:text-mv-text-primary transition-colors px-2 py-1"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setMsg(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') {
                setEditing(false)
                setInput('')
                setMsg(null)
              }
            }}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            className="mv-input flex-1"
          />
          <button onClick={handleTest} disabled={busy} className="btn-glass !px-3.5 !py-2.5 !text-[12px] whitespace-nowrap">
            Test
          </button>
          <button onClick={handleSave} disabled={!input.trim() || busy} className="btn-glass btn-glass--primary !px-4 !py-2.5 !text-[12px] whitespace-nowrap">
            {busy ? 'Checking…' : 'Save'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mt-2.5 gap-3">
        <button
          onClick={() => window.electronAPI.openExternal(consoleUrl)}
          className="text-[11px] text-mv-text-muted hover:text-mv-text-primary transition-colors underline underline-offset-2"
        >
          Get an API key →
        </button>
        {msg && (
          <span className={`text-[11px] font-medium ${msg.type === 'ok' ? 'text-mv-text-primary' : 'text-mv-text-secondary'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}
