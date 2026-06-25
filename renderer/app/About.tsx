import { useState, useEffect } from 'react'
import type { UpdateStatus, DownloadLinks } from '../../shared/types'
import pkg from '../../package.json'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)

/** Version, OTA check, manual download link from R2 downloads.json. */
export default function About({ className = '' }: { className?: string }) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [downloadLinks, setDownloadLinks] = useState<DownloadLinks | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    api.getUpdateStatus().then(setUpdateStatus).catch(() => {})
    api.getDownloadLinks().then(setDownloadLinks).catch(() => {})

    const onStatus = (status: UpdateStatus) => setUpdateStatus(status)
    api.onUpdateStatus(onStatus)
    return () => api.removeAllListeners('update:status')
  }, [])

  async function handleCheck() {
    if (busy) return
    setBusy(true)
    try {
      const status = await window.electronAPI.checkForUpdates()
      setUpdateStatus(status)
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload() {
    if (busy) return
    setBusy(true)
    try {
      await window.electronAPI.downloadUpdate()
    } finally {
      setBusy(false)
    }
  }

  function handleInstall() {
    window.electronAPI.installUpdate()
  }

  const statusLine = (() => {
    switch (updateStatus.state) {
      case 'checking':
        return 'Checking for updates…'
      case 'available':
        return `Version ${updateStatus.version} is available`
      case 'not-available':
        return 'You are on the latest version'
      case 'downloading':
        return `Downloading… ${Math.round(updateStatus.percent)}%`
      case 'ready':
        return `Version ${updateStatus.version} is ready to install`
      case 'error':
        return updateStatus.message
      default:
        return null
    }
  })()

  const platformDownload = downloadLinks && (IS_MAC ? downloadLinks.mac : downloadLinks.win)

  return (
    <div className={className}>
      <div className="mv-section-label mb-2.5">
        <span className="text-mv-text-muted">
          <InfoIcon />
        </span>
        About
      </div>
      <div className="mv-glass-card overflow-hidden mb-3">
        <div className="px-5 py-4 border-b border-mv-border flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-semibold text-mv-text-primary">Maverick Voice</p>
            <p className="text-[11px] text-mv-text-muted font-mono mt-0.5">v{pkg.version}</p>
          </div>
          {downloadLinks && downloadLinks.version !== pkg.version && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-mv-text-muted shrink-0">
              Latest: v{downloadLinks.version}
            </span>
          )}
        </div>

        <div className="px-5 py-4 flex flex-wrap items-center gap-2 border-b border-mv-border">
          {updateStatus.state === 'ready' ? (
            <button onClick={handleInstall} className="btn-glass btn-glass--primary !px-4 !py-2 !text-[12px]">
              Restart to update
            </button>
          ) : updateStatus.state === 'available' ? (
            <button
              onClick={handleDownload}
              disabled={busy}
              className="btn-glass btn-glass--primary !px-4 !py-2 !text-[12px]"
            >
              Download update
            </button>
          ) : (
            <button onClick={handleCheck} disabled={busy} className="btn-glass !px-4 !py-2 !text-[12px]">
              {busy ? 'Checking…' : 'Check for updates'}
            </button>
          )}
          {platformDownload && (
            <button
              onClick={() => window.electronAPI.openExternal(platformDownload)}
              className="btn-glass !px-4 !py-2 !text-[12px]"
            >
              Download latest
            </button>
          )}
        </div>

        {statusLine && (
          <p className="px-5 py-3 text-[11px] text-mv-text-secondary leading-relaxed">{statusLine}</p>
        )}
      </div>
    </div>
  )
}

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="7" x2="8" y2="11" />
      <line x1="8" y1="5" x2="8.01" y2="5" />
    </svg>
  )
}
