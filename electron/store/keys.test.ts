import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isEncryptionAvailable = vi.fn(() => true)
const encryptString = vi.fn((s: string) => Buffer.from(`enc:${s}`))
const decryptString = vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, ''))
let isPackaged = false

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    getAppPath: vi.fn(() => '/mock/app'),
    get isPackaged() {
      return isPackaged
    }
  },
  safeStorage: {
    isEncryptionAvailable: (...a: unknown[]) => isEncryptionAvailable(...(a as [])),
    encryptString: (...a: [string]) => encryptString(...a),
    decryptString: (...a: [Buffer]) => decryptString(...a)
  }
}))

let files: Record<string, string | Buffer> = {}
let readFileImpl: ((p: string) => Promise<string | Buffer>) | null = null

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (p: string) => (readFileImpl ? readFileImpl(p) : defaultReadFile(p)),
    writeFile: (p: string, data: string | Buffer) => defaultWriteFile(p, data),
    unlink: (p: string) => defaultUnlink(p)
  }
}))

function enoent(): NodeJS.ErrnoException {
  const e = new Error('ENOENT') as NodeJS.ErrnoException
  e.code = 'ENOENT'
  return e
}
async function defaultReadFile(p: string): Promise<string | Buffer> {
  if (p in files) return files[p]
  throw enoent()
}
async function defaultWriteFile(p: string, data: string | Buffer): Promise<void> {
  files[p] = data
}
async function defaultUnlink(p: string): Promise<void> {
  if (!(p in files)) throw enoent()
  delete files[p]
}

const ENV_KEYS = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPGRAM_API_KEY', 'CUSTOM_API_KEY', 'LOCAL_API_KEY']

describe('store/keys', () => {
  const origEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    files = {}
    readFileImpl = null
    isPackaged = false
    isEncryptionAvailable.mockReturnValue(true)
    for (const k of ENV_KEYS) {
      origEnv[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (origEnv[k] === undefined) delete process.env[k]
      else process.env[k] = origEnv[k]
    }
    vi.restoreAllMocks()
  })

  async function fresh() {
    vi.resetModules()
    return import('./keys')
  }

  it('loadKeys in dev mode reads .env (comments/blank lines/quoted values), env wins over .env', async () => {
    process.env.OPENAI_API_KEY = 'from-real-env'
    files['/mock/app/.env'] = [
      '# a comment',
      '',
      'GROQ_API_KEY="quoted-groq-key"',
      "DEEPGRAM_API_KEY='single-quoted'",
      'OPENAI_API_KEY=should-not-override-real-env',
      'malformed-line-no-equals',
      '=nokey'
    ].join('\n')
    const mod = await fresh()
    await mod.loadKeys()
    expect(process.env.GROQ_API_KEY).toBe('quoted-groq-key')
    expect(process.env.DEEPGRAM_API_KEY).toBe('single-quoted')
    expect(process.env.OPENAI_API_KEY).toBe('from-real-env')
  })

  it('loadKeys skips .env entirely when packaged', async () => {
    isPackaged = true
    files['/mock/app/.env'] = 'GROQ_API_KEY=should-be-ignored'
    const mod = await fresh()
    await mod.loadKeys()
    expect(process.env.GROQ_API_KEY).toBeUndefined()
  })

  it('a missing .env file is silently ignored', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await fresh()
    await mod.loadKeys()
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('.env'), expect.anything())
  })

  it('a non-ENOENT .env read error is warned', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const origRead = readFileImpl
    readFileImpl = async (p: string) => {
      if (p.endsWith('.env')) throw new Error('permission denied')
      return defaultReadFile(p)
    }
    const mod = await fresh()
    await mod.loadKeys()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to read .env'), 'permission denied')
    readFileImpl = origRead
  })

  it('loadOne decrypts a stored key when encryption is available', async () => {
    files['/mock/userData/groq-key.enc'] = Buffer.from('enc:my-groq-secret')
    const mod = await fresh()
    await mod.loadKeys()
    expect(mod.getApiKey('groq')).toBe('my-groq-secret')
    expect(mod.hasApiKey('groq')).toBe(true)
  })

  it('loadOne warns and leaves null when encryption is unavailable for a stored key', async () => {
    isEncryptionAvailable.mockReturnValue(false)
    files['/mock/userData/groq-key.enc'] = Buffer.from('enc:my-groq-secret')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await fresh()
    await mod.loadKeys()
    expect(mod.getApiKey('groq')).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OS encryption unavailable'))
  })

  it('loadOne logs a non-ENOENT read error for a key file', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readFileImpl = async (p: string) => {
      if (p.includes('openai-key.enc')) throw new Error('disk error')
      return defaultReadFile(p)
    }
    const mod = await fresh()
    await mod.loadKeys()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load openai key'), 'disk error')
  })

  it('loadOne is idempotent per provider (cache.has short-circuits)', async () => {
    files['/mock/userData/groq-key.enc'] = Buffer.from('enc:v1')
    const mod = await fresh()
    await mod.loadKeys()
    files['/mock/userData/groq-key.enc'] = Buffer.from('enc:v2')
    await mod.loadKeys() // second call must not re-read from disk
    expect(mod.getApiKey('groq')).toBe('v1')
  })

  it('getApiKey warns once (not repeatedly) when called before loadKeys()', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await fresh()
    mod.getApiKey('groq')
    mod.getApiKey('openai')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('getApiKey before loadKeys()'))
  })

  it('getApiKey falls back to the dev .env seed when no key is stored (unpackaged only)', async () => {
    process.env.GROQ_API_KEY = '  seeded-key  '
    const mod = await fresh()
    await mod.loadKeys()
    expect(mod.getApiKey('groq')).toBe('seeded-key')
  })

  it('getApiKey does not use the .env seed when packaged', async () => {
    isPackaged = true
    process.env.GROQ_API_KEY = 'seeded-key'
    const mod = await fresh()
    await mod.loadKeys()
    expect(mod.getApiKey('groq')).toBeNull()
  })

  it('getApiKey returns null with no stored key and no env seed (blank env var)', async () => {
    process.env.GROQ_API_KEY = '   '
    const mod = await fresh()
    await mod.loadKeys()
    expect(mod.getApiKey('groq')).toBeNull()
    expect(mod.hasApiKey('groq')).toBe(false)
  })

  it('setApiKey with a blank/whitespace key clears instead of storing', async () => {
    const mod = await fresh()
    await mod.loadKeys()
    mod.setApiKey('groq', '   ')
    expect(mod.getApiKey('groq')).toBeNull()
  })

  it('setApiKey with an empty string key also clears', async () => {
    const mod = await fresh()
    await mod.loadKeys()
    mod.setApiKey('groq', '')
    expect(mod.getApiKey('groq')).toBeNull()
  })

  it('setApiKey throws when OS encryption is unavailable', async () => {
    isEncryptionAvailable.mockReturnValue(false)
    const mod = await fresh()
    await mod.loadKeys()
    expect(() => mod.setApiKey('groq', 'a-real-key')).toThrow('OS encryption is unavailable')
  })

  it('setApiKey primes the cache synchronously and persists asynchronously (success + failure)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    await mod.loadKeys()
    mod.setApiKey('groq', 'fresh-key')
    expect(mod.getApiKey('groq')).toBe('fresh-key') // synchronous
    await Promise.resolve()
    await Promise.resolve()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('groq API key saved'))

    // Now make the persist write fail for a second key.
    const origWrite = files
    void origWrite
    const writeSpy = vi.spyOn(await import('node:fs/promises').then((m) => m.default), 'writeFile')
    writeSpy.mockRejectedValueOnce(new Error('write failed'))
    mod.setApiKey('openai', 'another-key')
    await Promise.resolve()
    await Promise.resolve()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to persist openai key'), 'write failed')

    // A non-Error rejection is stringified as-is (ternary false branch).
    writeSpy.mockRejectedValueOnce('plain string failure')
    mod.setApiKey('openrouter', 'yet-another-key')
    await Promise.resolve()
    await Promise.resolve()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to persist openrouter key'), 'plain string failure')
  })

  it('clearApiKey deletes the stored key file (success, ENOENT silent, and other errors logged)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    await mod.loadKeys()

    files['/mock/userData/groq-key.enc'] = Buffer.from('enc:x')
    mod.clearApiKey('groq')
    expect(mod.getApiKey('groq')).toBeNull() // synchronous cache clear
    await Promise.resolve()

    mod.clearApiKey('openai') // no file present => unlink ENOENT, silent
    await Promise.resolve()
    expect(errSpy).not.toHaveBeenCalled()

    const fsMod = await import('node:fs/promises').then((m) => m.default)
    const unlinkSpy = vi.spyOn(fsMod, 'unlink')
    unlinkSpy.mockRejectedValueOnce(new Error('unlink failed'))
    mod.clearApiKey('deepgram')
    await Promise.resolve()
    await Promise.resolve()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to clear deepgram key'), 'unlink failed')

    // A non-Error rejection is stringified as-is (ternary false branch).
    unlinkSpy.mockRejectedValueOnce('plain string failure')
    mod.clearApiKey('local')
    await Promise.resolve()
    await Promise.resolve()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to clear local key'), 'plain string failure')
  })

  it('getMaskedKey returns null with no key, and masks known + unknown prefixes', async () => {
    const mod = await fresh()
    await mod.loadKeys()
    expect(mod.getMaskedKey('groq')).toBeNull()

    mod.setApiKey('groq', 'gsk_abcd1234wxyz')
    expect(mod.getMaskedKey('groq')).toBe('gsk_••••wxyz')

    mod.setApiKey('openrouter', 'sk-or-abcd1234wxyz')
    expect(mod.getMaskedKey('openrouter')).toBe('sk-or-••••wxyz')

    mod.setApiKey('openai', 'sk-abcd1234wxyz')
    expect(mod.getMaskedKey('openai')).toBe('sk-••••wxyz')

    mod.setApiKey('custom', 'plainkey1234')
    expect(mod.getMaskedKey('custom')).toBe('plai••••1234')
  })
})
