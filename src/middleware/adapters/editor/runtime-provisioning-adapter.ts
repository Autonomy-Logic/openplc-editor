import {
  type RuntimeProvisioningPort,
  toRuntimeProvisioningEvent,
  toSshProbeResult,
} from '../../shared/ports/runtime-provisioning-port'
import { toRunEndToken, toRunReply } from './runtime-provisioning-run-reply'

interface RunEndFollower {
  seen(token: number): Promise<void>
  stop(): void
}

/** Subscribes to the event channel and records the run-end markers it carries. */
function followRunEndMarkers(): RunEndFollower {
  const seenTokens = new Set<number>()
  let awaited: { token: number; resolve: () => void } | null = null
  const stop = window.bridge.onRuntimeProvisioningEvent((value) => {
    const token = toRunEndToken(value)
    if (token === null) return
    if (awaited !== null && awaited.token === token) awaited.resolve()
    else seenTokens.add(token)
  })
  return {
    seen(token) {
      if (seenTokens.has(token)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        awaited = { token, resolve }
      })
    },
    stop,
  }
}

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
      const markers = followRunEndMarkers()
      try {
        const reply = toRunReply(await window.bridge.runtimeProvisioningRun(request))
        if (reply === null) return { kind: 'unknown' }
        await markers.seen(reply.endToken)
        return reply.outcome
      } catch {
        return { kind: 'unknown' }
      } finally {
        markers.stop()
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
