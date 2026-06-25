#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.release ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.release
  set +a
  echo "[release-mac-local] Loaded .env.release"
fi

if [[ -z "${R2_PUBLIC_URL:-}" ]]; then
  echo "[release-mac-local] Warning: R2_PUBLIC_URL is unset — OTA feed URL may be missing from the build." >&2
fi

npm run dist:mac
node scripts/upload-r2.mjs

if [[ -n "${R2_PUBLIC_URL:-}" ]]; then
  echo "[release-mac-local] Done. Verify: ${R2_PUBLIC_URL%/}/downloads.json"
else
  echo "[release-mac-local] Done. Set R2_PUBLIC_URL and re-build to enable OTA."
fi
