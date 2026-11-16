import type { OpenPLCStore } from '@root/frontend/store'
import { selectIsEditingLocked } from '@root/frontend/store/slices/workspace/selectors'
import type { PlcModelPort } from '@root/middleware/shared/ports/plc-model-port'
import type { HostRelayMethod } from '@root/middleware/shared/vendor-document/protocol'

export const RELAY_LOCKED_MESSAGE = 'The project is read-only while the debugger is active.'

type HostRelayContext = {
  store: OpenPLCStore
  plcModel: PlcModelPort
  packageId: string
  screenId: string
}

/**
 * Answers the guest iframe's queries. A write arriving from inside the sandbox
 * is refused here, which is the only place the host can refuse it.
 */
export function createHostRelayHandler({ store, plcModel, packageId, screenId }: HostRelayContext) {
  return (method: HostRelayMethod, args: unknown[]): Promise<unknown> | unknown => {
    switch (method) {
      case 'getPlcVariables':
        return plcModel.listExportableVariables()
      case 'getPlcAddress': {
        const qualifier = args[0]
        if (typeof qualifier !== 'string') throw new Error('getPlcAddress needs a qualifier string')
        return plcModel.resolveAddress(qualifier)
      }
      case 'getPersistence':
        return store.getState().projectActions.getVppExtension(packageId, screenId) ?? null
      case 'setPersistence': {
        if (selectIsEditingLocked(store.getState())) throw new Error(RELAY_LOCKED_MESSAGE)
        store.getState().projectActions.setVppExtension(packageId, screenId, args[0])
        return true
      }
      default: {
        const unreachable: never = method
        return unreachable
      }
    }
  }
}
