import sparkplugFixture from '../../contract/fixtures/runtime-config/valid/sparkplug-client-certificate-all-types.json'
import values from '../../contract/fixtures/values/value-vectors.json'
import { isMqttIecType, MQTT_DEBUG_SIZE, type MqttIecType } from '../../contract/contract'
import {
  SPARKPLUG_DATATYPE,
  sparkplugBirthFits,
  sparkplugBirthMetricBodyUpperBound,
  sparkplugBirthProperties,
  sparkplugBirthUpperBound,
  type SparkplugBirthLeaf,
} from '../birth-size'

const leaf = (destination: string, iecType: MqttIecType): SparkplugBirthLeaf => ({
  destination,
  iecType,
  size: MQTT_DEBUG_SIZE[iecType],
})

const paddedNames = (count: number, filler: string): string[] =>
  Array.from({ length: count }, (_, i) => `${String(i).padStart(4, '0')}${filler.repeat(508)}`)

// Expected values computed with the runtime's `sparkplug_birth_upper_bound` on the same leaves.
describe('sparkplugBirthUpperBound matches the runtime', () => {
  it('for the Sparkplug fixture with all 21 types', () => {
    const leaves = sparkplugFixture.leaves.map((l) => {
      if (!isMqttIecType(l.iec_type)) throw new Error(l.iec_type)
      return { destination: l.destination, iecType: l.iec_type, size: l.size }
    })
    expect(sparkplugBirthUpperBound(leaves)).toBe(2324)
  })

  it('for an empty birth and for mixed names with multi-byte UTF-8', () => {
    expect(sparkplugBirthUpperBound([])).toBe(94)
    expect(
      sparkplugBirthUpperBound([
        leaf('Motor.é中\u{1F600}', 'WSTRING'),
        leaf('a'.repeat(200), 'STRING'),
        leaf('T', 'TIME'),
        leaf('D', 'DATE'),
        leaf('B', 'BOOL'),
        leaf('U', 'ULINT'),
        leaf('R', 'REAL'),
        leaf('I', 'SINT'),
      ]),
    ).toBe(1324)
  })

  it('for the fixture case that must be rejected and around the 256 KiB boundary', () => {
    expect(sparkplugBirthUpperBound(paddedNames(1000, 'n').map((n) => leaf(n, 'DINT')))).toBe(580094)
    const lreal = paddedNames(449, 'x').map((n) => leaf(n, 'LREAL'))
    expect(sparkplugBirthUpperBound(lreal.slice(0, 448))).toBe(261726)
    expect(sparkplugBirthUpperBound(lreal)).toBe(262310)
    expect(sparkplugBirthFits(261726)).toBe(true)
    expect(sparkplugBirthFits(262144)).toBe(true)
    expect(sparkplugBirthFits(262310)).toBe(false)
  })
})

describe('sparkplugBirthMetricBodyUpperBound', () => {
  // Vectors serialise Metric 'v' without the 11-byte timestamp the bound always reserves.
  const TIMESTAMP_BYTES = 11

  it.each(values.vectors.map((vector) => [vector.id, vector.iecType, vector.sparkplug.birthMetric] as const))(
    '%s never exceeds the bound',
    (_id, iecType, birthMetric) => {
      if (!isMqttIecType(iecType)) throw new Error(iecType)
      const bound = sparkplugBirthMetricBodyUpperBound('v', iecType, MQTT_DEBUG_SIZE[iecType]) - TIMESTAMP_BYTES
      expect(birthMetric.length / 2).toBeLessThanOrEqual(bound)
    },
  )

  it.each<[MqttIecType, string]>([
    ['BOOL', 'bool-true'],
    ['SINT', 'sint-min'],
    ['DINT', 'dint-min'],
    ['LINT', 'lint-min'],
    ['ULINT', 'ulint-max'],
    ['REAL', 'real-max'],
    ['LREAL', 'lreal-large'],
    ['TIME', 'time-negative'],
  ])('%s worst case is exact', (iecType, id) => {
    const vector = values.vectors.find((x) => x.id === id)
    if (!vector) throw new Error(id)
    const bound = sparkplugBirthMetricBodyUpperBound('v', iecType, MQTT_DEBUG_SIZE[iecType]) - TIMESTAMP_BYTES
    expect(vector.sparkplug.birthMetric.length / 2).toBe(bound)
  })

  it('declares the birth properties and datatypes of the vectors', () => {
    for (const vector of values.vectors) {
      if (!isMqttIecType(vector.iecType)) throw new Error(vector.iecType)
      expect(Object.fromEntries(sparkplugBirthProperties(vector.iecType))).toEqual(vector.sparkplug.properties)
      expect(SPARKPLUG_DATATYPE[vector.iecType]).toBe(vector.sparkplug.datatype)
    }
  })
})
