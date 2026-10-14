import { MQTT_LIMITS, type MqttIecType } from '../contract/contract'
import { utf8Length } from '../contract/names'

/** Sparkplug B DataType per IEC type (Tahu `sparkplug_b.proto`). */
export const SPARKPLUG_DATATYPE: Readonly<Record<MqttIecType, number>> = {
  BOOL: 11,
  SINT: 1,
  INT: 2,
  DINT: 3,
  LINT: 4,
  USINT: 5,
  UINT: 6,
  UDINT: 7,
  ULINT: 8,
  BYTE: 5,
  WORD: 6,
  DWORD: 7,
  LWORD: 8,
  REAL: 9,
  LREAL: 10,
  STRING: 12,
  WSTRING: 17,
  TIME: 4,
  TOD: 4,
  DATE: 4,
  DT: 4,
}

const ENCODING: Readonly<Partial<Record<MqttIecType, string>>> = {
  WSTRING: 'utf16le',
  TIME: 'int64-ns-duration',
  TOD: 'int64-ns-since-midnight',
  DATE: 'int64-ns-since-unix-epoch-utc-midnight',
  DT: 'int64-ns-since-unix-epoch',
}
const TEMPORAL: ReadonlySet<MqttIecType> = new Set(['TIME', 'TOD', 'DATE', 'DT'])
const EPOCH_BASED: ReadonlySet<MqttIecType> = new Set(['DATE', 'DT'])
const UINT64_MAX_LEN = 10
const UINT32_MAX_LEN = 5

export interface SparkplugBirthLeaf {
  destination: string
  iecType: MqttIecType
  size: number
}

const varintLength = (value: number): number => {
  let length = 1
  let rest = value
  while (rest >= 0x80) {
    rest = Math.floor(rest / 0x80)
    length += 1
  }
  return length
}

const fieldLength = (fieldNumber: number, payloadLength: number): number =>
  varintLength(fieldNumber << 3) + varintLength(payloadLength) + payloadLength

/** NBIRTH metric properties (all String) for a leaf of this IEC type. */
export const sparkplugBirthProperties = (iecType: MqttIecType): Array<[string, string]> => {
  const properties: Array<[string, string]> = [
    ['iecType', iecType],
    ['encoding', ENCODING[iecType] ?? 'native'],
  ]
  if (TEMPORAL.has(iecType)) properties.push(['unit', 'ns'])
  if (EPOCH_BASED.has(iecType)) properties.push(['epoch', 'unix'])
  return properties
}

const valueFieldUpperBound = (iecType: MqttIecType, size: number): number => {
  const datatype = SPARKPLUG_DATATYPE[iecType]
  if (datatype === 11) return varintLength(14 << 3) + 1
  if (datatype === 4 || datatype === 8) return varintLength(11 << 3) + UINT64_MAX_LEN
  if (datatype === 9) return varintLength(12 << 3) + 4
  if (datatype === 10) return varintLength(13 << 3) + 8
  if (datatype === 12) return fieldLength(15, size - 1)
  if (datatype === 17) return fieldLength(16, size - 1)
  return varintLength(10 << 3) + UINT32_MAX_LEN
}

const metricPrefix = (name: string): number =>
  fieldLength(1, utf8Length(name)) + (varintLength(3 << 3) + UINT64_MAX_LEN) + (varintLength(4 << 3) + 1)

/** Largest protobuf Metric body (name, timestamp, datatype, properties, value) one NBIRTH leaf can produce. */
export const sparkplugBirthMetricBodyUpperBound = (name: string, iecType: MqttIecType, size: number): number => {
  let properties = 0
  for (const [key, text] of sparkplugBirthProperties(iecType)) {
    properties += fieldLength(1, utf8Length(key))
    properties += fieldLength(2, varintLength(1 << 3) + 1 + fieldLength(8, utf8Length(text)))
  }
  const isNull = varintLength(7 << 3) + 1
  return metricPrefix(name) + fieldLength(9, properties) + Math.max(isNull, valueFieldUpperBound(iecType, size))
}

const CONTROL_METRICS_BYTES =
  fieldLength(2, metricPrefix('bdSeq') + varintLength(11 << 3) + UINT64_MAX_LEN) +
  fieldLength(2, metricPrefix('Node Control/Rebirth') + varintLength(14 << 3) + 1)

/** Must stay equal to the runtime's sparkplug_birth_upper_bound. */
export const sparkplugBirthUpperBound = (leaves: readonly SparkplugBirthLeaf[]): number =>
  varintLength(1 << 3) +
  UINT64_MAX_LEN +
  (varintLength(3 << 3) + UINT64_MAX_LEN) +
  CONTROL_METRICS_BYTES +
  leaves.reduce(
    (total, leaf) =>
      total + fieldLength(2, sparkplugBirthMetricBodyUpperBound(leaf.destination, leaf.iecType, leaf.size)),
    0,
  )

export const sparkplugBirthFits = (bytes: number): boolean => bytes <= MQTT_LIMITS.maxPayloadBytes
