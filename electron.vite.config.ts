import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    // electron-store and uuid are ESM-only (no CJS export) — they must be
    // BUNDLED into the CJS main bundle, not externalized, or require() throws
    // "Store is not a constructor" at load. Native/CJS deps stay external.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store', 'uuid'] })],
    build: {
      outDir: 'dist/electron',
      lib: {
        entry: resolve(__dirname, 'electron/main.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'renderer/index.html')
      }
    },
    plugins: [tailwindcss()]
  }
})
