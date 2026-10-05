import { useCallback, useEffect, useState } from 'react'

import type { CloudProjectsResult } from '../../../../../middleware/shared/ports/project-port'
import { useCapabilities, useEdgeAccountPort, useProject } from '../../../../../middleware/shared/providers'

/** A shortcut to recent work, not a project browser — Edge's own SPA covers everything. */
const RECENT_LIMIT = 5

export type RecentCloudProjects = CloudProjectsResult | null | undefined

export const useRecentCloudProjects = (): { cloud: RecentCloudProjects; reload: () => void } => {
  const caps = useCapabilities()
  const edgeAccount = useEdgeAccountPort()
  const project = useProject()

  const [result, setResult] = useState<CloudProjectsResult | null>(null)

  const available = caps.hasEdgeAccount && Boolean(edgeAccount) && project.listRecentCloudProjects !== undefined

  const load = useCallback(async () => {
    if (!project.listRecentCloudProjects) {
      return
    }

    // An unhandled rejection here takes down the whole renderer, not just this section.
    setResult(
      await project.listRecentCloudProjects(RECENT_LIMIT).catch((): CloudProjectsResult => ({ status: 'unreachable' })),
    )
  }, [project])

  useEffect(() => {
    if (!available) {
      return
    }

    void load()
  }, [available, load])

  // The session's own restored/expired signal, not a poll.
  useEffect(() => {
    if (!available || !edgeAccount) {
      return
    }

    const unsubscribeRestored = edgeAccount.session.onRestored(() => void load())
    const unsubscribeExpired = edgeAccount.session.onExpired(() => setResult({ status: 'signed-out' }))

    return () => {
      unsubscribeRestored()
      unsubscribeExpired()
    }
  }, [available, edgeAccount, load])

  const reload = useCallback(() => void load(), [load])

  return { cloud: !available || result?.status === 'unavailable' ? undefined : result, reload }
}
