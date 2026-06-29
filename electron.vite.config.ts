import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// PGLite ships WASM + a worker; keep it external so Electron's main process
// loads it from node_modules at runtime instead of Vite trying to bundle the WASM.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // utilityProcess child for the embedder — built as its own entry so
          // it can be fork()ed at out/main/embedderProcess.js.
          embedderProcess: resolve('src/main/embed/embedderProcess.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // Sandboxed preloads MUST be CommonJS. The repo is type:module, so
        // emit an explicit .cjs to avoid Node treating it as ESM.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
