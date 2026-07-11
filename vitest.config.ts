import { defineConfig } from 'vitest/config'

// Test files are colocated `*.test.ts(x)` next to their source. The legacy
// assert-based textops.spec.ts is NOT a vitest suite — include only *.test.*.
// Renderer tests opt into jsdom per-file via `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.{ts,tsx}', 'shared/**/*.test.{ts,tsx}', 'renderer/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['electron/**/*.ts', 'shared/**/*.ts', 'renderer/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.*',
        '**/*.spec.*',
        // Entry/wiring files: boot order + contextBridge glue, exercised by
        // smoke boots, not unit-testable without a live Electron runtime.
        'electron/main.ts',
        'electron/preload.ts',
        'renderer/main.tsx',
        'renderer/vite-env.d.ts'
      ],
      reporter: ['text', 'json-summary', 'html']
    }
  }
})
