#!/usr/bin/env node
// Upload release artifacts to Cloudflare R2.
// Required env vars: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME
// Optional: RELEASE_DIR (default: ./release)

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
