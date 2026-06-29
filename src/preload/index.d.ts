import type { PgpApi } from './index'

// Makes `window.pgp` typed inside the renderer (set by contextBridge above).
declare global {
  interface Window {
    pgp: PgpApi
  }
}
