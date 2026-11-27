import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import { parseAddress, slotRangesOverlap } from '../../../../../../middleware/shared/utils/iec-address/registry'
import { getArrayTotalElements, isArrayVariable } from '../../../../../utils/PLC/array-codegen-helpers'
import { validateVariableSet } from '../variables'

const COLLISION = 'Location already exists'

const scalar = (name: string, location: string, value = 'BOOL', variableClass: PLCVariable['class'] = 'local') =>
  ({
    name,
    class: variableClass,
    type: { definition: 'base-type', value },
    location,
    documentation: '',
  }) as PLCVariable

const array = (name: string, location: string, last: number, baseType = 'BOOL'): PLCVariable => ({
  name,
  class: 'local',
  type: {
    definition: 'array',
    value: `ARRAY [0..${last}] OF ${baseType}`,
    data: { baseType: { definition: 'base-type', value: baseType }, dimensions: [{ dimension: `0..${last}` }] },
  } as PLCVariable['type'],
  location,
  documentation: '',
})

/** Indexes of the variables reported as colliding with an earlier one. */
const collisions = (variables: PLCVariable[]): number[] => {
  const result = validateVariableSet(variables)
  return result.ok ? [] : result.errors.filter((error) => error.title === COLLISION).map((error) => error.index)
}

const slotsOf = (variable: PLCVariable): number => (isArrayVariable(variable) ? getArrayTotalElements(variable) : 1)

/** The pairwise rule: a variable collides when its location overlaps any earlier variable's. */
const referenceCollides = (earlier: PLCVariable[], variable: PLCVariable): boolean => {
  const parsed = parseAddress(variable.location)
  return earlier.some((other) => {
    if (parsed === null) return other.location === variable.location
    const otherParsed = parseAddress(other.location)
    return otherParsed !== null && slotRangesOverlap(parsed, slotsOf(variable), otherParsed, slotsOf(other))
  })
}

/** Deterministic pseudo-random generator, so a failure reproduces. */
const random = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

describe('validateVariableSet: located variable collisions', () => {
  it('reports a repeated address on the second variable only', () => {
    expect(collisions([scalar('a', '%IX0.0'), scalar('b', '%IX0.1'), scalar('c', '%IX0.0')])).toEqual([2])
  })

  it('reports a scalar inside an earlier array', () => {
    expect(collisions([array('arr', '%QX0.0', 9), scalar('flag', '%QX0.6')])).toEqual([1])
  })

  it('reports an array covering an earlier scalar', () => {
    expect(collisions([scalar('flag', '%QX1.1'), array('arr', '%QX0.0', 9)])).toEqual([1])
  })

  it('keeps each address class its own space', () => {
    expect(
      collisions([
        scalar('w', '%MW0', 'WORD'),
        scalar('d', '%MD0', 'DWORD'),
        scalar('i', '%IX0.0'),
        scalar('q', '%QX0.0'),
      ]),
    ).toEqual([])
  })

  it('reports a collision with a wide array in both orders', () => {
    expect({
      scalarAfter: collisions([array('big', '%IW100', 1999, 'INT'), scalar('x', '%IW2099', 'INT')]),
      scalarBefore: collisions([scalar('x', '%IW2099', 'INT'), array('big', '%IW100', 1999, 'INT')]),
      wideAfterWide: collisions([array('big', '%IW100', 1999, 'INT'), array('big2', '%IW2000', 1999, 'INT')]),
      justAfter: collisions([array('big', '%IW100', 1999, 'INT'), scalar('y', '%IW2100', 'INT')]),
    }).toEqual({ scalarAfter: [1], scalarBefore: [1], wideAfterWide: [1], justAfter: [] })
  })

  it('reports an alias named twice', () => {
    expect(collisions([scalar('a', 'Motor_Start'), scalar('b', 'Motor_Stop'), scalar('c', 'Motor_Start')])).toEqual([2])
  })

  it('counts the address of an earlier variable refused for its class', () => {
    expect(collisions([scalar('a', '%IX0.0', 'BOOL', 'input'), scalar('b', '%IX0.0')])).toEqual([1])
  })

  it('agrees with the pairwise rule on random sets of scalars and arrays', () => {
    const next = random(7)
    const prefixes = ['%IX', '%QX', '%IW', '%QW', '%MW']
    const variables: PLCVariable[] = Array.from({ length: 600 }, (_, index) => {
      const prefix = prefixes[Math.floor(next() * prefixes.length)]
      const slot = Math.floor(next() * 400)
      const location = prefix.endsWith('X') ? `${prefix}${Math.floor(slot / 8)}.${slot % 8}` : `${prefix}${slot}`
      const baseType = prefix.endsWith('X') ? 'BOOL' : 'WORD'
      const roll = next()
      if (roll < 0.1) return array(`v${index}`, location, Math.floor(next() * 40), baseType)
      if (roll < 0.12) return array(`v${index}`, location, 1100 + Math.floor(next() * 200), baseType)
      if (roll < 0.15) return scalar(`v${index}`, `Alias_${Math.floor(next() * 20)}`, baseType)
      return scalar(`v${index}`, location, baseType)
    })
    const expected = variables
      .map((variable, index) => (referenceCollides(variables.slice(0, index), variable) ? index : -1))
      .filter((index) => index >= 0)
    expect({ exercised: expected.length > 10, reported: collisions(variables) }).toEqual({
      exercised: true,
      reported: expected,
    })
  })

  it('validates 40,000 located variables in linear time', () => {
    const variables = Array.from({ length: 40000 }, (_, index) =>
      scalar(`v${index}`, `%IX${Math.floor(index / 8)}.${index % 8}`),
    )
    const started = Date.now()
    const result = validateVariableSet(variables)
    expect({ ok: result.ok, fast: Date.now() - started < 3000 }).toEqual({ ok: true, fast: true })
  })
})
