import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'
import { CPP_RUNTIME_INTERNAL_VARIABLE } from '../addCppLocalVariables'
import { cBlockExternalVariables, cBlockInterfaceVariables, INTERFACE_CLASSES } from '../block-interface'

const variable = (name: string, cls?: VariableClass): PLCVariable => ({
  name,
  ...(cls ? { class: cls } : {}),
  type: { definition: 'base-type', value: 'INT' },
  location: '',
  documentation: '',
  debug: false,
})

const names = (variables: PLCVariable[]): string[] => variables.map((v) => v.name)

describe('cBlockInterfaceVariables', () => {
  it('carries every class a C++ block can reach as a plain member', () => {
    const result = cBlockInterfaceVariables([
      variable('i', 'input'),
      variable('o', 'output'),
      variable('io', 'inOut'),
      variable('l', 'local'),
      variable('t', 'temp'),
    ])

    expect(names(result)).toEqual(['i', 'o', 'io', 'l', 't'])
  })

  it('groups by class and keeps declaration order inside a class', () => {
    // Grouping is cosmetic — the struct is filled by name — but a stable order
    // keeps the generated header readable and its diffs meaningful.
    const result = cBlockInterfaceVariables([
      variable('t1', 'temp'),
      variable('o1', 'output'),
      variable('i1', 'input'),
      variable('o2', 'output'),
      variable('i2', 'input'),
      variable('t2', 'temp'),
    ])

    expect(names(result)).toEqual(['i1', 'i2', 'o1', 'o2', 't1', 't2'])
  })

  it('leaves out a VAR_EXTERNAL, which is collected separately', () => {
    // An external reaches the same struct, but its pointer has to be taken
    // under the global's lock, so the glue collects it on its own.
    expect(names(cBlockInterfaceVariables([variable('i', 'input'), variable('g', 'external')]))).toEqual(['i'])
  })

  it('leaves out a configuration global, which is not a POU variable at all', () => {
    expect(names(cBlockInterfaceVariables([variable('i', 'input'), variable('g', 'global')]))).toEqual(['i'])
  })

  it('leaves out the latch the toolchain injects into every C++ block', () => {
    const result = cBlockInterfaceVariables([variable('i', 'input'), variable(CPP_RUNTIME_INTERNAL_VARIABLE, 'local')])

    expect(names(result)).toEqual(['i'])
  })

  it('leaves out a variable with no class rather than guessing one', () => {
    expect(names(cBlockInterfaceVariables([variable('i', 'input'), variable('mystery')]))).toEqual(['i'])
  })

  it('returns nothing for an empty interface', () => {
    expect(cBlockInterfaceVariables([])).toEqual([])
  })

  it('does not mutate or alias the caller’s array', () => {
    // The sort is on an internal copy: the emitters share one variable list and
    // reordering it under them would be a very quiet bug.
    const input = [variable('t', 'temp'), variable('i', 'input')]
    cBlockInterfaceVariables(input)

    expect(names(input)).toEqual(['t', 'i'])
  })

  describe('cBlockExternalVariables', () => {
    it('collects only the externals', () => {
      const result = cBlockExternalVariables([
        variable('i', 'input'),
        variable('g', 'external'),
        variable('l', 'local'),
      ])

      expect(names(result)).toEqual(['g'])
    })

    it('orders them by name, so the lock nesting is the same in every block', () => {
      const result = cBlockExternalVariables([
        variable('gZulu', 'external'),
        variable('gAlpha', 'external'),
        variable('gmike', 'external'),
      ])

      expect(names(result)).toEqual(['gAlpha', 'gmike', 'gZulu'])
    })

    it('orders case-insensitively, since the emitted names are uppercased', () => {
      const result = cBlockExternalVariables([variable('gb', 'external'), variable('gA', 'external')])

      expect(names(result)).toEqual(['gA', 'gb'])
    })

    it('does not reorder the caller’s array', () => {
      const input = [variable('gZulu', 'external'), variable('gAlpha', 'external')]
      cBlockExternalVariables(input)

      expect(names(input)).toEqual(['gZulu', 'gAlpha'])
    })

    it('returns nothing when the block declares no externals', () => {
      expect(cBlockExternalVariables([variable('i', 'input')])).toEqual([])
    })
  })

  it('exposes the class order it applies', () => {
    expect(INTERFACE_CLASSES).toEqual(['input', 'output', 'inOut', 'local', 'temp'])
  })
})
