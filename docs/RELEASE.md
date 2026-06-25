# Maverick Voice — Release & OTA

This guide covers building a signed macOS release locally, uploading artifacts to Cloudflare R2, and how the in-app auto-updater finds them.

## Prerequisites

- **macOS** for `.dmg` builds (cross-compiling is not supported)
- Apple Developer ID Application certificate in your Keychain (for signing + notarization)
- A Cloudflare R2 bucket with a **public** custom domain or `r2.dev` URL
- R2 API token with **Object Read & Write** on that bucket

Copy the example env file and fill in your values:

```bash
cp .env.release.example .env.release
# edit .env.release, then:
set -a && source .env.release && set +a
```

Never commit `.env.release` — it contains secrets.

## R2 layout

After upload, the bucket should look like:

```
downloads.json          ← public manifest (version + DMG/EXE URLs)
releases/
  Maverick Voice-x.y.z-arm64.dmg
  Maverick Voice-x.y.z-arm64.dmg.blockmap
  latest-mac.yml        ← required by electron-updater (macOS)
  … (Windows artifacts when built on Windows)
```

The app reads:

| Resource | URL |
|----------|-----|
| OTA feed (generic provider) | `$R2_PUBLIC_URL/releases` |
| Manual download links | `$R2_PUBLIC_URL/downloads.json` |

`R2_PUBLIC_URL` is injected at **build time** (see below). At runtime the packaged app also accepts an override stored in `updater-config` electron-store (`r2PublicUrl`) for testing.

## Local macOS release

1. Bump version (optional):

   ```bash
   npm run version:patch   # or edit package.json manually
   ```

2. Export Apple notarization credentials:

   ```bash
   export APPLE_ID=you@example.com
   export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   export APPLE_TEAM_ID=XXXXXXXXXX
   ```

3. Export R2 public URL (used by electron-builder publish config and baked into the updater):

   ```bash
   export R2_PUBLIC_URL=https://pub-xxxxx.r2.dev   # no trailing slash
   ```

4. Build, sign, notarize, and publish `latest-mac.yml` to R2 (via electron-builder `--publish always`):

   ```bash
   npm run release:mac
   ```

   Or build + upload all local artifacts in one step:

   ```bash
   npm run release:mac:upload
   # or unsigned local build + upload:
   npm run release:mac:local
   ```

   `release:mac:upload` runs `release:mac` then `node scripts/upload-r2.mjs`, which uploads everything in `./release/` and refreshes `downloads.json`.

5. Verify:

   ```bash
   curl -s "$R2_PUBLIC_URL/downloads.json" | jq .
   curl -sI "$R2_PUBLIC_URL/releases/latest-mac.yml" | head
   ```

## Upload only (CI or manual)

If artifacts already exist in `./release/`:

```bash
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
export R2_BUCKET_NAME=maverick-voice-releases
export R2_PUBLIC_URL=https://pub-xxxxx.r2.dev

node scripts/upload-r2.mjs
```

Optional: `RELEASE_DIR=/path/to/artifacts node scripts/upload-r2.mjs`

## CI

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `.github/workflows/ci.yml` | push / PR to `main` | `npm run typecheck` + `npm run build` on Ubuntu |
| `.github/workflows/release.yml` | tag `v*.*.*` or manual | Build macOS + Windows, upload to R2 |

Tag releases from the default branch when both platforms should ship together:

```bash
git tag v0.0.14
git push origin v0.0.14
```

## In-app updater behaviour

- **Skipped in dev** (`app.isPackaged === false`).
- **Skipped** when `R2_PUBLIC_URL` was not set at build time and no `r2PublicUrl` store override exists.
- Checks for updates ~10 s after launch (non-blocking).
- Users can also check from **Settings → About** or the tray menu **Check for Updates…**.
- When a download completes, the tray shows **Update ready — Restart** and About offers **Restart to update**.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Updater never runs | Dev build, or `R2_PUBLIC_URL` missing at package time |
| `check failed: 404` | `latest-mac.yml` not uploaded to `releases/` |
| Upload 403 | R2 token lacks write permission on the bucket |
| `downloads.json` missing | `R2_PUBLIC_URL` not set when running `upload-r2.mjs` |
| Notarization fails | Wrong `APPLE_*` credentials or cert not in Keychain |
