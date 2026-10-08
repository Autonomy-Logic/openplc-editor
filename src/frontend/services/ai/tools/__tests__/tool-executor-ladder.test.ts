import { beforeEach, describe, expect, it } from '@jest/globals'

import type { SystemLibrary } from '../../../../../middleware/shared/ports/library-types'
import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../store'
import type { RungLadderState } from '../../../../store/slices/ladder/types'
import { createTestStore } from '../../../../store/testing'
import { executeTool } from '../tool-executor'

let store: OpenPLCStore

function createLdPou(name: string) {
  const result = store.getState().pouActions.create({ type: 'program', name, language: 'ld' })
  expect(result.ok).toBe(true)
}

function createVariable(
  pouName: string,
  name: string,
  type = 'bool',
  cls: 'input' | 'output' | 'local' = 'local',
): PLCVariable {
  const result = store.getState().projectActions.createVariable({
    scope: 'local',
    associatedPou: pouName,
    data: {
      name,
      class: cls,
      type: { definition: 'base-type', value: type },
      location: '',
      initialValue: null,
      documentation: '',
      debug: false,
    },
  })
  expect(result.ok).toBe(true)
  return result.data as PLCVariable
}

const systemLibrary: SystemLibrary = {
  name: 'iec-standard-fb',
  author: 'test',
  version: '1.0.0',
  stPath: '',
  cPath: '',
  pous: [
    {
      name: 'TON',
      type: 'function-block',
      language: 'st',
      body: '',
      documentation: '',
      variables: [
        { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'bool' } },
        { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'time' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'bool' } },
        { name: 'ET', class: 'output', type: { definition: 'base-type', value: 'time' } },
      ],
    },
    {
      name: 'TOF',
      type: 'function-block',
      language: 'st',
      body: '',
      documentation: '',
      variables: [
        { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'bool' } },
        { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'time' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'bool' } },
        { name: 'ET', class: 'output', type: { definition: 'base-type', value: 'time' } },
      ],
    },
    {
      name: 'CONCAT',
      type: 'function',
      language: 'st',
      body: '',
      documentation: '',
      variables: [
        { name: 'EN', class: 'input', type: { definition: 'base-type', value: 'bool' } },
        { name: 'IN1', class: 'input', type: { definition: 'base-type', value: 'string' } },
        { name: 'IN2', class: 'input', type: { definition: 'base-type', value: 'string' } },
        { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'bool' } },
        { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'string' } },
      ],
    },
    {
      name: 'ADD',
      type: 'function',
      language: 'st',
      body: '',
      documentation: '',
      variables: [
        { name: 'IN1', class: 'input', type: { definition: 'base-type', value: 'dint' } },
        { name: 'IN2', class: 'input', type: { definition: 'base-type', value: 'dint' } },
        { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'dint' } },
      ],
    },
  ],
}

function seedSystemLibrary() {
  store.getState().libraryActions.setSystemLibraries([systemLibrary])
}

function getRungs(pouName: string): RungLadderState[] {
  return store.getState().ladderFlows.find((f) => f.name === pouName)?.rungs ?? []
}

function getVariables(pouName: string): PLCVariable[] {
  return store.getState().project.data.pous.find((p) => p.name === pouName)?.interface?.variables ?? []
}

function getBlockPins(pouName: string) {
  const block = getRungs(pouName)[0]?.nodes.find((n) => n.type === 'block')
  return (block?.data as { connectedVariables?: { handleId: string; variable?: { name: string } }[] })
    ?.connectedVariables
}

beforeEach(() => {
  store = createTestStore()
})

describe('read_ladder_diagram', () => {
  it('requires pouName', async () => {
    const result = await executeTool(store, 'read_ladder_diagram', {})
    expect(result.success).toBe(false)
  })

  it('fails when the POU does not exist', async () => {
    const result = await executeTool(store, 'read_ladder_diagram', { pouName: 'Ghost' })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not found/)
  })

  it('fails when the POU is not a Ladder Diagram', async () => {
    store.getState().pouActions.create({ type: 'program', name: 'TextMain', language: 'st' })
    const result = await executeTool(store, 'read_ladder_diagram', { pouName: 'TextMain' })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not a Ladder Diagram/)
  })

  it('reports an empty diagram when no rungs exist yet', async () => {
    createLdPou('Main')
    const result = await executeTool(store, 'read_ladder_diagram', { pouName: 'Main' })
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/no rungs yet/)
  })

  it('reads back rungs built via add_rung, including comment and elements', async () => {
    createLdPou('Main')
    createVariable('Main', 'Start')
    createVariable('Main', 'Motor')
    await executeTool(store, 'add_rung', {
      pouName: 'Main',
      comment: 'seal-in',
      elements: [
        { kind: 'contact', variable: 'Start' },
        { kind: 'coil', variable: 'Motor' },
      ],
    })

    const result = await executeTool(store, 'read_ladder_diagram', { pouName: 'Main' })
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/seal-in/)
    expect(result.message).toContain('"kind":"contact"')
    expect(result.message).toContain('"kind":"coil"')
  })

  it('flags a rung as truncated when it contains a parallel branch', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', elements: [] })
    const rungs = getRungs('Main')
    const rungWithParallel: RungLadderState = {
      ...rungs[0],
      nodes: [...rungs[0].nodes, { id: 'parallel-1', type: 'parallel', position: { x: 0, y: 0 }, data: {} }],
      edges: [
        ...rungs[0].edges.filter((e) => !e.source.startsWith('left-rail')),
        {
          id: 'e_forced',
          source: rungs[0].nodes[0].id,
          target: 'parallel-1',
          sourceHandle: (rungs[0].nodes[0].data as { outputConnector?: { id?: string } }).outputConnector?.id ?? '',
          targetHandle: 'x',
        },
      ],
    }
    store.getState().ladderFlowActions.setRungs({ editorName: 'Main', rungs: [rungWithParallel] })

    const result = await executeTool(store, 'read_ladder_diagram', { pouName: 'Main' })
    expect(result.message).toMatch(/truncated/)
  })

  it('flags a rung as truncated when it carries a block-pin branch', async () => {
    createLdPou('Main')
    createVariable('Main', 'Start')
    createVariable('Main', 'Motor')
    await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [
        { kind: 'contact', variable: 'Start' },
        { kind: 'coil', variable: 'Motor' },
      ],
    })
    const [rung] = getRungs('Main')
    const contact = rung.nodes.find((n) => n.type === 'contact')
    if (!contact) throw new Error('expected a contact on the rung')
    const branchNode = {
      ...contact,
      id: 'branch-contact',
      data: { ...contact.data, branchContext: { blockId: 'b1', handleId: 'PT', direction: 'input' } },
    }
    const rungWithBranch: RungLadderState = { ...rung, nodes: [...rung.nodes, branchNode] }
    store.getState().ladderFlowActions.setRungs({ editorName: 'Main', rungs: [rungWithBranch] })

    const result = await executeTool(store, 'read_ladder_diagram', { pouName: 'Main' })
    expect(result.message).toMatch(/truncated/)
  })
})

describe('add_rung', () => {
  it('requires pouName and elements', async () => {
    const result = await executeTool(store, 'add_rung', { pouName: 'Main' })
    expect(result.success).toBe(false)
  })

  it('fails when the POU does not exist', async () => {
    const result = await executeTool(store, 'add_rung', { pouName: 'Ghost', elements: [] })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not found/)
  })

  it('fails when the POU is not a Ladder Diagram', async () => {
    store.getState().pouActions.create({ type: 'program', name: 'TextMain', language: 'st' })
    const result = await executeTool(store, 'add_rung', { pouName: 'TextMain', elements: [] })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not a Ladder Diagram/)
  })

  it('fails when afterRungId does not exist, listing available rungs', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', elements: [] })
    const result = await executeTool(store, 'add_rung', { pouName: 'Main', elements: [], afterRungId: 'ghost-rung' })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/ghost-rung.*Available rungs/)
  })

  it('fails with a clear message when a contact variable does not exist', async () => {
    createLdPou('Main')
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'contact', variable: 'Nope' }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/does not exist in POU "Main" — create it with create_variable first/)
  })

  it('fails when a contact variable is not BOOL', async () => {
    createLdPou('Main')
    createVariable('Main', 'Counter', 'dint')
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'contact', variable: 'Counter' }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/is not BOOL/)
  })

  it('fails when a coil variable does not exist', async () => {
    createLdPou('Main')
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'coil', variable: 'Nope' }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/does not exist in POU/)
  })

  it('fails when a block type does not resolve', async () => {
    createLdPou('Main')
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'Missing' }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/block type "Missing" not found/)
  })

  it('requires instanceName for a function-block element', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON' }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/requires "instanceName"/)
  })

  it('rejects an illegal instance name', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: '1 Bad Name' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an instance name colliding with an incompatible existing variable', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    createVariable('Main', 'Timer1', 'dint')
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1' }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/already exists with a different type/)
  })

  it('rejects reusing one instance name for two different block types in the same call', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [
        { kind: 'block', blockType: 'TON', instanceName: 'Shared' },
        { kind: 'block', blockType: 'TOF', instanceName: 'Shared' },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/already used for block type "ton" earlier in this call/)
  })

  it('surfaces buildRungFromSpec pin errors (rail connector) as a tool failure', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'IN', variable: 'Main' }] }],
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/rail connector/)
  })

  it('creates a new rung with a contact/coil series and writes it back live', async () => {
    createLdPou('Main')
    createVariable('Main', 'Start')
    createVariable('Main', 'Motor')

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      comment: 'seal-in',
      elements: [
        { kind: 'contact', variable: 'Start' },
        { kind: 'coil', variable: 'Motor' },
      ],
    })

    expect(result.success).toBe(true)
    const rungs = getRungs('Main')
    expect(rungs).toHaveLength(1)
    expect(rungs[0].comment).toBe('seal-in')
    expect(rungs[0].nodes.some((n) => n.type === 'contact')).toBe(true)
    expect(rungs[0].nodes.some((n) => n.type === 'coil')).toBe(true)
  })

  it('ignores an unnecessary instanceName on a non-function-block element', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'ADD', instanceName: 'NotNeeded' }],
    })

    expect(result.success).toBe(true)
    expect(getVariables('Main').some((v) => v.name === 'NotNeeded')).toBe(false)
  })

  it('auto-creates a function-block instance variable with the derived shape', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1' }],
    })

    expect(result.success).toBe(true)
    const variable = getVariables('Main').find((v) => v.name === 'Timer1')
    expect(variable?.type).toEqual({ definition: 'derived', value: 'TON' })
    expect(variable?.id).toEqual(expect.any(String))
  })

  it('leaves the project untouched when a pin binding fails', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [
        {
          kind: 'block',
          blockType: 'TON',
          instanceName: 'Timer1',
          pins: [{ pin: 'PT', variable: 'Preset' }],
        },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/variable "Preset" not found for pin "PT"/)
    expect(getVariables('Main').some((v) => v.name === 'Timer1')).toBe(false)
    expect(getRungs('Main')).toHaveLength(0)
  })

  it('binds an input pin to a literal of the pin type', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'PT', variable: 'T#5s' }] }],
    })

    expect(result.success).toBe(true)
    expect(getBlockPins('Main')).toEqual([expect.objectContaining({ handleId: 'PT', variable: { name: 'T#5s' } })])
    expect(getVariables('Main').some((v) => v.name === 'T#5s')).toBe(false)
  })

  it('rejects a literal that does not match the pin type', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'PT', variable: 'TRUE' }] }],
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/literal "TRUE" is not compatible with pin "PT" \(TIME\)/)
    expect(getVariables('Main')).toHaveLength(0)
  })

  it('accepts a string literal with an escaped quote', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'CONCAT', pins: [{ pin: 'IN1', variable: "'it$'s'" }] }],
    })

    expect(result.success).toBe(true)
  })

  it('rejects a string literal whose quote would end it early and leak into the generated ST', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [
        {
          kind: 'block',
          blockType: 'CONCAT',
          pins: [{ pin: 'IN1', variable: "'a'); Motor := TRUE; S := CONCAT('b'" }],
        },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/is not a valid string literal/)
    expect(getRungs('Main')).toHaveLength(0)
  })

  it('rejects a literal bound to an output pin', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'ET', variable: 'T#5s' }] }],
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/pin "ET" is an output/)
  })

  it('rejects a function block inside a FUNCTION POU', async () => {
    store.getState().pouActions.create({ type: 'function', name: 'Fn', language: 'ld' })
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Fn',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1' }],
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/cannot be used inside FUNCTION "Fn"/)
    expect(getVariables('Fn').some((v) => v.name === 'Timer1')).toBe(false)
  })

  it('still accepts a function inside a FUNCTION POU', async () => {
    store.getState().pouActions.create({ type: 'function', name: 'Fn', language: 'ld' })
    seedSystemLibrary()

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Fn',
      elements: [{ kind: 'block', blockType: 'ADD' }],
    })

    expect(result.success).toBe(true)
  })

  it('binds to a matching global instance instead of shadowing it with a local', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    const created = store.getState().projectActions.createVariable({
      scope: 'global',
      data: {
        name: 'Timer1',
        class: 'global',
        type: { definition: 'derived', value: 'TON' },
        location: '',
        initialValue: null,
        documentation: '',
        debug: false,
      },
    })
    expect(created.ok).toBe(true)

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1' }],
    })

    expect(result.success).toBe(true)
    expect(getVariables('Main').some((v) => v.name.toLowerCase() === 'timer1')).toBe(false)
    const block = getRungs('Main')[0].nodes.find((n) => n.type === 'block')
    expect((block?.data as { variable?: PLCVariable }).variable?.class).toBe('global')
  })

  it('creates no instance when the declaration text in the code view does not parse', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    const invalidText = 'VAR\n  a : INT;\n  a : DINT;\nEND_VAR'
    store.getState().projectActions.setPouVariablesText('Main', invalidText, true)
    store.getState().editorActions.updateModelVariablesForName('Main', { display: 'code', code: invalidText })

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [
        { kind: 'block', blockType: 'TON', instanceName: 'Timer1' },
        { kind: 'block', blockType: 'TOF', instanceName: 'Timer2' },
      ],
    })

    expect(result.success).toBe(false)
    expect(getVariables('Main')).toHaveLength(0)
    const pou = store.getState().project.data.pous.find((p) => p.name === 'Main')
    expect(pou?.variablesText).toBe(invalidText)
    expect(pou?.variablesTextUnparsed).toBe(true)
    expect(getRungs('Main')).toHaveLength(0)
  })

  it('creates one instance variable when two blocks share an instance name', async () => {
    createLdPou('Main')
    seedSystemLibrary()

    await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [
        { kind: 'block', blockType: 'TON', instanceName: 'Timer1' },
        { kind: 'block', blockType: 'TON', instanceName: 'timer1' },
      ],
    })

    expect(getVariables('Main').filter((v) => v.name.toLowerCase() === 'timer1')).toHaveLength(1)
  })

  it('reuses an existing compatible instance variable instead of creating a duplicate', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    const existing = createVariable('Main', 'Timer1', 'TON')
    store.getState().projectActions.updateVariable({
      scope: 'local',
      associatedPou: 'Main',
      variableId: existing.name,
      data: { type: { definition: 'derived', value: 'TON' } },
    })

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1' }],
    })

    expect(result.success).toBe(true)
    expect(getVariables('Main').filter((v) => v.name.toLowerCase() === 'timer1')).toHaveLength(1)
  })

  it('resolves a block type from a user-authored function-block POU', async () => {
    createLdPou('Main')
    store.getState().pouActions.create({ type: 'function-block', name: 'MyLatch', language: 'st' })
    createVariable('MyLatch', 'SetIn', 'bool', 'input')
    createVariable('MyLatch', 'ResetIn', 'bool', 'input')
    createVariable('MyLatch', 'Q', 'bool', 'output')

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'MyLatch', instanceName: 'Latch1' }],
    })

    expect(result.success).toBe(true)
    const rungs = getRungs('Main')
    const block = rungs[0].nodes.find((n) => n.type === 'block')
    expect((block?.data as { variant: { name: string } }).variant.name).toBe('MyLatch')
  })

  it('resolves a user-authored function and synthesizes its OUT pin', async () => {
    createLdPou('Main')
    store.getState().pouActions.create({ type: 'function', name: 'MyAdd', language: 'st' })
    createVariable('MyAdd', 'IN1', 'dint', 'input')
    createVariable('MyAdd', 'IN2', 'dint', 'input')
    store.getState().projectActions.updatePouReturnType('MyAdd', 'DINT')
    createVariable('Main', 'Sum', 'dint')

    const result = await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'MyAdd', pins: [{ pin: 'OUT', variable: 'Sum' }] }],
    })

    expect(result.success).toBe(true)
    const rungs = getRungs('Main')
    const block = rungs[0].nodes.find((n) => n.type === 'block')
    const connected = (block?.data as { connectedVariables: Array<{ handleId: string }> }).connectedVariables
    expect(connected.some((cv) => cv.handleId === 'OUT')).toBe(true)
  })

  it('inserts after a given rung id', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'first', elements: [] })
    const firstId = getRungs('Main')[0].id
    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'third', elements: [] })

    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'second', afterRungId: firstId, elements: [] })

    expect(getRungs('Main').map((r) => r.comment)).toEqual(['first', 'second', 'third'])
  })
})

describe('update_rung', () => {
  it('requires pouName, rungId and elements', async () => {
    const result = await executeTool(store, 'update_rung', { pouName: 'Main' })
    expect(result.success).toBe(false)
  })

  it('fails when the POU does not exist', async () => {
    const result = await executeTool(store, 'update_rung', { pouName: 'Ghost', rungId: 'r1', elements: [] })
    expect(result.success).toBe(false)
  })

  it('fails when the rung id does not exist, listing available rungs', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', elements: [] })
    const result = await executeTool(store, 'update_rung', { pouName: 'Main', rungId: 'ghost', elements: [] })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/ghost.*Available rungs/)
  })

  it('replaces the elements of an existing rung, keeping its id and defaulting the comment', async () => {
    createLdPou('Main')
    createVariable('Main', 'Start')
    createVariable('Main', 'Motor')
    await executeTool(store, 'add_rung', {
      pouName: 'Main',
      comment: 'original',
      elements: [{ kind: 'contact', variable: 'Start' }],
    })
    const rungId = getRungs('Main')[0].id

    const result = await executeTool(store, 'update_rung', {
      pouName: 'Main',
      rungId,
      elements: [{ kind: 'coil', variable: 'Motor' }],
    })

    expect(result.success).toBe(true)
    const rungs = getRungs('Main')
    expect(rungs).toHaveLength(1)
    expect(rungs[0].id).toBe(rungId)
    expect(rungs[0].comment).toBe('original')
    expect(rungs[0].nodes.some((n) => n.type === 'coil')).toBe(true)
    expect(rungs[0].nodes.some((n) => n.type === 'contact')).toBe(false)
  })

  it('overwrites the comment when one is provided', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'original', elements: [] })
    const rungId = getRungs('Main')[0].id

    await executeTool(store, 'update_rung', { pouName: 'Main', rungId, comment: 'updated', elements: [] })

    expect(getRungs('Main')[0].comment).toBe('updated')
  })

  it('fails validation before mutating when the new elements are invalid', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', elements: [] })
    const rungId = getRungs('Main')[0].id

    const result = await executeTool(store, 'update_rung', {
      pouName: 'Main',
      rungId,
      elements: [{ kind: 'contact', variable: 'Nope' }],
    })

    expect(result.success).toBe(false)
    expect(getRungs('Main')[0].nodes.some((n) => n.type === 'contact')).toBe(false)
  })

  it('resolves block types for the replacement elements', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    await executeTool(store, 'add_rung', { pouName: 'Main', elements: [] })
    const rungId = getRungs('Main')[0].id

    const result = await executeTool(store, 'update_rung', {
      pouName: 'Main',
      rungId,
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1' }],
    })

    expect(result.success).toBe(true)
    expect(getRungs('Main')[0].nodes.some((n) => n.type === 'block')).toBe(true)
  })

  it('refuses to rebuild a rung that carries a branch the spec cannot express', async () => {
    createLdPou('Main')
    createVariable('Main', 'Start')
    createVariable('Main', 'Motor')
    await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [
        { kind: 'contact', variable: 'Start' },
        { kind: 'coil', variable: 'Motor' },
      ],
    })
    const [rung] = getRungs('Main')
    const contact = rung.nodes.find((n) => n.type === 'contact')
    if (!contact) throw new Error('expected a contact on the rung')
    const branchNode = {
      ...contact,
      id: 'branch-contact',
      data: { ...contact.data, branchContext: { blockId: 'b1', handleId: 'PT', direction: 'input' } },
    }
    const rungWithBranch: RungLadderState = { ...rung, nodes: [...rung.nodes, branchNode] }
    store.getState().ladderFlowActions.setRungs({ editorName: 'Main', rungs: [rungWithBranch] })

    const result = await executeTool(store, 'update_rung', {
      pouName: 'Main',
      rungId: rung.id,
      elements: [
        { kind: 'contact', variable: 'Start' },
        { kind: 'coil', variable: 'Motor' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/cannot be updated without losing logic/)
    expect(getRungs('Main')[0].nodes.some((n) => n.id === 'branch-contact')).toBe(true)
  })

  it('round-trips a block whose pins hold a literal and a cleared binding', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    await executeTool(store, 'add_rung', {
      pouName: 'Main',
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'PT', variable: 'T#5s' }] }],
    })
    const [rung] = getRungs('Main')
    const nodes = rung.nodes.map((node) => {
      if (node.type !== 'block') return node
      const data = node.data as {
        connectedVariables: { handleId: string; type: string; variable?: { name: string } }[]
      }
      const cleared = { handleId: 'ET', type: 'output', variable: { id: '', name: '' } }
      return { ...node, data: { ...node.data, connectedVariables: [...data.connectedVariables, cleared] } }
    })
    store.getState().ladderFlowActions.setRungs({ editorName: 'Main', rungs: [{ ...rung, nodes }] })

    const read = await executeTool(store, 'read_ladder_diagram', { pouName: 'Main' })
    const spec = JSON.parse(read.message.split('\n').slice(1).join('\n')) as unknown[]
    expect(spec).toEqual([
      { kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'PT', variable: 'T#5s' }] },
    ])

    const result = await executeTool(store, 'update_rung', { pouName: 'Main', rungId: rung.id, elements: spec })
    expect(result.success).toBe(true)
    expect(getBlockPins('Main')).toEqual([expect.objectContaining({ handleId: 'PT', variable: { name: 'T#5s' } })])
  })

  it('surfaces buildRungFromSpec errors as a tool failure', async () => {
    createLdPou('Main')
    seedSystemLibrary()
    await executeTool(store, 'add_rung', { pouName: 'Main', elements: [] })
    const rungId = getRungs('Main')[0].id

    const result = await executeTool(store, 'update_rung', {
      pouName: 'Main',
      rungId,
      elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'IN', variable: 'Main' }] }],
    })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/rail connector/)
  })
})

describe('delete_rung', () => {
  it('requires pouName and rungId', async () => {
    const result = await executeTool(store, 'delete_rung', { pouName: 'Main' })
    expect(result.success).toBe(false)
  })

  it('fails when the POU does not exist', async () => {
    const result = await executeTool(store, 'delete_rung', { pouName: 'Ghost', rungId: 'r1' })
    expect(result.success).toBe(false)
  })

  it('fails when the POU is not a Ladder Diagram', async () => {
    store.getState().pouActions.create({ type: 'program', name: 'TextMain', language: 'st' })
    const result = await executeTool(store, 'delete_rung', { pouName: 'TextMain', rungId: 'r1' })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not a Ladder Diagram/)
  })

  it('fails when the rung id does not exist, listing available rungs', async () => {
    createLdPou('Main')
    const result = await executeTool(store, 'delete_rung', { pouName: 'Main', rungId: 'ghost' })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/ghost.*Available rungs: \(none\)/)
  })

  it('removes the rung', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'keep', elements: [] })
    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'drop', elements: [] })
    const rungs = getRungs('Main')
    const toDrop = rungs.find((r) => r.comment === 'drop')!

    const result = await executeTool(store, 'delete_rung', { pouName: 'Main', rungId: toDrop.id })

    expect(result.success).toBe(true)
    expect(getRungs('Main').map((r) => r.comment)).toEqual(['keep'])
  })
})

describe('writeRungs (shared by add/update/delete_rung)', () => {
  it('recreates the ladder flow when it is missing', async () => {
    createLdPou('Main')
    store.getState().ladderFlowActions.removeLadderFlow('Main')
    expect(store.getState().ladderFlows.find((f) => f.name === 'Main')).toBeUndefined()

    const result = await executeTool(store, 'add_rung', { pouName: 'Main', elements: [] })

    expect(result.success).toBe(true)
    expect(getRungs('Main')).toHaveLength(1)
  })

  it('rejects the write when the resulting flow fails zod validation', async () => {
    createLdPou('Main')
    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'keep', elements: [] })
    await executeTool(store, 'add_rung', { pouName: 'Main', comment: 'drop', elements: [] })
    const rungs = getRungs('Main')
    const toKeep = rungs.find((r) => r.comment === 'keep')!
    const toDrop = rungs.find((r) => r.comment === 'drop')!

    // Corrupt the surviving rung directly, bypassing setRungs's own (looser) validation.
    const corrupted: RungLadderState = {
      ...toKeep,
      edges: [{ ...toKeep.edges[0], sourceHandle: undefined as unknown as string }],
    }
    store.getState().ladderFlowActions.setRungs({ editorName: 'Main', rungs: [corrupted, toDrop] })

    const result = await executeTool(store, 'delete_rung', { pouName: 'Main', rungId: toDrop.id })

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/failed validation/)
  })
})
