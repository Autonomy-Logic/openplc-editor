import type { VppTargetLoadState } from '@root/middleware/shared/ports/vpp-target-mechanisms'
import { usePackages } from '@root/middleware/shared/providers/platform-context'
import { useEffect, useState } from 'react'

const IDLE: VppTargetLoadState = { status: 'idle' }

/** The current load state of the target vPLC's package; idle on a platform without a packages port. */
export function useVppTargetLoadState(): VppTargetLoadState {
  const packages = usePackages()
  const [state, setState] = useState<VppTargetLoadState>(IDLE)

  useEffect(() => {
    if (!packages) return
    setState(packages.getTargetLoadState())
    return packages.onTargetLoadStateChanged(setState)
  }, [packages])

  return state
}
