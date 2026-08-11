/**
 * THE first node of the VPP licensing flow: does this board participate at all?
 *
 * Everything downstream — the extra Modbus round trips, the backend call, the
 * badge, the demo prompt — hangs off this one answer. When it is "no", a connect
 * is an ordinary connect: no license FCs, no HTTP, nothing on screen. That is
 * the common case (every built-in board, plain Runtime v3/v4, Arduino, the
 * Simulator), so it has to be the cheap, obvious path rather than a branch buried
 * three layers into an activation routine.
 *
 * Pure function over the already-resolved capability block plus the board's VPP
 * metadata — no IPC, no filesystem. Lives on the byte-identical shared surface
 * because the renderer asks the same question the main process does: the badge
 * must not appear on a board the flow will not run for.
 */

import type { BoardInfo } from '../../ports/types'
import { resolveTargetCapabilities } from '../target-capabilities'

/**
 * Why the licensing flow will not run for a board. Kept as distinct reasons
 * rather than a bare `false` because they are NOT interchangeable to a human:
 * "this product is not sold licensed" is normal, while "declared licensable with
 * no package id" is a broken manifest that someone has to fix.
 */
export type LicensingSkipReason = 'not-licensable' | 'no-package-id'

export type LicensingTarget =
  | {
      licensable: true
      /** Reverse-domain VPP package id (`package.id`) — the only VPP identifier
       *  the activation wire accepts, and the one the purchase page resolves. */
      packageId: string
    }
  | { licensable: false; reason: LicensingSkipReason }

/**
 * Decide whether the licensing flow applies to a board, and gather the two facts
 * it needs if so.
 *
 * `boardInfo` is optional so callers can hand through a not-yet-resolved board
 * without a null dance; absent board info is simply not licensable.
 *
 * A board whose manifest declares `isLicensable: true` but carries no
 * `vpp.packageId` resolves to `no-package-id` rather than being treated as
 * licensable. Proceeding without a package id would mean calling `/activate`
 * with nothing to identify the product, or worse, deciding "no license" from a
 * question that was never asked — and then telling the user to buy something the
 * editor cannot name. Only a malformed or hand-edited manifest reaches this.
 */
export function resolveLicensingTarget(boardInfo: BoardInfo | null | undefined): LicensingTarget {
  if (!boardInfo) return { licensable: false, reason: 'not-licensable' }

  const capabilities = resolveTargetCapabilities(boardInfo)
  if (!capabilities.isLicensable) return { licensable: false, reason: 'not-licensable' }

  const packageId = boardInfo.vpp?.packageId?.trim()
  if (!packageId) return { licensable: false, reason: 'no-package-id' }

  return { licensable: true, packageId }
}
