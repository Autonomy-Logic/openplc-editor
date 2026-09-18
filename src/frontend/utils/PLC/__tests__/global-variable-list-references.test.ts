import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { findGlobalVariableListReferences, renameGlobalVariableListInPou } from '../global-variable-list-references'

/**
 * Renaming a Global Variable List has to carry every `GVL.Member` with it.
 *
 * The failure it prevents is silent by construction: the `VAR_EXTERNAL` a POU needs is
 * only emitted for lists that POU actually mentions, so a reference left pointing at the
 * old name simply stops resolving — no warning at rename time, and a compiler error much
 * later against a name the user no longer sees anywhere.
 */
const stPou = (name: string, body: string): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables: [] },
  body: { language: 'st', value: body },
})

const ladderPou = (name: string, variableName: string): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables: [] },
  body: {
    language: 'ld',
    value: {
      rungs: [
        {
          id: 'rung-1',
          comment: '',
          reactFlowViewport: [0, 0, 1],
          nodes: [
            { id: 'contact-1', type: 'contact', position: { x: 0, y: 0 }, data: { variable: { name: variableName } } },
          ],
          edges: [],
        },
      ],
    },
  },
})

describe('findGlobalVariableListReferences', () => {
  it('counts every qualified reference, per POU', () => {
    const pous = [stPou('Main', 'GVL.A := TRUE;\nGVL.B := 1;'), stPou('Other', 'x := 1;')]

    const impact = findGlobalVariableListReferences('GVL', pous)

    expect(impact.totalReferences).toBe(2)
    expect([...impact.byPou]).toEqual([['Main', 2]])
  })

  it('finds a reference living in a ladder node rather than in any body text', () => {
    // This is why detection runs on the serialised POU: a graphical body is a node
    // graph, and the reference is a node's variable name.
    const impact = findGlobalVariableListReferences('GVL', [ladderPou('Rungs', 'GVL.Output1')])

    expect(impact.totalReferences).toBe(1)
  })

  it('does not match a list whose name merely prefixes another', () => {
    expect(findGlobalVariableListReferences('GVL', [stPou('Main', 'GVL_OTHER.A := 1;')]).totalReferences).toBe(0)
  })

  it('does not match member access on something else', () => {
    expect(findGlobalVariableListReferences('GVL', [stPou('Main', 'other.GVL.A := 1;')]).totalReferences).toBe(0)
  })

  it('matches regardless of case', () => {
    expect(findGlobalVariableListReferences('GVL', [stPou('Main', 'gvl.a := TRUE;')]).totalReferences).toBe(1)
  })

  it('finds a reference that starts a line', () => {
    // The scan must not run over `JSON.stringify(pou)`: JSON escapes the newline to
    // `\` + `n`, and `n` is a word character, so the `[^\w.]` guard rejects the match
    // and every reference beginning a line becomes invisible.
    const impact = findGlobalVariableListReferences('GVL', [stPou('Main', 'x := 1;\nGVL.A := 2;')])

    expect(impact.totalReferences).toBe(1)
  })
})

describe('renameGlobalVariableListInPou', () => {
  it('rewrites every reference in a textual body', () => {
    const renamed = renameGlobalVariableListInPou(stPou('Main', 'GVL.A := TRUE;\nGVL.B := 1;'), 'GVL', 'Globals')

    expect(renamed?.body.value).toBe('Globals.A := TRUE;\nGlobals.B := 1;')
  })

  it('rewrites a reference held in a ladder node', () => {
    const renamed = renameGlobalVariableListInPou(ladderPou('Rungs', 'GVL.Output1'), 'GVL', 'Globals')

    expect(JSON.stringify(renamed)).toContain('Globals.Output1')
    expect(JSON.stringify(renamed)).not.toContain('GVL.Output1')
  })

  it('returns null for a POU that never mentions the list', () => {
    expect(renameGlobalVariableListInPou(stPou('Other', 'x := y + 1;'), 'GVL', 'Globals')).toBeNull()
  })

  it('leaves a name that merely prefixes the list alone', () => {
    const renamed = renameGlobalVariableListInPou(stPou('Main', 'GVL.A := GVL_OTHER.B;'), 'GVL', 'Globals')

    expect(renamed?.body.value).toBe('Globals.A := GVL_OTHER.B;')
  })

  it('rewrites case-insensitively but writes the new name as given', () => {
    const renamed = renameGlobalVariableListInPou(stPou('Main', 'gvl.a := TRUE;'), 'GVL', 'Globals')

    expect(renamed?.body.value).toBe('Globals.a := TRUE;')
  })

  it('rewrites back-to-back references', () => {
    // A global regex whose match consumes the separator could skip the second of two
    // references only one character apart.
    const renamed = renameGlobalVariableListInPou(stPou('Main', 'x := GVL.A + GVL.B;'), 'GVL', 'G2')

    expect(renamed?.body.value).toBe('x := G2.A + G2.B;')
  })

  it('preserves everything else about the POU', () => {
    const renamed = renameGlobalVariableListInPou(stPou('Main', 'GVL.A := TRUE;'), 'GVL', 'Globals')

    expect(renamed?.name).toBe('Main')
    expect(renamed?.pouType).toBe('program')
  })
})
