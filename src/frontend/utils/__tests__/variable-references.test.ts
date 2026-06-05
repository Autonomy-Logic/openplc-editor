import type { Node } from '@xyflow/react'

import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { VariableReferenceLocation } from '../variable-references'
import {
  findAllReferencesToVariable,
  propagateVariableRename,
  propagateVariableTypeChange,
  validateVariableReference,
} from '../variable-references'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LadderRung = { id: string; nodes: Node[] }
type LadderFlow = { name: string; rungs: LadderRung[] }
type FBDFlow = { name: string; rung: { nodes: Node[] } }

function makeNode(id: string, type: string, data: Record<string, unknown>): Node {
  return { id, type, data, position: { x: 0, y: 0 } } as Node
}

function makeVariable(name: string, overrides: Partial<PLCVariable> = {}): PLCVariable {
  return {
    name,
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
    ...overrides,
  }
}

function makePou(name: string, language: string, bodyValue: unknown, variables: PLCVariable[] = []): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables },
    body: { language: language as PLCPou['body']['language'], value: bodyValue },
  }
}

// ---------------------------------------------------------------------------
// findAllReferencesToVariable — local scope (no ladder/fbd)
// ---------------------------------------------------------------------------

describe('findAllReferencesToVariable', () => {
  describe('local scope — POU not found', () => {
    it('returns empty analysis when the POU does not exist', () => {
      const result = findAllReferencesToVariable('x', { definition: 'base-type', value: 'INT' }, 'Missing', [], [], [])
      expect(result.totalReferences).toBe(0)
      expect(result.references).toEqual([])
    })
  })

  describe('local scope — textual references (ST)', () => {
    it('finds references in ST body text', () => {
      const pous = [makePou('P1', 'st', 'x := x + 1;\ny := x;')]
      const result = findAllReferencesToVariable('x', { definition: 'base-type', value: 'INT' }, 'P1', pous, [], [])
      expect(result.totalReferences).toBe(3)
      expect(result.references[0].editorType).toBe('st')
      expect(result.references[0].lineNumber).toBe(1)
    })

    it('finds references in IL body text', () => {
      const pous = [makePou('P1', 'il', 'LD x\nST y')]
      const result = findAllReferencesToVariable('x', { definition: 'base-type', value: 'INT' }, 'P1', pous, [], [])
      expect(result.totalReferences).toBe(1)
      expect(result.references[0].editorType).toBe('il')
    })

    it('finds references in python body text', () => {
      const pous = [makePou('P1', 'python', 'x = x + 1')]
      const result = findAllReferencesToVariable('x', { definition: 'base-type', value: 'INT' }, 'P1', pous, [], [])
      expect(result.totalReferences).toBe(2)
      expect(result.references[0].editorType).toBe('python')
    })

    it('finds references in cpp body text', () => {
      const pous = [makePou('P1', 'cpp', 'int x = x + 1;')]
      const result = findAllReferencesToVariable('x', { definition: 'base-type', value: 'INT' }, 'P1', pous, [], [])
      expect(result.totalReferences).toBe(2)
      expect(result.references[0].editorType).toBe('cpp')
    })

    it('populates byPou and byEditorType maps correctly', () => {
      const pous = [makePou('P1', 'st', 'x := 1;')]
      const result = findAllReferencesToVariable('x', { definition: 'base-type', value: 'INT' }, 'P1', pous, [], [])
      expect(result.byPou.get('P1')).toBe(1)
      expect(result.byEditorType.get('st')).toBe(1)
    })
  })

  describe('local scope — ladder references', () => {
    it('finds contact/coil references', () => {
      const ladderFlows: LadderFlow[] = [
        {
          name: 'P1',
          rungs: [
            {
              id: 'r1',
              nodes: [
                makeNode('n1', 'contact', { variable: { name: 'myVar' } }),
                makeNode('n2', 'coil', { variable: { name: 'myVar' } }),
                makeNode('n3', 'contact', { variable: { name: 'other' } }),
              ],
            },
          ],
        },
      ]
      const pous = [makePou('P1', 'ld', {})]
      const result = findAllReferencesToVariable(
        'myVar',
        { definition: 'base-type', value: 'BOOL' },
        'P1',
        pous,
        ladderFlows,
        [],
      )
      expect(result.totalReferences).toBe(2)
      expect(result.references[0].elementType).toBe('contact')
      expect(result.references[1].elementType).toBe('coil')
    })

    it('finds block instance and block connection references', () => {
      const ladderFlows: LadderFlow[] = [
        {
          name: 'P1',
          rungs: [
            {
              id: 'r1',
              nodes: [
                makeNode('n1', 'block', {
                  variable: { name: 'myVar' },
                  connectedVariables: [
                    { handleId: 'h1', variable: { name: 'myVar' } },
                    { handleId: 'h2', variable: { name: 'other' } },
                  ],
                }),
              ],
            },
          ],
        },
      ]
      const pous = [makePou('P1', 'ld', {})]
      const result = findAllReferencesToVariable(
        'myVar',
        { definition: 'base-type', value: 'INT' },
        'P1',
        pous,
        ladderFlows,
        [],
      )
      expect(result.totalReferences).toBe(2)
      expect(result.references.some((r) => r.elementType === 'block-instance')).toBe(true)
      expect(result.references.some((r) => r.elementType === 'block-connection')).toBe(true)
    })

    it('finds variable node references in ladder', () => {
      const ladderFlows: LadderFlow[] = [
        {
          name: 'P1',
          rungs: [{ id: 'r1', nodes: [makeNode('n1', 'variable', { variable: { name: 'myVar' } })] }],
        },
      ]
      const pous = [makePou('P1', 'ld', {})]
      const result = findAllReferencesToVariable(
        'myVar',
        { definition: 'base-type', value: 'INT' },
        'P1',
        pous,
        ladderFlows,
        [],
      )
      expect(result.totalReferences).toBe(1)
      expect(result.references[0].elementType).toBe('variable')
    })
  })

  describe('local scope — FBD references', () => {
    it('finds contact/coil references in FBD', () => {
      const fbdFlows: FBDFlow[] = [
        {
          name: 'P1',
          rung: {
            nodes: [
              makeNode('n1', 'contact', { variable: { name: 'myVar' } }),
              makeNode('n2', 'coil', { variable: { name: 'myVar' } }),
            ],
          },
        },
      ]
      const pous = [makePou('P1', 'fbd', {})]
      const result = findAllReferencesToVariable(
        'myVar',
        { definition: 'base-type', value: 'BOOL' },
        'P1',
        pous,
        [],
        fbdFlows,
      )
      expect(result.totalReferences).toBe(2)
      expect(result.references[0].editorType).toBe('fbd')
    })

    it('finds block instance and block connection references in FBD', () => {
      const fbdFlows: FBDFlow[] = [
        {
          name: 'P1',
          rung: {
            nodes: [
              makeNode('n1', 'block', {
                variable: { name: 'myVar' },
                connectedVariables: [{ handleId: 'h1', variable: { name: 'myVar' } }],
              }),
            ],
          },
        },
      ]
      const pous = [makePou('P1', 'fbd', {})]
      const result = findAllReferencesToVariable(
        'myVar',
        { definition: 'base-type', value: 'INT' },
        'P1',
        pous,
        [],
        fbdFlows,
      )
      expect(result.totalReferences).toBe(2)
    })

    it('finds variable/input-variable/output-variable/inout-variable nodes in FBD', () => {
      const types = ['variable', 'input-variable', 'output-variable', 'inout-variable']
      const nodes = types.map((t, i) => makeNode(`n${i}`, t, { variable: { name: 'x' } }))
      const fbdFlows: FBDFlow[] = [{ name: 'P1', rung: { nodes } }]
      const pous = [makePou('P1', 'fbd', {})]
      const result = findAllReferencesToVariable(
        'x',
        { definition: 'base-type', value: 'INT' },
        'P1',
        pous,
        [],
        fbdFlows,
      )
      expect(result.totalReferences).toBe(4)
    })
  })

  describe('global scope', () => {
    it('searches all POUs that have a matching external variable', () => {
      const pous = [
        makePou('P1', 'st', 'x := 1;', [makeVariable('x', { class: 'external' })]),
        makePou('P2', 'st', 'x := 2;', [makeVariable('x', { class: 'external' })]),
        makePou('P3', 'st', 'x := 3;', [makeVariable('y', { class: 'external' })]),
      ]
      const result = findAllReferencesToVariable(
        'x',
        { definition: 'base-type', value: 'INT' },
        '',
        pous,
        [],
        [],
        'global',
      )
      // P1 has 1 ref, P2 has 1 ref, P3 has no external x
      expect(result.totalReferences).toBe(2)
      expect(result.byPou.get('P1')).toBe(1)
      expect(result.byPou.get('P2')).toBe(1)
    })

    it('returns empty when no pous have matching external variable', () => {
      const pous = [makePou('P1', 'st', 'a := 1;', [makeVariable('a', { class: 'local' })])]
      const result = findAllReferencesToVariable(
        'x',
        { definition: 'base-type', value: 'INT' },
        '',
        pous,
        [],
        [],
        'global',
      )
      expect(result.totalReferences).toBe(0)
    })

    it('handles POUs with no interface in global scope search', () => {
      const pou: PLCPou = {
        name: 'NoInterface',
        pouType: 'program',
        body: { language: 'st', value: 'x := 1;' },
      }
      const result = findAllReferencesToVariable(
        'x',
        { definition: 'base-type', value: 'INT' },
        '',
        [pou],
        [],
        [],
        'global',
      )
      expect(result.totalReferences).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// propagateVariableTypeChange
// ---------------------------------------------------------------------------

describe('propagateVariableTypeChange', () => {
  it('calls updateVariable for each matching external variable', () => {
    const pous: PLCPou[] = [
      makePou('P1', 'st', '', [
        makeVariable('myGlobal', { class: 'external' }),
        makeVariable('other', { class: 'local' }),
      ]),
      makePou('P2', 'st', '', [makeVariable('myGlobal', { class: 'external' })]),
    ]
    const calls: unknown[] = []
    const projectActions = {
      updateVariable: (params: unknown) => calls.push(params),
    }
    const newType = { definition: 'base-type' as const, value: 'REAL' }

    propagateVariableTypeChange('myGlobal', newType, pous, projectActions)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      scope: 'local',
      rowId: 0,
      associatedPou: 'P1',
      data: { type: newType },
    })
    expect(calls[1]).toEqual({
      scope: 'local',
      rowId: 0,
      associatedPou: 'P2',
      data: { type: newType },
    })
  })

  it('does nothing when no external variables match', () => {
    const pous: PLCPou[] = [makePou('P1', 'st', '', [makeVariable('x', { class: 'local' })])]
    const calls: unknown[] = []
    const projectActions = { updateVariable: (p: unknown) => calls.push(p) }
    propagateVariableTypeChange('x', { definition: 'base-type', value: 'INT' }, pous, projectActions)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// propagateVariableRename
// ---------------------------------------------------------------------------

describe('propagateVariableRename', () => {
  describe('global scope — rename external variables', () => {
    it('renames matching external variables in POUs', () => {
      const pous: PLCPou[] = [makePou('P1', 'st', '', [makeVariable('oldName', { class: 'external' })])]
      const calls: unknown[] = []
      const projectActions = {
        updateVariable: (p: unknown) => calls.push(p),
        updatePou: () => {},
      }
      propagateVariableRename(
        'oldName',
        'newName',
        [],
        [],
        [],
        pous,
        { updateNode: () => {} },
        { updateNode: () => {} },
        projectActions,
        'global',
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        scope: 'local',
        rowId: 0,
        associatedPou: 'P1',
        data: { name: 'newName' },
      })
    })
  })

  describe('text-based references', () => {
    it('replaces variable name in ST POU body', () => {
      const pous: PLCPou[] = [makePou('P1', 'st', 'oldVar := oldVar + 1;')]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'st', lineNumber: 1, columnStart: 0, columnEnd: 6 },
      ]
      const pouCalls: unknown[] = []
      const projectActions = {
        updateVariable: () => {},
        updatePou: (p: unknown) => pouCalls.push(p),
      }
      propagateVariableRename(
        'oldVar',
        'newVar',
        refs,
        [],
        [],
        pous,
        { updateNode: () => {} },
        { updateNode: () => {} },
        projectActions,
      )
      expect(pouCalls).toHaveLength(1)
      expect((pouCalls[0] as { content: { value: string } }).content.value).toBe('newVar := newVar + 1;')
    })

    it('handles IL, python, cpp language text replacement', () => {
      const languages = ['il', 'python', 'cpp'] as const
      languages.forEach((lang) => {
        const pous = [makePou('P1', lang, 'x := x + 1;')]
        const refs: VariableReferenceLocation[] = [{ pouName: 'P1', editorType: lang }]
        const pouCalls: unknown[] = []
        const projectActions = {
          updateVariable: () => {},
          updatePou: (p: unknown) => pouCalls.push(p),
        }
        propagateVariableRename(
          'x',
          'y',
          refs,
          [],
          [],
          pous,
          { updateNode: () => {} },
          { updateNode: () => {} },
          projectActions,
        )
        expect(pouCalls.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('skips POUs not found', () => {
      const refs: VariableReferenceLocation[] = [{ pouName: 'Missing', editorType: 'st' }]
      const pouCalls: unknown[] = []
      const projectActions = {
        updateVariable: () => {},
        updatePou: (p: unknown) => pouCalls.push(p),
      }
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        [],
        [],
        { updateNode: () => {} },
        { updateNode: () => {} },
        projectActions,
      )
      expect(pouCalls).toHaveLength(0)
    })

    it('skips POUs with non-string body value', () => {
      const pous = [makePou('P1', 'st', { nodes: [] })]
      const refs: VariableReferenceLocation[] = [{ pouName: 'P1', editorType: 'st' }]
      const pouCalls: unknown[] = []
      const projectActions = {
        updateVariable: () => {},
        updatePou: (p: unknown) => pouCalls.push(p),
      }
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        [],
        pous,
        { updateNode: () => {} },
        { updateNode: () => {} },
        projectActions,
      )
      expect(pouCalls).toHaveLength(0)
    })

    it('skips POUs with non-textual language', () => {
      const pous = [makePou('P1', 'ld', 'x := 1;')]
      const refs: VariableReferenceLocation[] = [{ pouName: 'P1', editorType: 'st' }]
      const pouCalls: unknown[] = []
      const projectActions = {
        updateVariable: () => {},
        updatePou: (p: unknown) => pouCalls.push(p),
      }
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        [],
        pous,
        { updateNode: () => {} },
        { updateNode: () => {} },
        projectActions,
      )
      expect(pouCalls).toHaveLength(0)
    })

    it('handles regex errors gracefully', () => {
      const pous = [makePou('P1', 'st', 'val := 1;')]
      // Use a variable name that would cause regex issues
      const refs: VariableReferenceLocation[] = [{ pouName: 'P1', editorType: 'st' }]
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const projectActions = {
        updateVariable: () => {},
        updatePou: () => {
          throw new Error('regex fail')
        },
      }
      // Should not throw
      propagateVariableRename(
        'val',
        'newVal',
        refs,
        [],
        [],
        pous,
        { updateNode: () => {} },
        { updateNode: () => {} },
        projectActions,
      )
      consoleErrorSpy.mockRestore()
    })
  })

  describe('ladder graphical references', () => {
    it('renames contact/coil/variable nodes', () => {
      const ladderFlows: LadderFlow[] = [
        {
          name: 'P1',
          rungs: [
            {
              id: 'r1',
              nodes: [
                makeNode('n1', 'contact', { variable: { name: 'oldName' } }),
                makeNode('n2', 'coil', { variable: { name: 'oldName' } }),
                makeNode('n3', 'variable', { variable: { name: 'oldName' } }),
              ],
            },
          ],
        },
      ]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n1', rungId: 'r1', elementType: 'contact' },
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n2', rungId: 'r1', elementType: 'coil' },
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n3', rungId: 'r1', elementType: 'variable' },
      ]
      const updateCalls: unknown[] = []
      const ladderFlowActions = { updateNode: (p: unknown) => updateCalls.push(p) }
      propagateVariableRename(
        'oldName',
        'newName',
        refs,
        ladderFlows,
        [],
        [],
        ladderFlowActions,
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(3)
    })

    it('renames block-instance nodes in ladder', () => {
      const ladderFlows: LadderFlow[] = [
        {
          name: 'P1',
          rungs: [{ id: 'r1', nodes: [makeNode('n1', 'block', { variable: { name: 'oldName' } })] }],
        },
      ]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n1', rungId: 'r1', elementType: 'block-instance' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'oldName',
        'newName',
        refs,
        ladderFlows,
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(1)
    })

    it('renames block-connection nodes in ladder', () => {
      const ladderFlows: LadderFlow[] = [
        {
          name: 'P1',
          rungs: [
            {
              id: 'r1',
              nodes: [
                makeNode('n1', 'block', {
                  connectedVariables: [
                    {
                      handleId: 'h1',
                      variable: {
                        name: 'oldName',
                        type: { definition: 'base-type', value: 'INT' },
                        location: '',
                        documentation: '',
                      },
                    },
                  ],
                }),
              ],
            },
          ],
        },
      ]
      const refs: VariableReferenceLocation[] = [
        {
          pouName: 'P1',
          editorType: 'ladder',
          nodeId: 'n1',
          rungId: 'r1',
          elementType: 'block-connection',
          connectionIndex: 0,
        },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'oldName',
        'newName',
        refs,
        ladderFlows,
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(1)
    })

    it('skips ladder ref when flow is not found', () => {
      const refs: VariableReferenceLocation[] = [
        { pouName: 'Missing', editorType: 'ladder', nodeId: 'n1', rungId: 'r1', elementType: 'contact' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips ladder ref when rung is not found', () => {
      const ladderFlows: LadderFlow[] = [{ name: 'P1', rungs: [{ id: 'r2', nodes: [] }] }]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n1', rungId: 'r1', elementType: 'contact' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        ladderFlows,
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips ladder ref when node is not found', () => {
      const ladderFlows: LadderFlow[] = [{ name: 'P1', rungs: [{ id: 'r1', nodes: [makeNode('n99', 'contact', {})] }] }]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n1', rungId: 'r1', elementType: 'contact' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        ladderFlows,
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips contact/coil/variable rename when node has no variable', () => {
      const ladderFlows: LadderFlow[] = [{ name: 'P1', rungs: [{ id: 'r1', nodes: [makeNode('n1', 'contact', {})] }] }]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n1', rungId: 'r1', elementType: 'contact' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        ladderFlows,
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips block-instance rename when node has no variable', () => {
      const ladderFlows: LadderFlow[] = [{ name: 'P1', rungs: [{ id: 'r1', nodes: [makeNode('n1', 'block', {})] }] }]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'ladder', nodeId: 'n1', rungId: 'r1', elementType: 'block-instance' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        ladderFlows,
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips block-connection rename when connectedVariables is missing or index has no variable', () => {
      const ladderFlows: LadderFlow[] = [
        {
          name: 'P1',
          rungs: [{ id: 'r1', nodes: [makeNode('n1', 'block', { connectedVariables: [{ handleId: 'h1' }] })] }],
        },
      ]
      const refs: VariableReferenceLocation[] = [
        {
          pouName: 'P1',
          editorType: 'ladder',
          nodeId: 'n1',
          rungId: 'r1',
          elementType: 'block-connection',
          connectionIndex: 0,
        },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        ladderFlows,
        [],
        [],
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateNode: () => {} },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })
  })

  describe('FBD graphical references', () => {
    it('renames contact/coil/variable nodes in FBD', () => {
      const fbdFlows: FBDFlow[] = [
        {
          name: 'P1',
          rung: {
            nodes: [
              makeNode('n1', 'contact', { variable: { name: 'oldName' } }),
              makeNode('n2', 'variable', { variable: { name: 'oldName' } }),
            ],
          },
        },
      ]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n1', elementType: 'contact' },
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n2', elementType: 'variable' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'oldName',
        'newName',
        refs,
        [],
        fbdFlows,
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(2)
    })

    it('renames block-instance nodes in FBD', () => {
      const fbdFlows: FBDFlow[] = [
        {
          name: 'P1',
          rung: { nodes: [makeNode('n1', 'block', { variable: { name: 'oldName' } })] },
        },
      ]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n1', elementType: 'block-instance' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'oldName',
        'newName',
        refs,
        [],
        fbdFlows,
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(1)
    })

    it('renames block-connection nodes in FBD', () => {
      const fbdFlows: FBDFlow[] = [
        {
          name: 'P1',
          rung: {
            nodes: [
              makeNode('n1', 'block', {
                connectedVariables: [
                  {
                    handleId: 'h1',
                    variable: {
                      name: 'oldName',
                      type: { definition: 'base-type', value: 'INT' },
                      location: '',
                      documentation: '',
                    },
                  },
                ],
              }),
            ],
          },
        },
      ]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n1', elementType: 'block-connection', connectionIndex: 0 },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'oldName',
        'newName',
        refs,
        [],
        fbdFlows,
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(1)
    })

    it('skips FBD ref when flow is not found', () => {
      const refs: VariableReferenceLocation[] = [
        { pouName: 'Missing', editorType: 'fbd', nodeId: 'n1', elementType: 'contact' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        [],
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips FBD ref when node is not found', () => {
      const fbdFlows: FBDFlow[] = [{ name: 'P1', rung: { nodes: [] } }]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n1', elementType: 'contact' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        fbdFlows,
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips FBD contact/coil/variable rename when node has no variable', () => {
      const fbdFlows: FBDFlow[] = [{ name: 'P1', rung: { nodes: [makeNode('n1', 'coil', {})] } }]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n1', elementType: 'coil' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        fbdFlows,
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips FBD block-instance rename when node has no variable', () => {
      const fbdFlows: FBDFlow[] = [{ name: 'P1', rung: { nodes: [makeNode('n1', 'block', {})] } }]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n1', elementType: 'block-instance' },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        fbdFlows,
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })

    it('skips FBD block-connection rename when connectedVariables missing or no variable at index', () => {
      const fbdFlows: FBDFlow[] = [
        { name: 'P1', rung: { nodes: [makeNode('n1', 'block', { connectedVariables: [{ handleId: 'h1' }] })] } },
      ]
      const refs: VariableReferenceLocation[] = [
        { pouName: 'P1', editorType: 'fbd', nodeId: 'n1', elementType: 'block-connection', connectionIndex: 0 },
      ]
      const updateCalls: unknown[] = []
      propagateVariableRename(
        'x',
        'y',
        refs,
        [],
        fbdFlows,
        [],
        { updateNode: () => {} },
        { updateNode: (p: unknown) => updateCalls.push(p) },
        { updateVariable: () => {}, updatePou: () => {} },
      )
      expect(updateCalls).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// findAllReferencesToVariable — uncovered false branches
// ---------------------------------------------------------------------------

describe('findAllReferencesToVariable — uncovered false branches', () => {
  it('skips ladder block nodes whose variable name does not match', () => {
    const ladderFlows: LadderFlow[] = [
      {
        name: 'P1',
        rungs: [
          {
            id: 'r1',
            nodes: [
              makeNode('n1', 'block', {
                variable: { name: 'otherVar' },
                connectedVariables: [{ handleId: 'h1', variable: { name: 'alsoOther' } }],
              }),
            ],
          },
        ],
      },
    ]
    const pous = [makePou('P1', 'ld', {})]
    const result = findAllReferencesToVariable(
      'myVar',
      { definition: 'base-type', value: 'INT' },
      'P1',
      pous,
      ladderFlows,
      [],
    )
    expect(result.totalReferences).toBe(0)
  })

  it('skips ladder variable nodes whose variable name does not match', () => {
    const ladderFlows: LadderFlow[] = [
      {
        name: 'P1',
        rungs: [{ id: 'r1', nodes: [makeNode('n1', 'variable', { variable: { name: 'other' } })] }],
      },
    ]
    const pous = [makePou('P1', 'ld', {})]
    const result = findAllReferencesToVariable(
      'myVar',
      { definition: 'base-type', value: 'INT' },
      'P1',
      pous,
      ladderFlows,
      [],
    )
    expect(result.totalReferences).toBe(0)
  })

  it('skips FBD contact/coil nodes whose variable name does not match', () => {
    const fbdFlows: FBDFlow[] = [
      {
        name: 'P1',
        rung: {
          nodes: [
            makeNode('n1', 'contact', { variable: { name: 'other' } }),
            makeNode('n2', 'coil', { variable: { name: 'other' } }),
          ],
        },
      },
    ]
    const pous = [makePou('P1', 'fbd', {})]
    const result = findAllReferencesToVariable(
      'myVar',
      { definition: 'base-type', value: 'BOOL' },
      'P1',
      pous,
      [],
      fbdFlows,
    )
    expect(result.totalReferences).toBe(0)
  })

  it('skips FBD block nodes whose variable/connection names do not match', () => {
    const fbdFlows: FBDFlow[] = [
      {
        name: 'P1',
        rung: {
          nodes: [
            makeNode('n1', 'block', {
              variable: { name: 'other' },
              connectedVariables: [{ handleId: 'h1', variable: { name: 'alsoOther' } }],
            }),
          ],
        },
      },
    ]
    const pous = [makePou('P1', 'fbd', {})]
    const result = findAllReferencesToVariable(
      'myVar',
      { definition: 'base-type', value: 'INT' },
      'P1',
      pous,
      [],
      fbdFlows,
    )
    expect(result.totalReferences).toBe(0)
  })

  it('skips FBD variable/input-variable/output-variable/inout-variable nodes whose name does not match', () => {
    const types = ['variable', 'input-variable', 'output-variable', 'inout-variable']
    const nodes = types.map((t, i) => makeNode(`n${i}`, t, { variable: { name: 'other' } }))
    const fbdFlows: FBDFlow[] = [{ name: 'P1', rung: { nodes } }]
    const pous = [makePou('P1', 'fbd', {})]
    const result = findAllReferencesToVariable(
      'myVar',
      { definition: 'base-type', value: 'INT' },
      'P1',
      pous,
      [],
      fbdFlows,
    )
    expect(result.totalReferences).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// propagateVariableTypeChange — uncovered false branches
// ---------------------------------------------------------------------------

describe('propagateVariableTypeChange — uncovered false branches', () => {
  it('skips external variables whose name does not match', () => {
    const pous: PLCPou[] = [
      makePou('P1', 'st', '', [
        makeVariable('notMatching', { class: 'external' }),
        makeVariable('alsoNotMatching', { class: 'external' }),
      ]),
    ]
    const calls: unknown[] = []
    const projectActions = { updateVariable: (p: unknown) => calls.push(p) }
    propagateVariableTypeChange('target', { definition: 'base-type', value: 'REAL' }, pous, projectActions)
    expect(calls).toHaveLength(0)
  })

  it('handles POUs with no interface (variables fallback to empty)', () => {
    const pou: PLCPou = {
      name: 'Empty',
      pouType: 'program',
      body: { language: 'st', value: '' },
    }
    const calls: unknown[] = []
    const projectActions = { updateVariable: (p: unknown) => calls.push(p) }
    propagateVariableTypeChange('x', { definition: 'base-type', value: 'REAL' }, [pou], projectActions)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// propagateVariableRename — uncovered false branches
// ---------------------------------------------------------------------------

describe('propagateVariableRename — uncovered false branches', () => {
  it('skips external variables in global scope whose name does not match', () => {
    const pous: PLCPou[] = [makePou('P1', 'st', '', [makeVariable('notMatching', { class: 'external' })])]
    const calls: unknown[] = []
    const projectActions = {
      updateVariable: (p: unknown) => calls.push(p),
      updatePou: () => {},
    }
    propagateVariableRename(
      'oldName',
      'newName',
      [],
      [],
      [],
      pous,
      { updateNode: () => {} },
      { updateNode: () => {} },
      projectActions,
      'global',
    )
    expect(calls).toHaveLength(0)
  })

  it('handles POUs with no interface in global rename (variables fallback to empty)', () => {
    const pou: PLCPou = {
      name: 'Empty',
      pouType: 'program',
      body: { language: 'st', value: '' },
    }
    const calls: unknown[] = []
    const projectActions = {
      updateVariable: (p: unknown) => calls.push(p),
      updatePou: () => {},
    }
    propagateVariableRename(
      'oldName',
      'newName',
      [],
      [],
      [],
      [pou],
      { updateNode: () => {} },
      { updateNode: () => {} },
      projectActions,
      'global',
    )
    expect(calls).toHaveLength(0)
  })

  it('skips ladder block-connection ref when connectionIndex is undefined', () => {
    const ladderFlows: LadderFlow[] = [
      {
        name: 'P1',
        rungs: [
          {
            id: 'r1',
            nodes: [
              makeNode('n1', 'block', {
                connectedVariables: [
                  {
                    handleId: 'h1',
                    variable: {
                      name: 'oldName',
                      type: { definition: 'base-type', value: 'INT' },
                      location: '',
                      documentation: '',
                    },
                  },
                ],
              }),
            ],
          },
        ],
      },
    ]
    const refs: VariableReferenceLocation[] = [
      {
        pouName: 'P1',
        editorType: 'ladder',
        nodeId: 'n1',
        rungId: 'r1',
        elementType: 'block-connection',
        // connectionIndex is undefined
      },
    ]
    const updateCalls: unknown[] = []
    propagateVariableRename(
      'oldName',
      'newName',
      refs,
      ladderFlows,
      [],
      [],
      { updateNode: (p: unknown) => updateCalls.push(p) },
      { updateNode: () => {} },
      { updateVariable: () => {}, updatePou: () => {} },
    )
    expect(updateCalls).toHaveLength(0)
  })

  it('skips graphical ref when editorType is neither ladder nor fbd', () => {
    const refs: VariableReferenceLocation[] = [
      // editorType 'ladder' but no nodeId - should not match ladder branch
      { pouName: 'P1', editorType: 'ladder', rungId: 'r1', elementType: 'contact' },
    ]
    const updateCalls: unknown[] = []
    propagateVariableRename(
      'x',
      'y',
      refs,
      [],
      [],
      [],
      { updateNode: (p: unknown) => updateCalls.push(p) },
      { updateNode: (p: unknown) => updateCalls.push(p) },
      { updateVariable: () => {}, updatePou: () => {} },
    )
    expect(updateCalls).toHaveLength(0)
  })

  it('skips FBD ref when nodeId is missing', () => {
    const refs: VariableReferenceLocation[] = [{ pouName: 'P1', editorType: 'fbd', elementType: 'contact' }]
    const updateCalls: unknown[] = []
    propagateVariableRename(
      'x',
      'y',
      refs,
      [],
      [],
      [],
      { updateNode: () => {} },
      { updateNode: (p: unknown) => updateCalls.push(p) },
      { updateVariable: () => {}, updatePou: () => {} },
    )
    expect(updateCalls).toHaveLength(0)
  })

  it('skips FBD block-connection ref when connectionIndex is undefined', () => {
    const fbdFlows: FBDFlow[] = [
      {
        name: 'P1',
        rung: {
          nodes: [
            makeNode('n1', 'block', {
              connectedVariables: [
                {
                  handleId: 'h1',
                  variable: {
                    name: 'oldName',
                    type: { definition: 'base-type', value: 'INT' },
                    location: '',
                    documentation: '',
                  },
                },
              ],
            }),
          ],
        },
      },
    ]
    const refs: VariableReferenceLocation[] = [
      {
        pouName: 'P1',
        editorType: 'fbd',
        nodeId: 'n1',
        elementType: 'block-connection',
        // connectionIndex is undefined
      },
    ]
    const updateCalls: unknown[] = []
    propagateVariableRename(
      'oldName',
      'newName',
      refs,
      [],
      fbdFlows,
      [],
      { updateNode: () => {} },
      { updateNode: (p: unknown) => updateCalls.push(p) },
      { updateVariable: () => {}, updatePou: () => {} },
    )
    expect(updateCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// validateVariableReference
// ---------------------------------------------------------------------------

describe('validateVariableReference', () => {
  const variables: PLCVariable[] = [
    makeVariable('myVar', { type: { definition: 'base-type', value: 'INT' } }),
    makeVariable('boolVar', { type: { definition: 'base-type', value: 'BOOL' } }),
  ]

  it('returns valid when variable found with matching type', () => {
    const result = validateVariableReference('myVar', { definition: 'base-type', value: 'INT' }, variables)
    expect(result.isValid).toBe(true)
    expect(result.variable).toBeDefined()
    expect(result.error).toBeUndefined()
  })

  it('is case-insensitive for both name and type value', () => {
    const result = validateVariableReference('MYVAR', { definition: 'base-type', value: 'int' }, variables)
    expect(result.isValid).toBe(true)
  })

  it('returns invalid when variable is not found', () => {
    const result = validateVariableReference('missing', { definition: 'base-type', value: 'INT' }, variables)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('not found')
    expect(result.variable).toBeUndefined()
  })

  it('returns invalid when type definition does not match', () => {
    const result = validateVariableReference('myVar', { definition: 'user-data-type', value: 'INT' }, variables)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Type mismatch')
    expect(result.variable).toBeDefined()
  })

  it('returns invalid when type value does not match', () => {
    const result = validateVariableReference('myVar', { definition: 'base-type', value: 'BOOL' }, variables)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Type mismatch')
  })
})
