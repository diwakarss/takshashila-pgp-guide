// Embedder child — runs under SYSTEM node (forked with execPath=node), where
// onnxruntime's native addon works (it SIGTRAPs under Electron's Node). Talks
// to the parent over child_process IPC (process.send / process.on('message')).
// An empty texts array means "just warm up". nomicCore is imported lazily so a
// load failure is reported, not a silent exit.

process.on('uncaughtException', (e) => console.error('[embedder-child] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[embedder-child] unhandledRejection:', e))

type Req = { id: number; texts: string[] }

type Core = typeof import('./nomicCore')
let corePromise: Promise<Core> | null = null
function core(): Promise<Core> {
  if (!corePromise) corePromise = import('./nomicCore')
  return corePromise
}

process.on('message', async (msg: Req) => {
  const { id, texts } = msg
  try {
    const { embedCore, warmupCore } = await core()
    if (texts.length === 0) {
      await warmupCore()
      process.send?.({ id, vectors: [] })
    } else {
      const vectors = await embedCore(texts)
      process.send?.({ id, vectors })
    }
  } catch (err) {
    console.error('[embedder-child] embed failed:', err)
    process.send?.({ id, error: err instanceof Error ? err.message : String(err) })
  }
})
