// ════════════════════════════════════════════════════════════════════════
// keys/listenerDarwin.ts — mac-helper process management (darwin only).
//
// Owns: spawn/restart of resources/bin/mac-helper, the ONE shared stdout
// line-buffer (partial-line carry — v1 bug #9 split chunks per-listener),
// and stdin command correlation by expected reply prefix (one in flight per
// prefix). Raw protocol tokens (FN_*, CAPS_*, RIGHT_OPTION_*, MODS:) are
// forwarded to the KeyListener core untranslated.
// ════════════════════════════════════════════════════════════════════════

import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { TIMEOUTS } from '../config'

export type HelperCommand = 'PASTE' | 'COPY' | 'FRONTAPP' | 'HEALTH'

/** Expected reply per command. Trailing ':' ⇒ prefix match, else exact. */
const REPLY: Record<HelperCommand, string> = {
  PASTE: 'PASTE_OK',
  COPY: 'COPY_OK',
  FRONTAPP: 'FRONTAPP:',
  HEALTH: 'HEALTH:'
}

const BACKOFF_BASE_MS = 2_000
const BACKOFF_CAP_MS = 30_000

interface Pending {
  promise: Promise<string>
  resolve: (line: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export interface DarwinCallbacks {
  /** One full, trimmed, non-empty protocol line that was NOT a command reply. */
  onToken(token: string): void
  /** Helper process liveness transitions (spawned / died). */
  onAlive(alive: boolean): void
}

export class DarwinHelper {
  private proc: ChildProcess | null = null
  private stopping = false
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private lineBuffer = ''
  private pending = new Map<HelperCommand, Pending>()

  constructor(private readonly cb: DarwinCallbacks) {}

  /** Explicit start clears the backoff latch (v1's one-way `restarting` latch
   *  permanently disabled crash recovery after any stop/start — bug #9). */
  start(): boolean {
    this.stopping = false
    this.restartAttempts = 0
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    return this.spawnHelper()
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.rejectAllPending(new Error('mac-helper stopped'))
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }

  isRunning(): boolean {
    return !!(this.proc && !this.proc.killed && this.proc.stdin)
  }

  /**
   * Send a stdin command and resolve with the full reply line. Correlated by
   * expected reply prefix; a second call while one is in flight for the same
   * prefix shares the pending promise (no cross-talk — v1 bug #9). Guarded by
   * TIMEOUTS.helperCommand.
   */
  command(cmd: HelperCommand): Promise<string> {
    const inFlight = this.pending.get(cmd)
    if (inFlight) return inFlight.promise

    if (!this.proc || !this.proc.stdin || this.proc.killed) {
      return Promise.reject(new Error('mac-helper not running'))
    }

    let resolve!: (line: string) => void
    let reject!: (err: Error) => void
    const promise = new Promise<string>((res, rej) => {
      resolve = res
      reject = rej
    })
    const timer = setTimeout(() => {
      this.pending.delete(cmd)
      reject(new Error(`${cmd} timed out after ${TIMEOUTS.helperCommand}ms`))
    }, TIMEOUTS.helperCommand)
    this.pending.set(cmd, { promise, resolve, reject, timer })

    this.proc.stdin.write(cmd + '\n', (err) => {
      if (err) this.settle(cmd, undefined, err)
    })
    return promise
  }

  // ── internals ────────────────────────────────────────────────────────────

  private binaryPath(): string | null {
    const candidates = [
      // Packaged: .app/Contents/Resources/bin
      path.join(process.resourcesPath || '', 'bin', 'mac-helper'),
      // Dev: project root
      path.join(app.getAppPath(), 'resources', 'bin', 'mac-helper'),
      path.join(__dirname, '..', '..', 'resources', 'bin', 'mac-helper')
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }

  private spawnHelper(): boolean {
    const bin = this.binaryPath()
    if (!bin) {
      console.error('[keys] mac-helper binary not found. Run: npm run compile:native')
      return false
    }
    try {
      fs.chmodSync(bin, 0o755)
    } catch {
      // Read-only inside a signed .app bundle — already executable there.
    }

    console.log('[keys] Starting mac-helper:', bin)
    const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    this.lineBuffer = ''

    proc.stdout?.on('data', (data: Buffer) => {
      // ONE shared line-buffer: keep the last incomplete line for the next chunk.
      this.lineBuffer += data.toString()
      const lines = this.lineBuffer.split('\n')
      this.lineBuffer = lines.pop() || ''
      for (const line of lines) {
        const token = line.trim()
        if (token) this.handleLine(token)
      }
    })
    proc.stderr?.on('data', (data: Buffer) => {
      console.error('[keys] mac-helper stderr:', data.toString().trim())
    })
    // EPIPE happens when the process dies mid-write — swallow.
    proc.stdout?.on('error', swallowEpipe)
    proc.stderr?.on('error', swallowEpipe)
    proc.stdin?.on('error', swallowEpipe)

    proc.on('error', (err) => {
      console.error('[keys] mac-helper process error:', err.message)
      this.handleDeath(proc)
    })
    proc.on('exit', (code) => {
      console.log('[keys] mac-helper exited with code:', code)
      this.handleDeath(proc)
    })

    this.cb.onAlive(true)
    return true
  }

  /** Idempotent per process — 'error' and 'exit' can both fire. */
  private handleDeath(proc: ChildProcess): void {
    if (this.proc !== proc) return
    this.proc = null
    this.rejectAllPending(new Error('mac-helper exited'))
    this.cb.onAlive(false)
    if (this.stopping) return

    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.restartAttempts, BACKOFF_CAP_MS)
    this.restartAttempts++
    console.log(`[keys] mac-helper restart in ${delay}ms (attempt ${this.restartAttempts})`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopping) this.spawnHelper()
    }, delay)
  }

  private handleLine(token: string): void {
    for (const [cmd, expected] of Object.entries(REPLY) as [HelperCommand, string][]) {
      const matches = expected.endsWith(':') ? token.startsWith(expected) : token === expected
      if (matches) {
        this.settle(cmd, token)
        return // reply lines never double as key events
      }
    }
    this.cb.onToken(token)
  }

  private settle(cmd: HelperCommand, line?: string, err?: Error): void {
    const p = this.pending.get(cmd)
    if (!p) return
    this.pending.delete(cmd)
    clearTimeout(p.timer)
    if (line !== undefined) p.resolve(line)
    else p.reject(err ?? new Error(`${cmd} failed`))
  }

  private rejectAllPending(err: Error): void {
    for (const [cmd, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(`${cmd}: ${err.message}`))
    }
    this.pending.clear()
  }
}

function swallowEpipe(err: NodeJS.ErrnoException): void {
  if (err.code === 'EPIPE') return
  console.error('[keys] mac-helper pipe error:', err.message)
}
