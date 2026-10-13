import { useEffect, useState } from 'react'

import type { RuntimePort } from '../../../../../../../middleware/shared/ports/runtime-port'
import {
  type MqttRuntimeCredentialsV1,
  type MqttRuntimeStatusV1,
  parseMqttRuntimeCredentials,
  parseMqttRuntimeStatus,
} from '../../../../../../utils/mqtt/runtime/status'

export const MQTT_STATUS_POLL_INTERVAL_MS = 5000

export type MqttRuntimeView =
  | { kind: 'unsupported' }
  | { kind: 'no_target' }
  | { kind: 'offline' }
  | { kind: 'loading' }
  | { kind: 'ready'; status: MqttRuntimeStatusV1; credentials: MqttRuntimeCredentialsV1 | null }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }

/** A new context drops the previous state and timer; answers for an old context are discarded. */
export const useMqttRuntimeStatus = (input: {
  runtime: RuntimePort
  contextKey: string | null
  connected: boolean
  intervalMs?: number
}): MqttRuntimeView => {
  const { runtime, contextKey, connected } = input
  const intervalMs = input.intervalMs ?? MQTT_STATUS_POLL_INTERVAL_MS
  const supported = typeof runtime.getMqttStatus === 'function'
  const [view, setView] = useState<MqttRuntimeView>({ kind: 'loading' })

  useEffect(() => {
    if (!supported || contextKey === null || !connected) {
      setView({ kind: !supported ? 'unsupported' : contextKey === null ? 'no_target' : 'offline' })
      return
    }

    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    setView({ kind: 'loading' })

    const poll = async (): Promise<void> => {
      const next = await readRuntime(runtime)
      if (!active) return
      setView(next)
      timer = setTimeout(() => void poll(), intervalMs)
    }
    void poll()

    return () => {
      active = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [runtime, supported, contextKey, connected, intervalMs])

  return view
}

const readRuntime = async (runtime: RuntimePort): Promise<MqttRuntimeView> => {
  try {
    const response = await runtime.getMqttStatus?.()
    if (!response?.success) return { kind: 'error', message: response?.error ?? 'The runtime did not answer.' }
    const status = parseMqttRuntimeStatus(response.data)
    if (status === null) return { kind: 'invalid' }
    const credentialsResponse = runtime.getMqttCredentials ? await runtime.getMqttCredentials() : null
    const credentials = credentialsResponse?.success ? parseMqttRuntimeCredentials(credentialsResponse.data) : null
    return { kind: 'ready', status, credentials }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'The runtime did not answer.' }
  }
}
