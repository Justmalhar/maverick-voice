// ════════════════════════════════════════════════════════════════════════
// scripts/check-native.js — predev/prebuild guard for the macOS native helpers.
//
//  - darwin: verify resources/bin/globe-listener AND resources/bin/key-poster
//    exist (the global key listener + the keystroke poster). If either is
//    missing, print rebuild instructions matching build-globe-listener.js /
//    build-key-poster.js and exit non-zero so the dev/build run stops early
//    with a clear message instead of a silent "hotkeys don't work".
//  - win32 (and any non-darwin): NO-OP. Key listening uses uiohook-napi and
//    paste/copy uses PowerShell SendKeys — no native helper binaries needed.
// ════════════════════════════════════════════════════════════════════════

const path = require('path')
const fs = require('fs')

// Non-darwin: nothing to verify.
if (process.platform !== 'darwin') {
  console.log('[check-native] Skipping (not macOS — uiohook-napi + PowerShell handle Windows)')
  process.exit(0)
}

const BIN_DIR = path.resolve(__dirname, '../resources/bin')

// Each helper: the binary name and the npm script that (re)builds it.
const HELPERS = [
  { name: 'globe-listener', script: 'npm run compile:globe' },
  { name: 'key-poster', script: 'npm run compile:key-poster' }
]

const missing = []
for (const helper of HELPERS) {
  const binPath = path.join(BIN_DIR, helper.name)
  const found = fs.existsSync(binPath)
  console.log('[check-native] Checking', binPath, '→', found ? 'FOUND' : 'MISSING')
  if (!found) {
    missing.push(helper)
  }
}

if (missing.length === 0) {
  console.log('[check-native] All macOS native helpers present.')
  process.exit(0)
}

console.error('')
console.error('[check-native] Missing macOS native helper binaries:')
for (const helper of missing) {
  console.error(`  - resources/bin/${helper.name}  (rebuild with: ${helper.script})`)
}
console.error('')
console.error('[check-native] Build them all with: npm run compile:native')
console.error('[check-native] Make sure Xcode Command Line Tools are installed: xcode-select --install')
console.error('')
process.exit(1)
