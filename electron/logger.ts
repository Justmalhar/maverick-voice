// ─── electron/logger.ts — daily-rotating file logger ───
// Writes every main-process console.log/warn/error line to
// ~/.maverick-voice/logs/yyyy-mm-dd.log (local date). Files rotate at
// midnight (checked lazily on each write) and anything older than 30 days is
// deleted. The console hook means the 150+ existing `[module]` log sites all
// land in the file with zero changes — and the existing privacy rules hold
// (no transcript text or key material is ever passed to console).
//
// Failure policy: logging must NEVER crash or block the app. Any fs error
// disables the file sink and the app continues with console-only logging.

import { ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../shared/ipc'

const LOG_DIR = path.join(os.homedir(), '.maverick-voice', 'logs')
const RETENTION_DAYS = 30
const LEVELS = ['log', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]

let stream: fs.WriteStream | null = null
let currentDate = ''

/** Local (not UTC) yyyy-mm-dd — log days match the user's wall clock. */
function localDate(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function openStream(): void {
  currentDate = localDate()
  stream = fs.createWriteStream(path.join(LOG_DIR, `${currentDate}.log`), { flags: 'a' })
  stream.on('error', () => {
    stream = null // disk trouble — degrade to console-only, never crash
  })
}

/** Delete yyyy-mm-dd.log files older than RETENTION_DAYS. Fire-and-forget. */
function cleanupOldLogs(): void {
  fs.promises
    .readdir(LOG_DIR)
    .then((files) => {
      const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
      for (const file of files) {
        const m = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(file)
        if (!m) continue
        if (new Date(`${m[1]}T00:00:00`).getTime() < cutoff) {
          fs.promises.unlink(path.join(LOG_DIR, file)).catch(() => {})
        }
      }
    })
    .catch(() => {})
}

function serialize(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function write(level: string, args: unknown[]): void {
  if (!stream) return
  if (localDate() !== currentDate) {
    stream.end()
    openStream()
    cleanupOldLogs()
  }
  stream?.write(`${new Date().toISOString()} [${level}] ${args.map(serialize).join(' ')}\n`)
}

/**
 * Start the file sink: hook console methods, capture crashes, register the
 * renderer log IPC. Call ONCE, as early as possible in main.ts.
 */
export function initLogger(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    openStream()
  } catch {
    return // no log dir — console-only
  }
  cleanupOldLogs()

  for (const level of LEVELS) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try {
        write(level, args)
      } catch {
        /* never let logging throw into app code */
      }
    }
  }

  // Monitor variants observe without changing crash/warning semantics.
  process.on('uncaughtExceptionMonitor', (err) => write('fatal', [err]))
  process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandled rejection:', reason instanceof Error ? reason : String(reason))
  })

  // Renderer-side errors arrive over IPC (preload writeLog).
  ipcMain.on(IPC.LOG_WRITE, (_e, level: unknown, message: unknown) => {
    const lvl: Level = LEVELS.includes(level as Level) ? (level as Level) : 'log'
    if (typeof message === 'string') console[lvl](`[renderer] ${message.slice(0, 2000)}`)
  })
}

/** Flush + close the sink (before-quit). */
export function closeLogger(): void {
  stream?.end()
  stream = null
}
