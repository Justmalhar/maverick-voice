import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../shared/types'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

// In-memory fs backing store shared by the mocked fs/promises module.
let files: Record<string, string> = {}
let readFileImpl: ((p: string) => Promise<string>) | null = null
let writeFileImpl: ((p: string, data: string) => Promise<void>) | null = null

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (p: string) => (readFileImpl ? readFileImpl(p) : defaultReadFile(p)),
    writeFile: (p: string, data: string) => (writeFileImpl ? writeFileImpl(p, data) : defaultWriteFile(p, data)),
    rename: (from: string, to: string) => defaultRename(from, to)
  }
}))

function enoent(): NodeJS.ErrnoException {
  const e = new Error('ENOENT') as NodeJS.ErrnoException
  e.code = 'ENOENT'
  return e
}

async function defaultReadFile(p: string): Promise<string> {
  if (p in files) return files[p]
  throw enoent()
}
async function defaultWriteFile(p: string, data: string): Promise<void> {
  files[p] = data
}
async function defaultRename(from: string, to: string): Promise<void> {
  files[to] = files[from]
  delete files[from]
}

const FILE = '/mock/userData/sessions.json'

function makeSession(over: Partial<Session> = {}): Session {
  return { id: 's1', createdAt: Date.now(), flowType: 'dictation', status: 'done', ...over }
}

describe('store/sessions', () => {
  beforeEach(() => {
    files = {}
    readFileImpl = null
    writeFileImpl = null
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function fresh() {
    vi.resetModules()
    return import('./sessions')
  }

  it('warmSessions on ENOENT starts with an empty cache', async () => {
    const mod = await fresh()
    await mod.warmSessions()
    expect(await mod.getSessions()).toEqual([])
  })

  it('warmSessions loads existing sessions.json', async () => {
    files[FILE] = JSON.stringify([makeSession({ id: 'a', createdAt: 1 })])
    const mod = await fresh()
    await mod.warmSessions()
    expect(await mod.getSessions()).toHaveLength(1)
  })

  it('treats a malformed (non-array) sessions.json as empty', async () => {
    files[FILE] = JSON.stringify({ not: 'an array' })
    const mod = await fresh()
    expect(await mod.getSessions()).toEqual([])
  })

  it('logs a warning and starts empty on a non-ENOENT read error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    readFileImpl = async () => {
      throw new Error('disk exploded')
    }
    const mod = await fresh()
    expect(await mod.getSessions()).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load'), 'disk exploded')
  })

  it('concurrent load() calls share one in-flight promise', async () => {
    const mod = await fresh()
    const [a, b] = await Promise.all([mod.getSessions(), mod.getSessions()])
    expect(a).toEqual(b)
  })

  it('saveSession unshifts a new session and flushes after the debounce', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'new', createdAt: 100 }))
    expect(files[FILE]).toBeUndefined()
    await vi.advanceTimersByTimeAsync(500)
    expect(JSON.parse(files[FILE])).toHaveLength(1)
  })

  it('saveSession updates an existing session in place', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'x', output: 'first' }))
    await mod.saveSession(makeSession({ id: 'x', output: 'second' }))
    const list = await mod.getSessions()
    expect(list).toHaveLength(1)
    expect(list[0].output).toBe('second')
  })

  it('getSession finds by id, or returns null', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'find-me' }))
    expect((await mod.getSession('find-me'))?.id).toBe('find-me')
    expect(await mod.getSession('missing')).toBeNull()
  })

  it('getSessions sorts newest first and respects the limit', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'old', createdAt: 1 }))
    await mod.saveSession(makeSession({ id: 'new', createdAt: 2 }))
    const list = await mod.getSessions(1)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('new')
  })

  it('updateSessionResult merges only defined fields, preserving prior transcript on a failed retry', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'u', output: 'kept', errorMessage: undefined }))
    await mod.updateSessionResult('u', { status: 'error', errorMessage: 'boom', output: undefined })
    const session = await mod.getSession('u')
    expect(session?.output).toBe('kept')
    expect(session?.status).toBe('error')
    expect(session?.errorMessage).toBe('boom')
  })

  it('updateSessionResult on an unknown id warns and does nothing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await fresh()
    await mod.updateSessionResult('ghost', { status: 'done' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown session'), 'ghost')
  })

  it('deleteSession removes a matching session and flushes', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'gone' }))
    await mod.deleteSession('gone')
    expect(await mod.getSessions()).toEqual([])
  })

  it('deleteSession on a non-existent id is a no-op', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'stays' }))
    await mod.deleteSession('nope')
    expect(await mod.getSessions()).toHaveLength(1)
  })

  it('clearAllSessions empties the cache', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'a' }))
    await mod.clearAllSessions()
    expect(await mod.getSessions()).toEqual([])
  })

  it('flushSessions clears any pending prune timer and writes immediately', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'flush-me' }))
    await mod.flushSessions()
    expect(JSON.parse(files[FILE])).toHaveLength(1)
  })

  it('flushSessions with nothing dirty is a cheap no-op', async () => {
    const mod = await fresh()
    await mod.warmSessions()
    await mod.flushSessions()
    expect(files[FILE]).toBeUndefined()
  })

  it('a pending flush timer is cleared when flushNow runs early via flushSessions', async () => {
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'early' }))
    // flush before the 500ms debounce elapses
    await mod.flushSessions()
    expect(JSON.parse(files[FILE])).toHaveLength(1)
    // advancing the (already-cleared) timer must not double-write or throw
    await vi.advanceTimersByTimeAsync(500)
  })

  it('a failed atomic write keeps dirty=true and logs an error, retried on the next flush', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'boom' }))
    writeFileImpl = async () => {
      throw new Error('disk full')
    }
    await mod.flushSessions()
    expect(files[FILE]).toBeUndefined()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('flush failed'), 'disk full')

    writeFileImpl = null
    await mod.flushSessions()
    expect(JSON.parse(files[FILE])).toHaveLength(1)
  })

  it('a non-Error thrown during flush is stringified as-is', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'weird-throw' }))
    writeFileImpl = async () => {
      throw 'a plain string failure'
    }
    await mod.flushSessions()
    expect(errSpy).toHaveBeenCalledWith('[sessions] flush failed:', 'a plain string failure')
  })

  it('prune removes sessions older than 24h once the idle timer fires', async () => {
    const now = Date.now()
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'old', createdAt: now - 25 * 60 * 60 * 1000 }))
    await mod.saveSession(makeSession({ id: 'fresh', createdAt: now }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await vi.advanceTimersByTimeAsync(2_000)
    const list = await mod.getSessions()
    expect(list.map((s) => s.id)).toEqual(['fresh'])
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('pruned'))
    await vi.advanceTimersByTimeAsync(500) // let the reschedule flush settle
  })

  it('prune caps at MAX_SESSIONS (100), keeping the newest', async () => {
    const now = Date.now()
    const mod = await fresh()
    for (let i = 0; i < 105; i++) {
      await mod.saveSession(makeSession({ id: `s${i}`, createdAt: now - i }))
    }
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(500)
    const list = await mod.getSessions(200)
    expect(list.length).toBeLessThanOrEqual(100)
  })

  it('prune failing (e.g. corrupted cache entry) is caught and logged, never thrown', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    await mod.saveSession(null as unknown as Session) // corrupted entry: cache.filter will throw on it
    await vi.advanceTimersByTimeAsync(2_000)
    expect(errSpy).toHaveBeenCalledWith('[sessions] prune failed:', expect.any(String))
  })

  it('prune is a no-op (and logs nothing) when nothing is old or over the cap', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const mod = await fresh()
    await mod.saveSession(makeSession({ id: 'fresh' }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('pruned'))
  })
})
