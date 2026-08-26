import { execFileSync } from 'node:child_process'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import {
  describeShmField,
  describeVariableType,
  SHM_SCALAR_TYPES,
  SHM_STRING,
  SHM_STRING_CHARS,
  SHM_WSTRING,
} from '../shm-type-map'

const scalar = (name: string, value: string): PLCVariable => ({
  name,
  class: 'input',
  type: { definition: 'base-type', value },
  location: '',
  documentation: '',
  debug: false,
})

const arrayOf = (name: string, baseType: string, dimension = '0..3'): PLCVariable => ({
  name,
  class: 'input',
  type: {
    definition: 'array',
    value: `ARRAY [${dimension}] OF ${baseType}`,
    data: { baseType: { definition: 'base-type', value: baseType }, dimensions: [{ dimension }] },
  },
  location: '',
  documentation: '',
  debug: false,
})

const userType = (name: string, typeName: string): PLCVariable => ({
  name,
  class: 'input',
  type: { definition: 'user-data-type', value: typeName },
  location: '',
  documentation: '',
  debug: false,
})

/**
 * Ask a real Python interpreter what a format string measures.
 *
 * The point of the descriptor table is that the C struct and the Python format
 * describe the same bytes. Asserting the declared size against a hand-written
 * constant would only restate the table; asking `struct.calcsize` measures the
 * side that actually decodes the buffer at runtime.
 */
function pythonCalcsize(format: string): number {
  const out = execFileSync('python3', ['-c', `import struct;print(struct.calcsize(${JSON.stringify(format)}))`], {
    encoding: 'utf-8',
  })
  return Number.parseInt(out.trim(), 10)
}

describe('SHM type map — the C and Python sides describe the same bytes', () => {
  const entries = Object.entries(SHM_SCALAR_TYPES)

  it.each(entries)('%s: declared size matches struct.calcsize of its format', (_name, descriptor) => {
    expect(pythonCalcsize(`=${descriptor.pyFormat}`)).toBe(descriptor.size)
  })

  it('STRING is a length byte plus its character budget', () => {
    expect(pythonCalcsize(`=${SHM_STRING.pyFormat}`)).toBe(SHM_STRING.size)
    expect(SHM_STRING.size).toBe(1 + SHM_STRING_CHARS)
  })

  it('WSTRING is a length byte plus two bytes per character', () => {
    expect(pythonCalcsize(`=${SHM_WSTRING.pyFormat}`)).toBe(SHM_WSTRING.size)
    expect(SHM_WSTRING.size).toBe(1 + SHM_STRING_CHARS * 2)
  })

  it('STRING and WSTRING match the sizes the debug map reports', () => {
    // strucpp emits these for the same variables; the transport must agree with
    // what the debugger already speaks.
    expect(SHM_STRING.size).toBe(127)
    expect(SHM_WSTRING.size).toBe(253)
  })

  it('every scalar has a distinct, non-empty C type and format', () => {
    for (const [name, descriptor] of entries) {
      expect(descriptor.cType).not.toBe('')
      expect(descriptor.pyFormat).not.toBe('')
      expect(descriptor.kind).toBe('scalar')
      expect(descriptor.size).toBeGreaterThan(0)
      expect(name).toBe(name.toLowerCase())
    }
  })
})

describe('describeShmField', () => {
  it.each(['bool', 'sint', 'int', 'dint', 'lint', 'usint', 'uint', 'udint', 'ulint'])(
    'resolves the integer type %s',
    (t) => {
      expect(describeShmField(scalar('v', t))).toBe(SHM_SCALAR_TYPES[t])
    },
  )

  it.each(['time', 'date', 'tod', 'dt'])('resolves the duration/calendar type %s as int64', (t) => {
    const descriptor = describeShmField(scalar('v', t))
    expect(descriptor?.cType).toBe('int64_t')
    expect(descriptor?.pyFormat).toBe('q')
    expect(descriptor?.size).toBe(8)
  })

  it('is case-insensitive about the declared type name', () => {
    expect(describeShmField(scalar('v', 'DINT'))).toBe(SHM_SCALAR_TYPES.dint)
    expect(describeShmField(scalar('v', 'Real'))).toBe(SHM_SCALAR_TYPES.real)
  })

  it('resolves STRING and WSTRING to distinct descriptors', () => {
    expect(describeShmField(scalar('v', 'string'))).toBe(SHM_STRING)
    expect(describeShmField(scalar('v', 'wstring'))).toBe(SHM_WSTRING)
    expect(SHM_STRING.cType).not.toBe(SHM_WSTRING.cType)
    expect(SHM_STRING.size).not.toBe(SHM_WSTRING.size)
  })

  it('resolves an array through its element type', () => {
    expect(describeShmField(arrayOf('v', 'INT'))).toBe(SHM_SCALAR_TYPES.int)
    expect(describeShmField(arrayOf('v', 'TIME'))).toBe(SHM_SCALAR_TYPES.time)
  })

  it('refuses a user-defined type rather than describing it', () => {
    expect(describeShmField(userType('v', 'Motor'))).toBeNull()
  })

  it('refuses an array of a user-defined type', () => {
    const v = arrayOf('v', 'Motor')
    v.type.data!.baseType = { definition: 'user-data-type', value: 'Motor' }
    expect(describeShmField(v)).toBeNull()
  })

  it('refuses an unknown base type rather than guessing a width', () => {
    expect(describeShmField(scalar('v', 'float32'))).toBeNull()
  })
})

describe('describeVariableType', () => {
  it('names a scalar type', () => {
    expect(describeVariableType(scalar('v', 'dint'))).toBe('DINT')
  })

  it('names an array by its element type', () => {
    expect(describeVariableType(arrayOf('v', 'INT'))).toBe('ARRAY OF INT')
  })

  it('names a user-defined type', () => {
    expect(describeVariableType(userType('v', 'Motor'))).toBe('MOTOR')
  })
})
