import {
  type RuntimeProvisioningPort,
  toRuntimeProvisioningEvent,
  toRuntimeProvisioningOutcome,
  toSshProbeResult,
} from '../../shared/ports/runtime-provisioning-port'

export function createEditorRuntimeProvisioningAdapter(): RuntimeProvisioningPort {
  return {
    async probeSsh(request) {
      try {
        return toSshProbeResult(await window.bridge.runtimeProvisioningProbeSsh(request))
      } catch {
        return { answered: false, reason: 'unreachable' }
      }
    },

    async run(request) {
      try {
        return toRuntimeProvisioningOutcome(await window.bridge.runtimeProvisioningRun(request))
      } catch {
        return { kind: 'unknown' }
      }
    },

    cancel() {
      return window.bridge.runtimeProvisioningCancel()
    },

    onEvent(callback) {
      return window.bridge.onRuntimeProvisioningEvent((value) => {
        const event = toRuntimeProvisioningEvent(value)
        if (event !== null) callback(event)
      })
    },
  }
}
