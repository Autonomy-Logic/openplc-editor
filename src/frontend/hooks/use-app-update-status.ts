import { useEffect, useState } from 'react'

import type { AppUpdateStatus } from '../../middleware/shared/ports/app-update-port'
import { useAppUpdate } from '../../middleware/shared/providers'

const NONE: AppUpdateStatus = { state: 'none' }

/** The editor's own update, for the status bar. Always `none` on a platform without the port (web). */
export function useAppUpdateStatus(): AppUpdateStatus {
  const appUpdate = useAppUpdate()
  const [status, setStatus] = useState<AppUpdateStatus>(NONE)

  useEffect(() => {
    if (!appUpdate) return

    let alive = true
    // A change pushed while the first read is in flight is newer than that read.
    let heard = false
    const unsubscribe = appUpdate.onStatusChanged((next) => {
      heard = true
      if (alive) setStatus(next)
    })
    appUpdate
      .getStatus()
      .then((current) => {
        if (alive && !heard) setStatus(current)
      })
      .catch(() => {
        // Nothing to show; a later change still arrives through the subscription.
      })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [appUpdate])

  return status
}
