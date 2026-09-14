/**
 * The edit-time duplicate-output scan (DOPE-615, B6).
 *
 * Two declarations of one output address are refused at compile time; this is
 * the same fact answered while the user is still typing. It carries SCOPE as
 * well as name for a reason that is easy to get wrong: the two declarations
 * are usually in different POUs, where the same name is entirely ordinary. A
 * cell excluding itself by name alone removed the other writer too, and the
 * warning rendered with an empty list while the glyph still showed.
 */

import { renderHook } from '@testing-library/react'

import { useOpenPLCStore } from '@root/frontend/store'
import { useDuplicateOutputLocations } from '../use-duplicate-output-locations'

const variable = (name: string, location: string) => ({
  name,
  location,
  documentation: '',
  type: { definition: 'base-type' as const, value: 'BOOL' as const },
})

function withProject(pous: Array<{ name: string; variables: unknown[] }>, globals: unknown[] = []) {
  const state = useOpenPLCStore.getState()
  useOpenPLCStore.setState({
    ...state,
    project: {
      ...state.project,
      data: {
        ...state.project.data,
        pous: pous.map((p) => ({ name: p.name, interface: { variables: p.variables } })),
        configurations: { resource: { globalVariables: globals } },
      },
    },
  } as never)
}

describe('useDuplicateOutputLocations', () => {
  it('reports both declarations of one output, with their POUs', () => {
    withProject([
      { name: 'motor', variables: [variable('run', '%QX0.0')] },
      { name: 'pump', variables: [variable('start', '%QX0.0')] },
    ])
    const { result } = renderHook(() => useDuplicateOutputLocations())
    expect(result.current.get('%QX0.0')).toEqual([
      { scope: 'motor', name: 'run' },
      { scope: 'pump', name: 'start' },
    ])
  })

  it('keeps both when the two variables share a NAME', () => {
    // The case that emptied the tooltip. `run` in two POUs is ordinary.
    withProject([
      { name: 'motor', variables: [variable('run', '%QX0.0')] },
      { name: 'pump', variables: [variable('run', '%QX0.0')] },
    ])
    const { result } = renderHook(() => useDuplicateOutputLocations())
    const writers = result.current.get('%QX0.0') ?? []
    expect(writers).toHaveLength(2)
    // Excluding "myself in motor" still leaves the other one.
    expect(writers.filter((w) => !(w.name === 'run' && w.scope === 'motor'))).toEqual([
      { scope: 'pump', name: 'run' },
    ])
  })

  it('names the configuration global scope', () => {
    withProject([{ name: 'main', variables: [variable('local', '%QW3')] }], [variable('shared', '%QW3')])
    const { result } = renderHook(() => useDuplicateOutputLocations())
    expect(result.current.get('%QW3')).toEqual([
      { scope: 'main', name: 'local' },
      { scope: 'Global Variables', name: 'shared' },
    ])
  })

  it('ignores inputs and memory', () => {
    // Two POUs reading one input is ordinary, and sharing a memory address is
    // what memory is for.
    withProject([
      { name: 'a', variables: [variable('x', '%IX0.0'), variable('y', '%MW7')] },
      { name: 'b', variables: [variable('x', '%IX0.0'), variable('y', '%MW7')] },
    ])
    const { result } = renderHook(() => useDuplicateOutputLocations())
    expect(result.current.get('%IX0.0')).toBeUndefined()
    expect(result.current.get('%MW7')).toBeUndefined()
  })

  it('ignores an alias, which is not a literal address', () => {
    withProject([{ name: 'a', variables: [variable('x', 'MOTOR_RUN')] }])
    const { result } = renderHook(() => useDuplicateOutputLocations())
    expect(result.current.size).toBe(0)
  })

  it('reports a single declaration too, so the caller decides what is a clash', () => {
    withProject([{ name: 'a', variables: [variable('x', '%QW0')] }])
    const { result } = renderHook(() => useDuplicateOutputLocations())
    expect(result.current.get('%QW0')).toHaveLength(1)
  })
})
