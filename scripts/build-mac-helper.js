#!/usr/bin/env node
/**
 * Builds resources/bin/mac-helper as a UNIVERSAL binary (arm64 + x86_64,
 * macOS 12 deployment target) and verifies it with `lipo -archs`.
 *
 * v1 compiled with bare `swiftc -O` — the binary silently inherited the build
 * machine's arch and shipped arm64-only (LEGACY-ISSUES M2). This script fails
 * loudly instead: no universal output, no build.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

if (process.platform !== 'darwin') {
  console.log('[mac-helper] Skipping (not macOS)')
  process.exit(0)
}

const root = path.join(__dirname, '..')
const src = path.join(root, 'native/macos/mac-helper.swift')
const outDir = path.join(root, 'resources/bin')
const out = path.join(outDir, 'mac-helper')

try {
  execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' })
} catch {
  if (fs.existsSync(out)) {
    console.warn('[mac-helper] swiftc unavailable — using existing binary (verify arch!)')
    verify()
    process.exit(0)
  }
  console.error('[mac-helper] swiftc not found. Install Xcode Command Line Tools: xcode-select --install')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
const slices = []
for (const target of ['arm64-apple-macos12', 'x86_64-apple-macos12']) {
  const slice = `${out}.${target.split('-')[0]}`
  console.log(`[mac-helper] swiftc -O -target ${target}`)
  execFileSync('swiftc', ['-O', '-target', target, '-o', slice, src], { stdio: 'inherit' })
  slices.push(slice)
}
console.log('[mac-helper] lipo -create')
execFileSync('lipo', ['-create', ...slices, '-output', out], { stdio: 'inherit' })
for (const slice of slices) fs.unlinkSync(slice)
fs.chmodSync(out, 0o755)
verify()

function verify() {
  const archs = execFileSync('lipo', ['-archs', out]).toString().trim().split(/\s+/).sort()
  if (!(archs.includes('arm64') && archs.includes('x86_64'))) {
    console.error(`[mac-helper] NOT UNIVERSAL (archs: ${archs.join(', ')}) — refusing to continue`)
    process.exit(1)
  }
  console.log(`[mac-helper] OK — universal (${archs.join(' + ')})`)
}
