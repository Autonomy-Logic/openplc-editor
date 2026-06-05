import type { EtherCATMasterStatus, EtherCATRuntimeStatusResponse } from '@root/middleware/shared/ports/ethercat-types'

/**
 * Return the masters array from a runtime status response, or an empty list
 * when the runtime hasn't reported any. Lives as a helper so call sites can
 * treat the response uniformly without re-implementing the null guard.
 */
export function normalizeEthercatStatus(
  status: EtherCATRuntimeStatusResponse | null | undefined,
): EtherCATMasterStatus[] {
  return status?.masters ?? []
}
