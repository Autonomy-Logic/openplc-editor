import type { PackagePort } from '../../middleware/shared/ports/package-port'
import type { VppTargetLoadState } from '../../middleware/shared/ports/vpp-target-mechanisms'

/** A packages port for a render test, whose target package load state the test sets. */
export interface TestPackagesPort {
  port: Partial<PackagePort>
  /** Sets the load state and notifies every subscriber; wrap it in `act` while something renders it. */
  push(next: VppTargetLoadState): void
  /** Load state subscriptions not yet released. */
  subscriptions(): number
}

/** A packages port that reports `initial` as the target package load state, with no vendor board and no pin. */
export function createTestPackagesPort(initial: VppTargetLoadState): TestPackagesPort {
  let current = initial
  const listeners = new Set<(state: VppTargetLoadState) => void>()
  return {
    port: {
      getTargetLoadState: () => current,
      onTargetLoadStateChanged: (callback) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      },
      listTargetBoards: () => Promise.resolve([]),
      onBoardsUpdated: () => () => undefined,
      getPackagePin: () => Promise.resolve(null),
    },
    push(next) {
      current = next
      for (const listener of listeners) listener(next)
    },
    subscriptions: () => listeners.size,
  }
}
