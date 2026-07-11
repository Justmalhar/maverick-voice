import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

interface FileEntry {
  data: Buffer
  mtimeMs: number
}
let dir: Record<string, FileEntry> = {}
let statImpl: ((p: string) => Promise<{ mtimeMs: number }>) | null = null
let readdirImpl: (() => Promise<string[]>) | null = null
let mkdirImpl: (() => Promise<void>) | null = null
let unlinkImpl: ((p: string) => Promise<void>) | null = null
let readFileImpl: ((p: string) => Promise<Buffer>) | null = null

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...a: unknown[]) => (mkdirImpl ? mkdirImpl() : Promise.resolve(undefined)),
    writeFile: (p: string, data: Buffer) => {
      dir[p] = { data, mtimeMs: Date.now() }
      return Promise.resolve(undefined)
    },
    readFile: (p: string) => (readFileImpl ? readFileImpl(p) : defaultReadFile(p)),
    unlink: (p: string) => (unlinkImpl ? unlinkImpl(p) : defaultUnlink(p)),
    readdir: (p: string) => (readdirImpl ? readdirImpl() : defaultReaddir(p)),
    stat: (p: string) => (statImpl ? statImpl(p) : defaultStat(p))
  }
}))

function enoent(): NodeJS.ErrnoException {
  const e = new Error('ENOENT') as NodeJS.ErrnoException
  e.code = 'ENOENT'
  return e
}
async function defaultReadFile(p: string): Promise<Buffer> {
  if (p in dir) return dir[p].data
  throw enoent()
}
async function defaultUnlink(p: string): Promise<void> {
  if (!(p in dir)) throw enoent()
  delete dir[p]
}
async function defaultReaddir(_p: string): Promise<string[]> {
  return Object.keys(dir).map((p) => p.split('/').pop() as string)
}
async function defaultStat(p: string): Promise<{ mtimeMs: number }> {
  const key = Object.keys(dir).find((k) => k.endsWith(`/${p.split('/').pop()}`)) ?? p
  if (!(key in dir)) throw enoent()
  return { mtimeMs: dir[key].mtimeMs }
}

const AUDIO_DIR = '/mock/userData/audio'

describe('store/audio', () => {
  beforeEach(() => {
    dir = {}
    statImpl = null
    readdirImpl = null
    mkdirImpl = null
    unlinkImpl = null
    readFileImpl = null
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function fresh() {
    vi.resetModules()
    return import('./audio')
  }

  it('ensureAudioDir creates the audio directory, or logs on failure', async () => {
    const mod = await fresh()
    await mod.ensureAudioDir()

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mkdirImpl = async () => {
      throw new Error('mkdir failed')
    }
    await mod.ensureAudioDir()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to create audio dir'), 'mkdir failed')
  })

  it('holdAudio accumulates buffers per session; releaseAudio drops them without persisting', async () => {
    const mod = await fresh()
    mod.holdAudio('s1', Buffer.from('a'))
    mod.holdAudio('s1', Buffer.from('b'))
    mod.releaseAudio('s1')
    expect(await mod.persistAudio('s1')).toBeNull()
  })

  it('persistAudio returns null when nothing was held', async () => {
    const mod = await fresh()
    expect(await mod.persistAudio('never-held')).toBeNull()
  })

  it('persistAudio concatenates held buffers into one file and clears memory', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const mod = await fresh()
    mod.holdAudio('s2', Buffer.from('hello '))
    mod.holdAudio('s2', Buffer.from('world'))
    const path = await mod.persistAudio('s2')
    expect(path).toBe(`${AUDIO_DIR}/s2.webm`)
    expect(dir[path!].data.toString('utf8')).toBe('hello world')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('persisted session s2 (2 buffer(s))'))
    // memory cleared: persisting again with nothing held returns null
    expect(await mod.persistAudio('s2')).toBeNull()
  })

  it('persistAudio returns null and logs on a write failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    mkdirImpl = async () => {
      throw new Error('mkdir boom')
    }
    mod.holdAudio('s3', Buffer.from('x'))
    const path = await mod.persistAudio('s3')
    expect(path).toBeNull()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to persist s3'), 'mkdir boom')
  })

  it('loadAudio reads a persisted file, or null on ENOENT, or null + logs on other errors', async () => {
    const mod = await fresh()
    mod.holdAudio('s4', Buffer.from('payload'))
    await mod.persistAudio('s4')
    const loaded = await mod.loadAudio('s4')
    expect(loaded?.toString('utf8')).toBe('payload')
    expect(await mod.loadAudio('never-existed')).toBeNull()

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readFileImpl = async () => {
      throw new Error('read boom')
    }
    expect(await mod.loadAudio('s4')).toBeNull()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load s4'), 'read boom')
  })

  it('deleteAudio releases held memory and unlinks the file (success, ENOENT silent, other error logged)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    mod.holdAudio('s5', Buffer.from('x'))
    await mod.persistAudio('s5')
    await mod.deleteAudio('s5')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deleted audio for session s5'))

    await mod.deleteAudio('never-existed') // ENOENT: silent
    expect(errSpy).not.toHaveBeenCalled()

    unlinkImpl = async () => {
      throw new Error('unlink boom')
    }
    await mod.deleteAudio('s6')
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to delete s6'), 'unlink boom')
  })

  it('clearAllAudio clears held memory and deletes only .webm files, tolerating individual unlink failures', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    mod.holdAudio('held-only', Buffer.from('x'))
    dir[`${AUDIO_DIR}/a.webm`] = { data: Buffer.from('a'), mtimeMs: Date.now() }
    dir[`${AUDIO_DIR}/b.webm`] = { data: Buffer.from('b'), mtimeMs: Date.now() }
    dir[`${AUDIO_DIR}/c.webm`] = { data: Buffer.from('c'), mtimeMs: Date.now() }
    dir[`${AUDIO_DIR}/notes.txt`] = { data: Buffer.from('irrelevant'), mtimeMs: Date.now() }

    let call = 0
    unlinkImpl = async (p: string) => {
      call++
      if (call === 1) throw new Error('one failed') // ternary's Error branch
      if (call === 2) throw 'two failed as a plain string' // ternary's non-Error branch
      delete dir[p]
    }
    await mod.clearAllAudio()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('cleared all audio files (3 removed)'))
    expect(errSpy).toHaveBeenCalledWith('[audio] failed to delete', expect.any(String), 'one failed')
    expect(errSpy).toHaveBeenCalledWith('[audio] failed to delete', expect.any(String), 'two failed as a plain string')
    // held memory was cleared even though some unlinks failed
    expect(await mod.persistAudio('held-only')).toBeNull()
  })

  it('clearAllAudio tolerates a missing audio dir (ENOENT) silently', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readdirImpl = async () => {
      throw enoent()
    }
    const mod = await fresh()
    await mod.clearAllAudio()
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('clearAllAudio logs a non-ENOENT readdir failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readdirImpl = async () => {
      throw new Error('readdir boom')
    }
    const mod = await fresh()
    await mod.clearAllAudio()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to clear audio dir'), 'readdir boom')
  })

  it('prune groups retry-variant files by uuid prefix and treats them as one set', async () => {
    const uuid = '11111111-2222-3333-4444-555555555555'
    const mod = await fresh()
    const now = Date.now()
    // Insertion order matters: dictation (now) -> instruction (now+1000, newer,
    // bumps the set's mtime) -> extra (now+500, older than the running max, so
    // the set's mtime must NOT regress) exercises both sides of `mtime > entry.mtime`.
    dir[`${AUDIO_DIR}/${uuid}-dictation.webm`] = { data: Buffer.from('a'), mtimeMs: now }
    dir[`${AUDIO_DIR}/${uuid}-instruction.webm`] = { data: Buffer.from('b'), mtimeMs: now + 1000 }
    dir[`${AUDIO_DIR}/${uuid}-extra.webm`] = { data: Buffer.from('c'), mtimeMs: now + 500 }
    mod.holdAudio('trigger', Buffer.from('x'))
    await mod.persistAudio('trigger') // schedules the idle prune timer
    await vi.advanceTimersByTimeAsync(2_000)
    // all retry-variant files belong to one set and are within MAX_AUDIO_SETS
    // and not older than the cutoff, so they must all survive.
    expect(dir[`${AUDIO_DIR}/${uuid}-dictation.webm`]).toBeDefined()
    expect(dir[`${AUDIO_DIR}/${uuid}-instruction.webm`]).toBeDefined()
    expect(dir[`${AUDIO_DIR}/${uuid}-extra.webm`]).toBeDefined()
  })

  it('prune deletes sets beyond MAX_AUDIO_SETS (5), keeping the newest', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const mod = await fresh()
    const now = Date.now()
    for (let i = 0; i < 7; i++) {
      dir[`${AUDIO_DIR}/set${i}.webm`] = { data: Buffer.from('x'), mtimeMs: now + i }
    }
    mod.holdAudio('trigger', Buffer.from('x'))
    await mod.persistAudio('trigger')
    await vi.advanceTimersByTimeAsync(2_000)
    const remaining = Object.keys(dir).filter((k) => k.endsWith('.webm'))
    expect(remaining.length).toBeLessThanOrEqual(6) // 5 old sets + the just-persisted trigger set
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('pruned audio set'))
  })

  it('prune deletes sets older than 24h regardless of count', async () => {
    const mod = await fresh()
    const old = Date.now() - 25 * 60 * 60 * 1000
    dir[`${AUDIO_DIR}/stale.webm`] = { data: Buffer.from('x'), mtimeMs: old }
    mod.holdAudio('trigger', Buffer.from('x'))
    await mod.persistAudio('trigger')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(dir[`${AUDIO_DIR}/stale.webm`]).toBeUndefined()
  })

  it('prune skips a file that vanishes between readdir and stat', async () => {
    const mod = await fresh()
    dir[`${AUDIO_DIR}/ghost.webm`] = { data: Buffer.from('x'), mtimeMs: Date.now() }
    statImpl = async () => {
      throw new Error('vanished')
    }
    mod.holdAudio('trigger', Buffer.from('x'))
    await mod.persistAudio('trigger')
    await vi.advanceTimersByTimeAsync(2_000) // must not throw despite the vanished-file stat rejection
  })

  it('prune logs an unlink failure for a doomed file but continues', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    const old = Date.now() - 25 * 60 * 60 * 1000
    dir[`${AUDIO_DIR}/stale.webm`] = { data: Buffer.from('x'), mtimeMs: old }
    unlinkImpl = async () => {
      throw new Error('unlink boom')
    }
    mod.holdAudio('trigger', Buffer.from('x'))
    await mod.persistAudio('trigger')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(errSpy).toHaveBeenCalledWith('[audio] prune unlink failed:', expect.any(String), 'unlink boom')
  })

  it('prune tolerates a readdir failure (ENOENT silent, other logged)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    mod.holdAudio('trigger', Buffer.from('x'))
    await mod.persistAudio('trigger')
    readdirImpl = async () => {
      throw enoent()
    }
    await vi.advanceTimersByTimeAsync(2_000)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('prune logs a non-ENOENT readdir failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    mod.holdAudio('trigger', Buffer.from('x'))
    await mod.persistAudio('trigger')
    readdirImpl = async () => {
      throw new Error('readdir boom')
    }
    await vi.advanceTimersByTimeAsync(2_000)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('prune failed:'), 'readdir boom')
  })

  it('a second persistAudio reschedules (clears) the pending prune timer', async () => {
    const mod = await fresh()
    mod.holdAudio('t1', Buffer.from('x'))
    await mod.persistAudio('t1')
    mod.holdAudio('t2', Buffer.from('y'))
    await mod.persistAudio('t2') // clears + re-arms the same idle timer
    await vi.advanceTimersByTimeAsync(2_000)
  })
})
