/**
 * Renderer-safe platform detection, evaluated ONCE (v1 re-declared three
 * IS_MAC regexes — A9). No `process` access — userAgent only.
 */
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export const IS_MAC = /Macintosh|Mac OS X/i.test(ua)
export const IS_WIN = /Windows/i.test(ua)
export const IS_LINUX = !IS_MAC && !IS_WIN && /Linux/i.test(ua)
