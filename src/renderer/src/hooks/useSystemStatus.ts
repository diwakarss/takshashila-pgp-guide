import { useCallback, useEffect, useState } from 'react'
import type { BrainStats, CorpusStatus, EngineStatus } from '../../../shared/ipc'

export type SystemStatus = {
  stats: BrainStats | null
  corpus: CorpusStatus | null
  engine: EngineStatus | null
  ready: boolean // corpus imported (has chunks)
  refresh: () => Promise<void>
}

// Single source of the app's live status — brain, corpus, engine — shared by
// the sidebar, Tutor, and Settings so they never disagree.
export function useSystemStatus(): SystemStatus {
  const [stats, setStats] = useState<BrainStats | null>(null)
  const [corpus, setCorpus] = useState<CorpusStatus | null>(null)
  const [engine, setEngine] = useState<EngineStatus | null>(null)

  const refresh = useCallback(async () => {
    const [s, c, e] = await Promise.all([
      window.pgp.brainStats(),
      window.pgp.corpusStatus(),
      window.pgp.engineStatus()
    ])
    setStats(s)
    setCorpus(c)
    setEngine(e)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { stats, corpus, engine, ready: (stats?.chunks ?? 0) > 0, refresh }
}
