/**
 * An empty POU compiles (DOPE-650).
 *
 * `generateTextualPou` used to throw twice: once on a POU with no variables
 * ("No variable defined in X POU") and again on one with an empty body ("No
 * body defined in X POU"). Both were inherited from matiec/xml2st, where they
 * were real constraints. A single throw aborts the whole build — the port maps
 * a non-empty `errors` array to `ok: false` — so a user who had created a POU
 * and not filled it in yet could not compile anything at all, which is the
 * state every project passes through while it is being written.
 *
 * STruC++ 0.6.7 accepts every empty shape and emits `// Empty program body`
 * for it, so the guards only refused a build the compiler would have taken.
 * These tests pin the emitted ST rather than the absence of a throw, because
 * "it did not throw" would still pass if the emitter silently dropped the POU.
 */
import { transpileToSt } from '../index'
import type { TranspileProject, TranspilePou, TranspileVariable } from '../types'

const local = (name: string): TranspileVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: 'INT' },
  location: '',
})

const project = (...pous: TranspilePou[]): TranspileProject => ({
  pous,
  dataTypes: [],
  configuration: { tasks: [], instances: [], globalVariables: [] },
})

const st = (...pous: TranspilePou[]): string => {
  const result = transpileToSt(project(...pous))
  expect(result.errors).toEqual([])
  return result.programSt ?? ''
}

describe('empty POUs are emitted, not refused', () => {
  it('emits a PROGRAM with neither variables nor body', () => {
    const out = st({
      name: 'Blank',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
    })

    expect(out).toContain('PROGRAM Blank\n')
    expect(out).toContain('END_PROGRAM')
    // No VAR block at all, rather than an empty `VAR\nEND_VAR` pair.
    expect(out).not.toContain('VAR')
  })

  it('emits a PROGRAM whose variables are declared but whose body is empty', () => {
    const out = st({
      name: 'DeclaredOnly',
      pouType: 'program',
      interface: { variables: [local('counter')] },
      body: { language: 'st', value: '' },
    })

    expect(out).toContain('PROGRAM DeclaredOnly\n')
    expect(out).toContain('  VAR\n    counter : INT;\n  END_VAR\n')
    expect(out).toContain('END_PROGRAM')
  })

  it('emits an empty FUNCTION_BLOCK', () => {
    const out = st({
      name: 'BlankFb',
      pouType: 'function-block',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
    })

    expect(out).toContain('FUNCTION_BLOCK BlankFb\n')
    expect(out).toContain('END_FUNCTION_BLOCK')
  })

  it('emits an empty FUNCTION, keeping its return type', () => {
    const out = st({
      name: 'BlankFn',
      pouType: 'function',
      interface: { returnType: 'BOOL', variables: [] },
      body: { language: 'st', value: '' },
    })

    expect(out).toContain('FUNCTION BlankFn : BOOL\n')
    expect(out).toContain('END_FUNCTION')
  })

  it('emits an empty IL POU', () => {
    const out = st({
      name: 'BlankIl',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'il', value: '' },
    })

    expect(out).toContain('PROGRAM BlankIl\n')
    expect(out).toContain('END_PROGRAM')
  })

  it('emits an empty LD POU', () => {
    const out = st({
      name: 'BlankLd',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'ld', value: { rungs: [] } },
    })

    expect(out).toContain('PROGRAM BlankLd\n')
    expect(out).toContain('END_PROGRAM')
  })

  it('emits an empty FBD POU', () => {
    const out = st({
      name: 'BlankFbd',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'fbd', value: { rung: { nodes: [], edges: [] } } },
    })

    expect(out).toContain('PROGRAM BlankFbd\n')
    expect(out).toContain('END_PROGRAM')
  })

  it('does not let one empty POU suppress the others', () => {
    const out = st(
      {
        name: 'Blank',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'st', value: '' },
      },
      {
        name: 'Real',
        pouType: 'program',
        interface: { variables: [local('counter')] },
        body: { language: 'st', value: 'counter := 1;' },
      },
    )

    expect(out).toContain('PROGRAM Blank\n')
    expect(out).toContain('PROGRAM Real\n')
    expect(out).toContain('counter := 1;')
  })

  it('emits a POU with a body but no declarations, leaving the refusal to the compiler', () => {
    // Not the transpiler's call. STruC++ answers this one precisely —
    // "Undeclared variable 'A'", naming the symbol — where the old guard said
    // only that the POU had no variables, which is not the problem.
    const out = st({
      name: 'BodyOnly',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: 'a := 1;' },
    })

    expect(out).toContain('PROGRAM BodyOnly\n')
    expect(out).toContain('a := 1;')
  })
})
