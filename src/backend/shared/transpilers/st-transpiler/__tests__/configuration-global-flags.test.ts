/**
 * Configuration-scope globals must carry their CONSTANT / RETAIN qualifier into
 * the emitted ST.
 *
 * The emitter used to open one unqualified `VAR_GLOBAL` for every configuration
 * global, so a global the user marked RETAIN in the variables table compiled as
 * a plain one and was never retained — the flag survived in project.json and
 * was dropped on the way to the compiler, which is the worst place for it to go
 * missing because nothing reports it.
 */
import type { TranspileProject, TranspileVariable } from '../types'
import { generateConfigurations } from '../emit/configuration'

const text = (project: TranspileProject): string =>
  generateConfigurations(project)
    .map(([chunk]) => chunk)
    .join('')

const global = (name: string, flag?: TranspileVariable['flag']): TranspileVariable => ({
  name,
  type: { definition: 'base-type', value: 'DINT' },
  location: '',
  ...(flag ? { flag } : {}),
})

const project = (globals: TranspileVariable[]): TranspileProject => ({
  pous: [],
  dataTypes: [],
  configuration: {
    tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
    instances: [],
    globalVariables: globals,
  },
})

describe('configuration globals — qualifier emission', () => {
  it('emits VAR_GLOBAL RETAIN for a retained global', () => {
    const out = text(project([global('g_hours', 'retain')]))
    expect(out).toContain('VAR_GLOBAL RETAIN')
    expect(out).toContain('g_hours')
  })

  it('emits VAR_GLOBAL CONSTANT for a constant global', () => {
    expect(text(project([global('k_max', 'constant')]))).toContain('VAR_GLOBAL CONSTANT')
  })

  it('leaves an unflagged global in a bare VAR_GLOBAL', () => {
    const out = text(project([global('plain')]))
    expect(out).toContain('VAR_GLOBAL\n')
    expect(out).not.toContain('VAR_GLOBAL RETAIN')
    expect(out).not.toContain('VAR_GLOBAL CONSTANT')
  })

  it('opens one block per qualifier rather than mixing them', () => {
    // IEC puts the qualifier on the BLOCK, so two globals with different flags
    // cannot share one `…END_VAR` pair.
    const out = text(project([global('plain'), global('g_hours', 'retain'), global('k_max', 'constant')]))
    expect(out).toContain('VAR_GLOBAL\n')
    expect(out).toContain('VAR_GLOBAL RETAIN')
    expect(out).toContain('VAR_GLOBAL CONSTANT')
    expect((out.match(/END_VAR/g) ?? []).length).toBe(3)
  })

  it('groups same-flag globals into a single block', () => {
    const out = text(project([global('a', 'retain'), global('b', 'retain')]))
    expect((out.match(/VAR_GLOBAL RETAIN/g) ?? []).length).toBe(1)
    expect((out.match(/END_VAR/g) ?? []).length).toBe(1)
  })

  it('keeps the unqualified block first, so an unflagged project is unchanged', () => {
    // Byte-for-byte stability for the common case is the reason grouping is by
    // first appearance rather than by a fixed qualifier order.
    const out = text(project([global('plain'), global('g_hours', 'retain')]))
    expect(out.indexOf('VAR_GLOBAL\n')).toBeLessThan(out.indexOf('VAR_GLOBAL RETAIN'))
  })

  it('emits nothing when there are no globals', () => {
    expect(text(project([]))).not.toContain('VAR_GLOBAL')
  })
})
