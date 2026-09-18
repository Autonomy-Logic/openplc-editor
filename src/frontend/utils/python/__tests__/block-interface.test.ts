import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'
import {
  INBOUND_CLASSES,
  OUTBOUND_CLASSES,
  pythonInboundVariables,
  pythonInterfaceVariables,
  pythonOutboundVariables,
  pythonRefusedVariables,
} from '../block-interface'

const variable = (name: string, cls?: VariableClass): PLCVariable => ({
  name,
  ...(cls ? { class: cls } : {}),
  type: { definition: 'base-type', value: 'INT' },
  location: '',
  documentation: '',
  debug: false,
})

const names = (variables: PLCVariable[]): string[] => variables.map((v) => v.name)

describe('python block interface', () => {
  const all = [
    variable('i', 'input'),
    variable('o', 'output'),
    variable('io', 'inOut'),
    variable('l', 'local'),
    variable('g', 'external'),
  ]

  it('sends an input in only', () => {
    expect(names(pythonInboundVariables(all))).toContain('i')
    expect(names(pythonOutboundVariables(all))).not.toContain('i')
  })

  it('brings an output back only', () => {
    expect(names(pythonOutboundVariables(all))).toContain('o')
    expect(names(pythonInboundVariables(all))).not.toContain('o')
  })

  it.each(['io', 'l', 'g'])('carries %s both ways, so the PLC keeps owning the value', (name) => {
    // A block that never assigns one sends back what it received. That is what
    // makes a VAR the block's own state and keeps it visible to the debugger.
    expect(names(pythonInboundVariables(all))).toContain(name)
    expect(names(pythonOutboundVariables(all))).toContain(name)
  })

  it('orders both directions by class, then by declaration', () => {
    // The order carries no meaning; it only has to be identical everywhere,
    // because the struct layout and the format string are positional.
    expect(names(pythonInboundVariables(all))).toEqual(['i', 'io', 'l', 'g'])
    expect(names(pythonOutboundVariables(all))).toEqual(['o', 'io', 'l', 'g'])
  })

  it('keeps declaration order within one class', () => {
    const vars = [variable('b', 'input'), variable('a', 'input')]
    expect(names(pythonInboundVariables(vars))).toEqual(['b', 'a'])
  })

  it('carries no temp in either direction — it is refused instead', () => {
    const vars = [variable('i', 'input'), variable('scratch', 'temp')]
    expect(names(pythonInboundVariables(vars))).toEqual(['i'])
    expect(names(pythonOutboundVariables(vars))).toEqual([])
  })

  it('carries no configuration global, which is not a POU variable', () => {
    expect(names(pythonInboundVariables([variable('g', 'global')]))).toEqual([])
  })

  it('carries no variable that has no class rather than guessing one', () => {
    expect(names(pythonInboundVariables([variable('mystery')]))).toEqual([])
  })

  it.each(['first_run', 'shm_in_ptr', 'shm_out_ptr'])('leaves the injected %s out of the structs', (name) => {
    // These are declared `local` by the toolchain. Marshalling them would hand
    // the block its own mapped segment addresses to overwrite.
    const vars = [variable('i', 'input'), variable(name, 'local')]
    expect(names(pythonInboundVariables(vars))).toEqual(['i'])
    expect(names(pythonOutboundVariables(vars))).toEqual([])
  })

  it('does not reorder the caller’s array', () => {
    const input = [variable('l', 'local'), variable('i', 'input')]
    pythonInboundVariables(input)
    expect(names(input)).toEqual(['l', 'i'])
  })

  describe('pythonInterfaceVariables', () => {
    it('lists every variable that crosses at all, each exactly once', () => {
      expect(names(pythonInterfaceVariables(all))).toEqual(['i', 'io', 'l', 'g', 'o'])
    })

    it('is empty when nothing crosses', () => {
      expect(pythonInterfaceVariables([variable('scratch', 'temp')])).toEqual([])
    })
  })

  describe('pythonRefusedVariables', () => {
    it('refuses a temp, and says what to do instead', () => {
      const refused = pythonRefusedVariables([variable('i', 'input'), variable('scratch', 'temp')])

      expect(refused).toHaveLength(1)
      expect(refused[0].variable.name).toBe('scratch')
      expect(refused[0].reason).toContain('VAR_TEMP')
      expect(refused[0].reason).toContain('Declare it under VAR instead')
    })

    it('refuses nothing a Python block can express', () => {
      expect(pythonRefusedVariables(all)).toEqual([])
    })

    it('refuses nothing for a variable with no class', () => {
      expect(pythonRefusedVariables([variable('mystery')])).toEqual([])
    })
  })

  it('exposes the class order each direction applies', () => {
    expect(INBOUND_CLASSES).toEqual(['input', 'inOut', 'local', 'external'])
    expect(OUTBOUND_CLASSES).toEqual(['output', 'inOut', 'local', 'external'])
  })
})
