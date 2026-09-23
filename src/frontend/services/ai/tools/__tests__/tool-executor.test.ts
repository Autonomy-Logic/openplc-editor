/** Every case asserts the STORE after the call, not just the `ToolResult`; the store is seeded, never mocked. */

import { beforeEach, describe, expect, it } from '@jest/globals'

import type {
  PLCBody,
  PLCDataType,
  PLCPou,
  PLCStructureVariable,
  PLCVariable,
} from '../../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../../store'
import { type ProjectStTranspiler, transpileProjectToST } from '../../graphical-context'
import { executeTool } from '../tool-executor'

function makeVariable(name: string, type = 'INT', cls: PLCVariable['class'] = 'local'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'base-type', value: type },
    location: '',
    documentation: '',
  }
}

function makePou(
  name: string,
  language: PLCBody['language'] = 'st',
  value: unknown = '',
  vars: PLCVariable[] = [],
): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: vars },
    body: { language, value },
    documentation: '',
  }
}

function makeStruct(name: string, fields: Array<[string, string]>): PLCDataType {
  return {
    name,
    derivation: 'structure',
    variable: fields.map(([fieldName, type]) => ({
      name: fieldName,
      type: { definition: 'base-type', value: type },
    })),
  }
}

function makeEnum(name: string, values: string[]): PLCDataType {
  return { name, derivation: 'enumerated', values: values.map((description) => ({ description })) }
}

function makeArray(name: string, baseType: string, dimensions: string[]): PLCDataType {
  return {
    name,
    derivation: 'array',
    baseType: { definition: 'base-type', value: baseType },
    dimensions: dimensions.map((dimension) => ({ dimension })),
  }
}

type Seed = {
  pous?: PLCPou[]
  dataTypes?: PLCDataType[]
  globalVariables?: PLCVariable[]
}

function seedProject(seed: Seed = {}): void {
  const state = openPLCStoreBase.getState()
  state.projectActions.setProject({
    meta: { name: 'AI Tool Fixture', type: 'plc-project', path: '/tmp/ai-tool-fixture' },
    data: {
      dataTypes: seed.dataTypes ?? [],
      pous: seed.pous ?? [],
      configurations: {
        resource: { tasks: [], instances: [], globalVariables: seed.globalVariables ?? [] },
      },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  })
}

const project = () => openPLCStoreBase.getState().project.data
const pouNamed = (name: string) => project().pous.find((p) => p.name === name)
const varsOf = (pouName: string) => pouNamed(pouName)?.interface?.variables ?? []
const globals = () => project().configurations.resource.globalVariables
const datatypeNamed = (name: string) => project().dataTypes.find((d) => d.name === name)
const bodyOf = (pouName: string) => pouNamed(pouName)?.body.value

/** A transpiler that records its calls so a test can prove the ST cache was dropped. */
function countingTranspiler(programSt: string): { transpile: ProjectStTranspiler; callCount: () => number } {
  let calls = 0
  const transpile: ProjectStTranspiler = () => {
    calls += 1
    return Promise.resolve(programSt)
  }
  return { transpile, callCount: () => calls }
}

/** Narrow a stored type to its derivation so a test reads the section it means without an assertion. */
function structFields(name: string): PLCStructureVariable[] | undefined {
  const dt = datatypeNamed(name)
  return dt?.derivation === 'structure' ? dt.variable : undefined
}

function enumValues(name: string): Array<{ description: string }> | undefined {
  const dt = datatypeNamed(name)
  return dt?.derivation === 'enumerated' ? dt.values : undefined
}

beforeEach(() => {
  const state = openPLCStoreBase.getState()
  // Store is a module singleton: clear it so a previous case's names can't collide with this one's.
  state.libraryActions.clearUserLibraries()
  state.aiActions.clearAllPendingDiffs()
  seedProject()
})

describe('executeTool dispatch', () => {
  it('names the tool it does not know instead of failing silently', async () => {
    const result = await executeTool('rewrite_firmware', {})

    expect(result).toEqual({ success: false, message: 'Unknown tool: rewrite_firmware' })
  })

  it('turns a throwing tool into a failed result, upholding the never-throws contract', async () => {
    // `null` input dereferences inside the create path.
    const result = await executeTool('create_pou', null)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Tool execution error')
  })
})

describe('create_pou', () => {
  it('adds the POU to the project with the requested type, language and body', async () => {
    const result = await executeTool('create_pou', {
      name: 'Conveyor',
      type: 'program',
      language: 'st',
      body: 'motor := TRUE;',
    })

    expect(result.success).toBe(true)
    const created = pouNamed('Conveyor')
    expect(created?.pouType).toBe('program')
    expect(created?.body.language).toBe('st')
    expect(created?.body.value).toBe('motor := TRUE;')
  })

  it('registers a new function block as a library element so it can be placed in a diagram', async () => {
    // A POU without a library entry is invisible in the LD/FBD pickers.
    await executeTool('create_pou', { name: 'Debounce', type: 'function-block', language: 'st' })

    expect(openPLCStoreBase.getState().libraries.user.some((l) => l.name === 'Debounce')).toBe(true)
  })

  it('records a pending diff for the generated body so the user can review it hunk by hunk', async () => {
    await executeTool('create_pou', { name: 'Reviewed', type: 'program', language: 'st', body: 'a := 1;' })

    const diff = openPLCStoreBase.getState().ai.pendingDiffs.Reviewed
    expect(diff?.oldBody).toBe('')
    expect(diff?.newBody).toBe('a := 1;')
    expect(diff?.acceptedHunks.length).toBe(diff?.hunks.length)
  })

  it('creates the POU with no pending diff when no body was supplied', async () => {
    const result = await executeTool('create_pou', { name: 'Empty', type: 'program', language: 'st' })

    expect(result.message).not.toContain('with initial code')
    expect(pouNamed('Empty')).toBeDefined()
    expect(openPLCStoreBase.getState().ai.pendingDiffs.Empty).toBeUndefined()
  })

  it('strips the POU wrapper and VAR block the model adds despite instructions not to', async () => {
    // The model routinely returns a whole compilable POU, which the ST transpiler rejects verbatim.
    await executeTool('create_pou', {
      name: 'Wrapped',
      type: 'program',
      language: 'st',
      body: 'PROGRAM Wrapped\nVAR\n  x : INT;\nEND_VAR\n\nx := x + 1;\nEND_PROGRAM',
    })

    expect(bodyOf('Wrapped')).toBe('x := x + 1;')
  })

  it.each([
    ['no name', { type: 'program', language: 'st' }],
    ['no type', { name: 'X', language: 'st' }],
    ['no language', { name: 'X', type: 'program' }],
  ])('refuses malformed input with %s and writes nothing', async (_label, input) => {
    const result = await executeTool('create_pou', input)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required fields')
    expect(project().pous).toHaveLength(0)
  })

  it('refuses a graphical language and explains which ones are supported', async () => {
    // LD/FBD bodies are flow graphs the model cannot author; the tool must refuse rather than create an empty diagram.
    const result = await executeTool('create_pou', { name: 'Rungs', type: 'program', language: 'ld' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('is not supported')
    expect(project().pous).toHaveLength(0)
  })

  it('refuses an invalid POU type', async () => {
    const result = await executeTool('create_pou', { name: 'X', type: 'subroutine', language: 'st' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Invalid POU type')
    expect(project().pous).toHaveLength(0)
  })

  it('refuses a name already taken by another POU rather than overwriting it', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'original;')] })

    const result = await executeTool('create_pou', { name: 'Conveyor', type: 'program', language: 'st', body: 'new;' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('already exists')
    expect(bodyOf('Conveyor')).toBe('original;')
  })

  it('refuses a name already taken by a data type — they share one identifier namespace', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE'])] })

    const result = await executeTool('create_pou', { name: 'Mode', type: 'program', language: 'st' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('data type named "Mode" already exists')
    expect(project().pous).toHaveLength(0)
  })

  it('redirects a "main" re-creation carrying a body onto the existing POU', async () => {
    // Every project is born with a main POU; creating one with a body redirects to update_pou_body.
    seedProject({ pous: [makePou('Main', 'st', 'old;')] })

    const result = await executeTool('create_pou', { name: 'main', type: 'program', language: 'st', body: 'fresh;' })

    expect(result.success).toBe(true)
    expect(result.message).toContain('updated its body instead')
    expect(project().pous).toHaveLength(1)
    expect(bodyOf('Main')).toBe('fresh;')
  })

  it('refuses a bodyless "main" re-creation and points at update_pou_body', async () => {
    seedProject({ pous: [makePou('Main', 'st', 'old;')] })

    const result = await executeTool('create_pou', { name: 'Main', type: 'program', language: 'st' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('update_pou_body')
    expect(bodyOf('Main')).toBe('old;')
  })

  it('surfaces the redirected update failing instead of reporting a phantom success', async () => {
    // A graphical main cannot take a text body; the redirect must propagate that refusal.
    seedProject({ pous: [{ ...makePou('Main', 'ld', { rungs: [] }) }] })

    const result = await executeTool('create_pou', { name: 'main', type: 'program', language: 'st', body: 'x := 1;' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('graphical POU')
  })

  it('creates a main POU normally when the project has none', async () => {
    const result = await executeTool('create_pou', { name: 'main', type: 'program', language: 'st' })

    expect(result.success).toBe(true)
    expect(pouNamed('main')).toBeDefined()
  })
})

describe('update_pou_body', () => {
  it('replaces the stored body', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'old := 1;')] })

    const result = await executeTool('update_pou_body', { pouName: 'Conveyor', code: 'new := 2;' })

    expect(result.success).toBe(true)
    expect(bodyOf('Conveyor')).toBe('new := 2;')
  })

  it('records the before/after pair so the change stays reviewable with no editor mounted', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'old := 1;')] })

    await executeTool('update_pou_body', { pouName: 'Conveyor', code: 'new := 2;' })

    const diff = openPLCStoreBase.getState().ai.pendingDiffs.Conveyor
    expect(diff?.oldBody).toBe('old := 1;')
    expect(diff?.newBody).toBe('new := 2;')
  })

  it('tells the open editor to resync through the ai-pou-updated event', async () => {
    // The Monaco model is not driven by the store, so it needs this event to catch up.
    seedProject({ pous: [makePou('Conveyor', 'st', 'old := 1;')] })
    const seen: Array<{ pouName: string; body: string; oldBody: string }> = []
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) seen.push(event.detail)
    }
    window.addEventListener('ai-pou-updated', listener)

    await executeTool('update_pou_body', { pouName: 'Conveyor', code: 'new := 2;' })
    window.removeEventListener('ai-pou-updated', listener)

    expect(seen).toEqual([{ pouName: 'Conveyor', body: 'new := 2;', oldBody: 'old := 1;' }])
  })

  it('leaves no pending diff when the new body is identical to the old one', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'same;')] })

    const result = await executeTool('update_pou_body', { pouName: 'Conveyor', code: 'same;' })

    expect(result.success).toBe(true)
    expect(openPLCStoreBase.getState().ai.pendingDiffs.Conveyor).toBeUndefined()
  })

  it('strips a wrapper the model re-added around an existing POU', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'old;')] })

    await executeTool('update_pou_body', {
      pouName: 'Conveyor',
      code: 'PROGRAM Conveyor\nVAR_INPUT\n  start : BOOL;\nEND_VAR\nmotor := start;\nEND_PROGRAM',
    })

    expect(bodyOf('Conveyor')).toBe('motor := start;')
  })

  it.each([
    ['no pouName', { code: 'x := 1;' }],
    ['no code', { pouName: 'Conveyor' }],
  ])('refuses malformed input with %s', async (_label, input) => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'old;')] })

    const result = await executeTool('update_pou_body', input)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required fields')
    expect(bodyOf('Conveyor')).toBe('old;')
  })

  it('refuses an unknown POU instead of creating one', async () => {
    const result = await executeTool('update_pou_body', { pouName: 'Ghost', code: 'x := 1;' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
    expect(project().pous).toHaveLength(0)
  })

  const graphicalLanguages: Array<PLCBody['language']> = ['ld', 'fbd', 'sfc']

  it.each(graphicalLanguages)('refuses to overwrite a %s diagram with text', async (language) => {
    // The stored body is an XYFlow graph; writing a string over it would destroy the diagram.
    const graph = { rungs: [] }
    seedProject({ pous: [makePou('Diagram', language, graph)] })

    const result = await executeTool('update_pou_body', { pouName: 'Diagram', code: 'x := 1;' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Cannot update body of graphical POU')
    expect(bodyOf('Diagram')).toBe(graph)
  })
})

describe('create_variable', () => {
  it('adds a local variable to the POU with the base type resolved', async () => {
    seedProject({ pous: [makePou('Conveyor')] })

    const result = await executeTool('create_variable', {
      pouName: 'Conveyor',
      name: 'motor',
      type: 'BOOL',
      class: 'output',
      initialValue: 'FALSE',
    })

    expect(result.success).toBe(true)
    expect(varsOf('Conveyor')).toEqual([
      expect.objectContaining({
        name: 'motor',
        class: 'output',
        type: { definition: 'base-type', value: 'bool' },
        initialValue: 'FALSE',
      }),
    ])
  })

  it('defaults an unspecified class to local', async () => {
    seedProject({ pous: [makePou('Conveyor')] })

    await executeTool('create_variable', { pouName: 'Conveyor', name: 'counter', type: 'INT' })

    expect(varsOf('Conveyor')[0].class).toBe('local')
  })

  it('marks a type it does not recognise as a user data type, not a base type', async () => {
    // Getting this wrong emits `motor : Motor;` as a base type instead of a user-data-type reference.
    seedProject({ pous: [makePou('Conveyor')], dataTypes: [makeStruct('MotorState', [['speed', 'INT']])] })

    await executeTool('create_variable', { pouName: 'Conveyor', name: 'm', type: 'MotorState' })

    expect(varsOf('Conveyor')[0].type).toEqual({ definition: 'user-data-type', value: 'MotorState' })
  })

  it('adds a global variable with the global class when no POU is named', async () => {
    const result = await executeTool('create_variable', { name: 'sharedFlag', type: 'BOOL' })

    expect(result.message).toContain('as global')
    expect(globals()).toEqual([expect.objectContaining({ name: 'sharedFlag', class: 'global' })])
  })

  it('auto-suffixes a duplicate name rather than overwriting the existing variable', async () => {
    // The slice never silently replaces a declaration; the tool still reports the requested name, not the actual one.
    seedProject({ pous: [makePou('Conveyor', 'st', '', [makeVariable('motor', 'BOOL')])] })

    const result = await executeTool('create_variable', { pouName: 'Conveyor', name: 'motor', type: 'BOOL' })

    expect(result.success).toBe(true)
    expect(varsOf('Conveyor').map((v) => v.name)).toEqual(['motor', 'motor0'])
  })

  it.each([
    ['no name', { pouName: 'Conveyor', type: 'INT' }],
    ['no type', { pouName: 'Conveyor', name: 'x' }],
  ])('refuses malformed input with %s', async (_label, input) => {
    seedProject({ pous: [makePou('Conveyor')] })

    const result = await executeTool('create_variable', input)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required fields')
    expect(varsOf('Conveyor')).toHaveLength(0)
  })

  it('refuses an unknown POU', async () => {
    const result = await executeTool('create_variable', { pouName: 'Ghost', name: 'x', type: 'INT' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('POU "Ghost" not found')
  })

  it('refuses a name that is not a legal IEC identifier', async () => {
    // An illegal name reaches the on-disk declaration text and breaks the reopen parse.
    seedProject({ pous: [makePou('Conveyor')] })

    const result = await executeTool('create_variable', { pouName: 'Conveyor', name: 'motor speed', type: 'INT' })

    expect(result.success).toBe(false)
    expect(varsOf('Conveyor')).toHaveLength(0)
  })
})

describe('delete_pou', () => {
  it('removes the POU from the project', async () => {
    seedProject({ pous: [makePou('Conveyor'), makePou('Keeper')] })

    const result = await executeTool('delete_pou', { pouName: 'Conveyor' })

    expect(result.success).toBe(true)
    expect(project().pous.map((p) => p.name)).toEqual(['Keeper'])
  })

  it('also removes the library entry so a deleted block cannot still be placed', async () => {
    await executeTool('create_pou', { name: 'Debounce', type: 'function-block', language: 'st' })

    await executeTool('delete_pou', { pouName: 'Debounce' })

    expect(openPLCStoreBase.getState().libraries.user.some((l) => l.name === 'Debounce')).toBe(false)
  })

  it('closes the editor model so no tab survives pointing at a deleted POU', async () => {
    await executeTool('create_pou', { name: 'Doomed', type: 'program', language: 'st' })

    await executeTool('delete_pou', { pouName: 'Doomed' })

    expect(openPLCStoreBase.getState().editors.some((e) => e.meta.name === 'Doomed')).toBe(false)
  })

  it('refuses a missing pouName', async () => {
    const result = await executeTool('delete_pou', {})

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required field: pouName')
  })

  it('refuses an unknown POU rather than reporting a delete that removed nothing', async () => {
    seedProject({ pous: [makePou('Keeper')] })

    const result = await executeTool('delete_pou', { pouName: 'Ghost' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
    expect(project().pous).toHaveLength(1)
  })
})

describe('update_variable', () => {
  it('renames, retypes and reclasses a POU variable in one call', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', '', [makeVariable('old', 'INT')])] })

    const result = await executeTool('update_variable', {
      pouName: 'Conveyor',
      currentName: 'old',
      newName: 'fresh',
      type: 'BOOL',
      class: 'input',
      initialValue: 'TRUE',
    })

    expect(result.success).toBe(true)
    expect(varsOf('Conveyor')).toEqual([
      expect.objectContaining({
        name: 'fresh',
        class: 'input',
        type: { definition: 'base-type', value: 'bool' },
        initialValue: 'TRUE',
      }),
    ])
  })

  it('retypes to a user data type when the type is not a base type', async () => {
    seedProject({
      pous: [makePou('Conveyor', 'st', '', [makeVariable('m', 'INT')])],
      dataTypes: [makeStruct('MotorState', [['speed', 'INT']])],
    })

    await executeTool('update_variable', { pouName: 'Conveyor', currentName: 'm', type: 'MotorState' })

    expect(varsOf('Conveyor')[0].type).toEqual({ definition: 'user-data-type', value: 'MotorState' })
  })

  it('updates a global variable when no POU is named', async () => {
    seedProject({ globalVariables: [makeVariable('flag', 'BOOL', 'global')] })

    const result = await executeTool('update_variable', { currentName: 'flag', newName: 'systemFlag' })

    expect(result.success).toBe(true)
    expect(globals()[0].name).toBe('systemFlag')
  })

  it('refuses a missing currentName', async () => {
    const result = await executeTool('update_variable', { pouName: 'Conveyor' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required field: currentName')
  })

  it('refuses an unknown POU', async () => {
    const result = await executeTool('update_variable', { pouName: 'Ghost', currentName: 'x' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('POU "Ghost" not found')
  })

  it('names the POU scope when the variable is not there', async () => {
    seedProject({ pous: [makePou('Conveyor')] })

    const result = await executeTool('update_variable', { pouName: 'Conveyor', currentName: 'ghost' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found in POU "Conveyor"')
  })

  it('names the global scope when the variable is not there', async () => {
    const result = await executeTool('update_variable', { currentName: 'ghost' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found in global scope')
  })

  it('refuses a rename onto a name already used in the same POU', async () => {
    seedProject({
      pous: [makePou('Conveyor', 'st', '', [makeVariable('a'), makeVariable('b')])],
    })

    const result = await executeTool('update_variable', { pouName: 'Conveyor', currentName: 'a', newName: 'b' })

    expect(result.success).toBe(false)
    expect(varsOf('Conveyor').map((v) => v.name)).toEqual(['a', 'b'])
  })
})

describe('delete_variable', () => {
  it('removes the named variable and leaves its siblings alone', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', '', [makeVariable('a'), makeVariable('b')])] })

    const result = await executeTool('delete_variable', { pouName: 'Conveyor', variableName: 'a' })

    expect(result.success).toBe(true)
    expect(varsOf('Conveyor').map((v) => v.name)).toEqual(['b'])
  })

  it('removes a global variable when no POU is named', async () => {
    seedProject({ globalVariables: [makeVariable('flag', 'BOOL', 'global')] })

    const result = await executeTool('delete_variable', { variableName: 'flag' })

    expect(result.success).toBe(true)
    expect(globals()).toHaveLength(0)
  })

  it('refuses a missing variableName', async () => {
    const result = await executeTool('delete_variable', { pouName: 'Conveyor' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required field: variableName')
  })

  it('refuses an unknown POU', async () => {
    const result = await executeTool('delete_variable', { pouName: 'Ghost', variableName: 'x' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('POU "Ghost" not found')
  })

  it('refuses an unknown variable rather than reporting a delete that removed nothing', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', '', [makeVariable('a')])] })

    const result = await executeTool('delete_variable', { pouName: 'Conveyor', variableName: 'ghost' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found in POU "Conveyor"')
    expect(varsOf('Conveyor')).toHaveLength(1)
  })

  it('names the global scope when the global is not there', async () => {
    const result = await executeTool('delete_variable', { variableName: 'ghost' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found in global scope')
  })

  it('refuses to delete a global another POU declares as VAR_EXTERNAL', async () => {
    // Cascading silently would leave the referencing POU declaring an undefined symbol.
    seedProject({
      globalVariables: [makeVariable('shared', 'BOOL', 'global')],
      pous: [makePou('Conveyor', 'st', '', [makeVariable('shared', 'BOOL', 'external')])],
    })

    const result = await executeTool('delete_variable', { variableName: 'shared' })

    expect(result.success).toBe(false)
    expect(globals()).toHaveLength(1)
  })
})

describe('create_datatype', () => {
  it('creates a structure carrying every field, not just the skeleton', async () => {
    // Skeleton and content are two store calls; if only the first ran, the struct would be empty.
    const result = await executeTool('create_datatype', {
      name: 'MotorState',
      derivation: 'structure',
      fields: [
        { name: 'speed', type: 'INT' },
        { name: 'running', type: 'BOOL' },
      ],
    })

    expect(result.success).toBe(true)
    const created = datatypeNamed('MotorState')
    expect(created?.derivation).toBe('structure')
    expect(structFields('MotorState')).toEqual([
      { name: 'speed', type: { definition: 'base-type', value: 'int' } },
      { name: 'running', type: { definition: 'base-type', value: 'bool' } },
    ])
  })

  it('creates an enumeration carrying every value', async () => {
    const result = await executeTool('create_datatype', {
      name: 'Mode',
      derivation: 'enumerated',
      values: ['IDLE', 'RUNNING'],
      initialValue: 'IDLE',
    })

    expect(result.success).toBe(true)
    expect(datatypeNamed('Mode')).toMatchObject({
      derivation: 'enumerated',
      values: [{ description: 'IDLE' }, { description: 'RUNNING' }],
      initialValue: 'IDLE',
    })
  })

  it('creates an array carrying its base type and dimensions', async () => {
    const result = await executeTool('create_datatype', {
      name: 'Readings',
      derivation: 'array',
      baseType: 'REAL',
      dimensions: ['0..9'],
    })

    expect(result.success).toBe(true)
    expect(datatypeNamed('Readings')).toMatchObject({
      derivation: 'array',
      baseType: { definition: 'base-type', value: 'real' },
      dimensions: [{ dimension: '0..9' }],
    })
  })

  it.each([
    ['no name', { derivation: 'structure' }],
    ['no derivation', { name: 'X' }],
  ])('refuses malformed input with %s', async (_label, input) => {
    const result = await executeTool('create_datatype', input)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required fields')
    expect(project().dataTypes).toHaveLength(0)
  })

  it('refuses a derivation the editor has no representation for', async () => {
    const result = await executeTool('create_datatype', { name: 'X', derivation: 'union' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Invalid derivation')
    expect(project().dataTypes).toHaveLength(0)
  })

  it('refuses a name already taken by a data type', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE'])] })

    const result = await executeTool('create_datatype', { name: 'Mode', derivation: 'enumerated', values: ['ON'] })

    expect(result.success).toBe(false)
    expect(result.message).toContain('already exists')
    expect(enumValues('Mode')).toEqual([{ description: 'IDLE' }])
  })

  it('refuses a name already taken by a POU', async () => {
    seedProject({ pous: [makePou('Conveyor')] })

    const result = await executeTool('create_datatype', {
      name: 'Conveyor',
      derivation: 'structure',
      fields: [{ name: 'x', type: 'INT' }],
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('POU named "Conveyor" already exists')
    expect(project().dataTypes).toHaveLength(0)
  })

  it('refuses a structure with two fields of the same name', async () => {
    const result = await executeTool('create_datatype', {
      name: 'Bad',
      derivation: 'structure',
      fields: [
        { name: 'speed', type: 'INT' },
        { name: 'speed', type: 'BOOL' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Duplicate field name "speed"')
    expect(project().dataTypes).toHaveLength(0)
  })

  it.each([
    ['a structure with no fields', { name: 'S', derivation: 'structure' }, 'at least one field'],
    ['an enumeration with no values', { name: 'E', derivation: 'enumerated' }, 'at least one value'],
    ['an array with no baseType', { name: 'A', derivation: 'array', dimensions: ['0..9'] }, 'baseType'],
    ['an array with no dimensions', { name: 'A', derivation: 'array', baseType: 'INT' }, 'dimensions'],
  ])('refuses %s', async (_label, input, expected) => {
    const result = await executeTool('create_datatype', input)

    expect(result.success).toBe(false)
    expect(result.message).toContain(expected)
    expect(project().dataTypes).toHaveLength(0)
  })
})

describe('update_datatype', () => {
  it('replaces a structure’s field list', async () => {
    seedProject({ dataTypes: [makeStruct('MotorState', [['speed', 'INT']])] })

    const result = await executeTool('update_datatype', {
      name: 'MotorState',
      fields: [{ name: 'rpm', type: 'DINT' }],
    })

    expect(result.success).toBe(true)
    expect(structFields('MotorState')).toEqual([{ name: 'rpm', type: { definition: 'base-type', value: 'dint' } }])
  })

  it('preserves the sections the caller omitted instead of wiping them', async () => {
    // Partial updates must never be read as "replace with nothing".
    seedProject({ dataTypes: [makeStruct('MotorState', [['speed', 'INT']])] })

    const result = await executeTool('update_datatype', { name: 'MotorState', newName: 'DriveState' })

    expect(result.success).toBe(true)
    expect(datatypeNamed('MotorState')).toBeUndefined()
    expect(structFields('DriveState')).toEqual([{ name: 'speed', type: { definition: 'base-type', value: 'INT' } }])
  })

  it('replaces an enumeration’s values and initial value', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE'])] })

    await executeTool('update_datatype', { name: 'Mode', values: ['ON', 'OFF'], initialValue: 'ON' })

    expect(datatypeNamed('Mode')).toMatchObject({
      values: [{ description: 'ON' }, { description: 'OFF' }],
      initialValue: 'ON',
    })
  })

  it('keeps an enumeration’s values when only the initial value is sent', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE', 'RUNNING'])] })

    await executeTool('update_datatype', { name: 'Mode', initialValue: 'RUNNING' })

    expect(enumValues('Mode')).toEqual([{ description: 'IDLE' }, { description: 'RUNNING' }])
  })

  it('replaces an array’s base type and dimensions', async () => {
    seedProject({ dataTypes: [makeArray('Readings', 'INT', ['0..9'])] })

    await executeTool('update_datatype', { name: 'Readings', baseType: 'REAL', dimensions: ['0..99', '0..1'] })

    expect(datatypeNamed('Readings')).toMatchObject({
      baseType: { definition: 'base-type', value: 'real' },
      dimensions: [{ dimension: '0..99' }, { dimension: '0..1' }],
    })
  })

  it('keeps an array’s shape when nothing about it was sent', async () => {
    seedProject({ dataTypes: [makeArray('Readings', 'INT', ['0..9'])] })

    const result = await executeTool('update_datatype', { name: 'Readings' })

    expect(result.success).toBe(true)
    expect(datatypeNamed('Readings')).toMatchObject({
      baseType: { definition: 'base-type', value: 'INT' },
      dimensions: [{ dimension: '0..9' }],
    })
  })

  it('refuses a missing name', async () => {
    const result = await executeTool('update_datatype', {})

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required field: name')
  })

  it('refuses an unknown data type instead of creating one', async () => {
    const result = await executeTool('update_datatype', { name: 'Ghost', values: ['A'] })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
    expect(project().dataTypes).toHaveLength(0)
  })

  it('refuses duplicate field names before touching the stored type', async () => {
    seedProject({ dataTypes: [makeStruct('MotorState', [['speed', 'INT']])] })

    const result = await executeTool('update_datatype', {
      name: 'MotorState',
      fields: [
        { name: 'a', type: 'INT' },
        { name: 'a', type: 'BOOL' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Duplicate field name "a"')
    expect(structFields('MotorState')).toHaveLength(1)
  })

  it('refuses a rename onto an existing data type', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE']), makeEnum('Other', ['X'])] })

    const result = await executeTool('update_datatype', { name: 'Mode', newName: 'Other' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('data type named "Other" already exists')
    expect(datatypeNamed('Mode')).toBeDefined()
  })

  it('refuses a rename onto an existing POU', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE'])], pous: [makePou('Conveyor')] })

    const result = await executeTool('update_datatype', { name: 'Mode', newName: 'Conveyor' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('POU named "Conveyor" already exists')
    expect(datatypeNamed('Mode')).toBeDefined()
  })

  it('reports the user cancelling the reference-impact modal as a failed tool call', async () => {
    // Renaming a referenced type opens a confirmation; declining is not an error, but the model must be told.
    seedProject({
      dataTypes: [makeStruct('MotorState', [['speed', 'INT']])],
      pous: [
        makePou('Conveyor', 'st', '', [
          { ...makeVariable('m'), type: { definition: 'user-data-type', value: 'MotorState' } },
        ]),
      ],
    })

    // The rename parks on the modal promise synchronously, before this call returns its own promise.
    const pending = executeTool('update_datatype', { name: 'MotorState', newName: 'DriveState' })
    openPLCStoreBase.getState().datatypeActions.respondToPendingRename(false)
    const result = await pending

    expect(result.success).toBe(false)
    expect(result.message).toContain('cancelled')
    expect(datatypeNamed('MotorState')).toBeDefined()
    expect(datatypeNamed('DriveState')).toBeUndefined()
  })

  it('propagates a confirmed rename into every variable that referenced the type', async () => {
    seedProject({
      dataTypes: [makeStruct('MotorState', [['speed', 'INT']])],
      pous: [
        makePou('Conveyor', 'st', '', [
          { ...makeVariable('m'), type: { definition: 'user-data-type', value: 'MotorState' } },
        ]),
      ],
    })

    const pending = executeTool('update_datatype', { name: 'MotorState', newName: 'DriveState' })
    openPLCStoreBase.getState().datatypeActions.respondToPendingRename(true)
    const result = await pending

    expect(result.success).toBe(true)
    expect(datatypeNamed('DriveState')).toBeDefined()
    expect(varsOf('Conveyor')[0].type.value).toBe('DriveState')
  })

  it('treats a newName equal to the current name as no rename at all', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE'])] })

    const result = await executeTool('update_datatype', { name: 'Mode', newName: 'Mode', values: ['ON'] })

    expect(result.success).toBe(true)
    expect(result.message).not.toContain('renamed')
    expect(enumValues('Mode')).toEqual([{ description: 'ON' }])
  })
})

describe('delete_datatype', () => {
  it('removes the data type from the project', async () => {
    seedProject({ dataTypes: [makeEnum('Mode', ['IDLE']), makeEnum('Keeper', ['X'])] })

    const result = await executeTool('delete_datatype', { name: 'Mode' })

    expect(result.success).toBe(true)
    expect(project().dataTypes.map((d) => d.name)).toEqual(['Keeper'])
  })

  it('closes the editor model so no tab survives pointing at a deleted type', async () => {
    await executeTool('create_datatype', { name: 'Mode', derivation: 'enumerated', values: ['IDLE'] })

    await executeTool('delete_datatype', { name: 'Mode' })

    expect(openPLCStoreBase.getState().editors.some((e) => e.meta.name === 'Mode')).toBe(false)
  })

  it('refuses a missing name', async () => {
    const result = await executeTool('delete_datatype', {})

    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required field: name')
  })

  it('refuses an unknown data type rather than reporting a delete that removed nothing', async () => {
    seedProject({ dataTypes: [makeEnum('Keeper', ['X'])] })

    const result = await executeTool('delete_datatype', { name: 'Ghost' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
    expect(project().dataTypes).toHaveLength(1)
  })
})

describe('read_project_state', () => {
  it('reports every POU with its type, language, variable count and body size', async () => {
    seedProject({
      pous: [makePou('Conveyor', 'st', 'x := 1;', [makeVariable('speed', 'INT')])],
    })

    const result = await executeTool('read_project_state', {})

    expect(result.success).toBe(true)
    expect(result.message).toContain('POUs (1):')
    expect(result.message).toContain('- Conveyor [program, st] (1 vars, 7 chars)')
    expect(result.message).toContain('local speed : INT')
  })

  it('reports a graphical body as zero characters rather than serialising the graph', async () => {
    seedProject({ pous: [makePou('Rungs', 'ld', { rungs: [{ id: 'r1' }] })] })

    const result = await executeTool('read_project_state', {})

    expect(result.message).toContain('(0 vars, 0 chars)')
    expect(result.message).not.toContain('r1')
  })

  it('shows a variable initial value when one is set', async () => {
    seedProject({
      pous: [makePou('Conveyor', 'st', '', [{ ...makeVariable('speed'), initialValue: '5' }])],
    })

    const result = await executeTool('read_project_state', {})

    expect(result.message).toContain('speed : INT := 5')
  })

  it('lists globals and every data type derivation', async () => {
    seedProject({
      globalVariables: [{ ...makeVariable('flag', 'BOOL', 'global'), initialValue: 'TRUE' }],
      dataTypes: [
        makeStruct('MotorState', [['speed', 'INT']]),
        makeEnum('Mode', ['IDLE', 'RUNNING']),
        makeArray('Readings', 'REAL', ['0..9']),
      ],
    })

    const result = await executeTool('read_project_state', {})

    expect(result.message).toContain('Global Variables (1):')
    expect(result.message).toContain('- flag : BOOL := TRUE')
    expect(result.message).toContain('- MotorState [struct] { speed: INT }')
    expect(result.message).toContain('- Mode [enum] (IDLE, RUNNING)')
    expect(result.message).toContain('- Readings [array] REAL[0..9]')
  })

  it('omits the globals and data types sections when there are none', async () => {
    seedProject({ pous: [makePou('Conveyor')] })

    const result = await executeTool('read_project_state', {})

    expect(result.message).not.toContain('Global Variables')
    expect(result.message).not.toContain('Data Types')
  })
})

describe('project ST cache after a mutating tool', () => {
  // `read_pou_body` on a diagram answers from a 30s whole-project ST cache; a mutating tool must drop it.
  const diagramSt = 'PROGRAM Diagram\nEND_PROGRAM'

  it('transpiles the project again on the next diagram read after update_pou_body', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'old;'), makePou('Diagram', 'ld', { rungs: [] })] })
    const { transpile, callCount } = countingTranspiler(diagramSt)
    const options = { transpileProject: transpile }
    await executeTool('read_pou_body', { name: 'Diagram' }, options)

    await executeTool('update_pou_body', { pouName: 'Conveyor', code: 'new := 2;' })
    const result = await executeTool('read_pou_body', { name: 'Diagram' }, options)

    expect(result.success).toBe(true)
    expect(callCount()).toBe(2)
  })

  it('drops the cached ST outright, not merely the project it was keyed to', async () => {
    // Probing with the pre-edit snapshot isolates the explicit invalidation from the reference check.
    seedProject({ pous: [makePou('Conveyor', 'st', 'old;')] })
    const snapshot = project()
    const { transpile, callCount } = countingTranspiler(diagramSt)
    await transpileProjectToST(snapshot, transpile)

    await executeTool('create_pou', { name: 'Added', type: 'program', language: 'st' })
    await transpileProjectToST(snapshot, transpile)

    expect(callCount()).toBe(2)
  })

  it('keeps the cached ST when the mutating tool refused to write', async () => {
    seedProject({ pous: [makePou('Conveyor', 'st', 'old;')] })
    const snapshot = project()
    const { transpile, callCount } = countingTranspiler(diagramSt)
    await transpileProjectToST(snapshot, transpile)

    await executeTool('update_pou_body', { pouName: 'Ghost', code: 'x := 1;' })
    await transpileProjectToST(snapshot, transpile)

    expect(callCount()).toBe(1)
  })
})
