import type { PLCDataType, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { createTestStore } from '../../store/testing'
import type { DebugVariableEntry } from '../debug-parser'
import { buildDebugVariableTreeMap } from '../debugger-session'

const SYSTEM_LIBS = createTestStore().getState().libraries.system

const REALS = 30000
const MOTORS = 2000
const MOTOR_FIELDS = ['RUN', 'FAULT', 'SPEED', 'CURRENT', 'HOURS', 'STARTS', 'SETPOINT', 'MODE']

const arrayOf = (name: string, dimension: string, baseType: PLCVariable['type']): PLCVariable =>
  ({
    name,
    class: 'local',
    type: {
      definition: 'array',
      value: `ARRAY [${dimension}] OF ${baseType.value}`,
      data: { baseType, dimensions: [{ dimension }] },
    },
    location: '',
    documentation: '',
  }) as PLCVariable

const motor: PLCDataType = {
  name: 'MOTOR',
  derivation: 'structure',
  variable: MOTOR_FIELDS.map((field) => ({ name: field, type: { definition: 'base-type', value: 'INT' } })),
} as PLCDataType

const main: PLCPou = {
  name: 'main',
  pouType: 'program',
  interface: {
    variables: [
      arrayOf('A_REAL', `0..${REALS - 1}`, { definition: 'base-type', value: 'REAL' }),
      arrayOf('M', `1..${MOTORS}`, { definition: 'user-data-type', value: 'MOTOR' }),
    ],
  },
  body: { language: 'st', value: '' },
} as PLCPou

/** Debug-map leaves in the order STruC++ emits them, with mixed-case names as a map may carry. */
function entries(): DebugVariableEntry[] {
  const out: DebugVariableEntry[] = []
  for (let i = 0; i < REALS; i++) out.push({ name: `INSTANCE0.A_REAL[${i}]`, type: 'REAL_ENUM', index: out.length })
  for (let m = 1; m <= MOTORS; m++)
    for (const field of MOTOR_FIELDS)
      out.push({ name: `instance0.M[${m}].${field}`, type: 'INT_ENUM', index: out.length })
  return out
}

describe('buildDebugVariableTreeMap on a large program', () => {
  it(`resolves ${REALS + MOTORS * MOTOR_FIELDS.length} leaves in linear time`, () => {
    const debugVariables = entries()

    const started = Date.now()
    const { treeMap } = buildDebugVariableTreeMap(
      [main],
      [{ name: 'instance0', task: 'task0', program: 'main' }],
      debugVariables,
      { dataTypes: [motor], pous: [main] },
      SYSTEM_LIBS,
    )
    const elapsed = Date.now() - started

    const leaves = [...treeMap.values()].filter((node) => !node.isComplex)
    expect({
      leaves: leaves.length,
      unresolved: leaves.filter((node) => node.debugIndex === undefined).length,
      lastReal: treeMap.get(`main:A_REAL[${REALS - 1}]`)?.debugIndex,
      lastMotorMode: treeMap.get(`main:M[${MOTORS}].MODE`)?.debugIndex,
      fast: elapsed < 2000,
    }).toEqual({
      leaves: debugVariables.length,
      unresolved: 0,
      lastReal: REALS - 1,
      lastMotorMode: debugVariables.length - 1,
      fast: true,
    })
  })

  it('keeps the first entry when two leaves share a path', () => {
    const debugVariables: DebugVariableEntry[] = [
      { name: 'INSTANCE0.A_REAL[0]', type: 'REAL_ENUM', index: 7 },
      { name: 'INSTANCE0.A_REAL[0]', type: 'REAL_ENUM', index: 9 },
    ]
    const { treeMap } = buildDebugVariableTreeMap(
      [main],
      [{ name: 'instance0', task: 'task0', program: 'main' }],
      debugVariables,
      { dataTypes: [motor], pous: [main] },
      SYSTEM_LIBS,
    )
    expect(treeMap.get('main:A_REAL[0]')?.debugIndex).toBe(7)
  })
})
