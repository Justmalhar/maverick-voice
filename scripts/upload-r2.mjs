#!/usr/bin/env node
// Upload release artifacts to Cloudflare R2.
// Required env vars: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME
// Optional: RELEASE_DIR (default: ./release), R2_PUBLIC_URL (enables downloads.json manifest upload)

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { lookup } from 'node:dns' // just a built-in import to verify node works

const required = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET_NAME']
for (const key of required) {
  if (!process.env[key]) { console.error(`Missing env var: ${key}`); process.exit(1) }
}

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME
const RELEASE_DIR = process.env.RELEASE_DIR ?? './release'
const INCLUDE = ['.dmg', '.dmg.blockmap', '.exe', '.exe.blockmap', 'latest-mac.yml', 'latest.yml']

const files = readdirSync(RELEASE_DIR).filter(f => INCLUDE.some(ext => f.endsWith(ext)))

if (!files.length) { console.error('No release artifacts found in', RELEASE_DIR); process.exit(1) }

for (const file of files) {
  const body = readFileSync(join(RELEASE_DIR, file))
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: `releases/${file}`, Body: body }))
  console.log(`✓ ${file} (${(body.length / 1e6).toFixed(1)} MB)`)
}

console.log('Upload complete.')

// Upload downloads.json manifest so the website always links to the latest build.
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL
if (!R2_PUBLIC_URL) {
  console.warn('⚠ R2_PUBLIC_URL not set — skipping downloads.json manifest upload')
} else {
  const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
  const version = pkg.version
  const productName = pkg.build?.productName ?? pkg.name
  const macFile = encodeURIComponent(`${productName}-${version}-arm64.dmg`)
  const winFile = encodeURIComponent(`${productName}-${version}-x64.exe`)
  const manifest = JSON.stringify({
    version,
    mac: `${R2_PUBLIC_URL}/releases/${macFile}`,
    win: `${R2_PUBLIC_URL}/releases/${winFile}`,
  }, null, 2)
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'downloads.json',
    Body: manifest,
    ContentType: 'application/json',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }))
  console.log(`✓ downloads.json  (version ${version})`)
}
