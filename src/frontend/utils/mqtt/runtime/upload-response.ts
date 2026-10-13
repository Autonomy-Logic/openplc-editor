// The runtime answers a refused upload with HTTP 200 and a non-empty UploadFileFail.

import { MQTT_ERROR_CATEGORIES, type MqttErrorCategory } from './status'

export interface RuntimeMqttConfigError {
  code: string
  category: MqttErrorCategory
  message: string
  pointer: string
}

export interface RuntimeUploadRejection {
  reason: string
  mqtt: RuntimeMqttConfigError | null
}

const CODE = /^[a-z][a-z0-9_]{2,63}$/
const MAX_TEXT = 2048

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCategory = (value: unknown): value is MqttErrorCategory =>
  MQTT_ERROR_CATEGORIES.some((category) => category === value)

const text = (value: unknown): string | null => (typeof value === 'string' && value.length <= MAX_TEXT ? value : null)

const readMqttError = (value: unknown): RuntimeMqttConfigError | null => {
  if (!isRecord(value)) return null
  const { code, category, message, pointer } = value
  const messageText = text(message)
  const pointerText = text(pointer)
  if (typeof code !== 'string' || !CODE.test(code) || !isCategory(category)) return null
  if (messageText === null || pointerText === null) return null
  return { code, category, message: messageText, pointer: pointerText }
}

/** The refusal carried by an upload response body, or null when the runtime accepted the program. */
export const readRuntimeUploadRejection = (body: string): RuntimeUploadRejection | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const reason = text(parsed.UploadFileFail)
  if (reason === null || reason.trim() === '') return null
  return { reason, mqtt: readMqttError(parsed.MqttConfigError) }
}

/** One log line for an MQTT refusal, in the same shape the producer uses for its own issues. */
export const describeRuntimeMqttConfigError = (error: RuntimeMqttConfigError): string =>
  `MQTT Configuration Error (runtime, ${error.category}): ${error.message} [${error.code} at ${error.pointer || '/'}]`
