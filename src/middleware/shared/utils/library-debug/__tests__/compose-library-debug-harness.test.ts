/**
 * Tests for the library debug harness synthesiser.
 *
 * The contract that matters downstream: the harness program must look
 * like an ordinary program POU with `derived`-typed locals, because
 * that is what `buildFbInstanceMap` recognises as a function-block
 * instance.  Everything the debugger does for a library — instance
 * binding, live values inside a block's editor, the watch table —
 * follows from that shape.
 */

import type { PLCBody, PLCPou, PLCProjectData, PLCVariable } from '../../../ports/types'
import {
  composeLibraryDebugHarness,
  HARNESS_INSTANCE_NAME,
  HARNESS_PROGRAM_NAME,
  HARNESS_TASK_NAME,
} from '../compose-library-debug-harness'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function variable(name: string, overrides: Partial<PLCVariable> = {}): PLCVariable {
  return {
    name,
    class: 'input',
    type: { definition: 'base-type', value: 'BOOL' },
    location: '',
    documentation: '',
    ...overrides,
  }
}

function functionBlock(name: string, variables: PLCVariable[] = [], body?: Partial<PLCBody>): PLCPou {
  return {
    name,
    pouType: 'function-block',
    interface: { variables },
    body: { language: 'st', value: '', ...body },
    documentation: '',
  }
}

function libraryData(pous: PLCPou[]): PLCProjectData {
  return {
    pous,
    dataTypes: [],
    libraries: [],
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
  }
}

/**
 * Locate the harness program by NAME, never by position — the tests must not
 * encode the append order the composer happens to use, which is the same
 * coupling `programPou` exists to spare callers.
 */
function harnessProgram(harness: { projectData: PLCProjectData; programName: string }): PLCPou {
  const pou = harness.projectData.pous.find((p) => p.name === harness.programName)
  if (!pou) throw new Error(`harness program ${harness.programName} missing from projectData.pous`)
  return pou
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composeLibraryDebugHarness', () => {
  it('declares one instance per function block and calls each once', () => {
    const harness = composeLibraryDebugHarness(libraryData([functionBlock('Pid'), functionBlock('Ramp')]))

    expect(harness.blocks).toEqual([
      { pouName: 'Pid', instanceVariable: 'PID_I' },
      { pouName: 'Ramp', instanceVariable: 'RAMP_I' },
    ])

    const program = harnessProgram(harness)
    expect(program.name).toBe(HARNESS_PROGRAM_NAME)
    expect(program.pouType).toBe('program')
    // `derived` + the block's own name is exactly what buildFbInstanceMap
    // matches on; anything else and no instance is discovered.
    expect(program.interface?.variables).toEqual([
      expect.objectContaining({ name: 'PID_I', class: 'local', type: { definition: 'derived', value: 'Pid' } }),
      expect.objectContaining({ name: 'RAMP_I', class: 'local', type: { definition: 'derived', value: 'Ramp' } }),
    ])
    expect(program.body).toEqual({ language: 'st', value: 'PID_I();\nRAMP_I();' })
  })

  it('returns the harness program POU so callers never index into pous', () => {
    const harness = composeLibraryDebugHarness(libraryData([functionBlock('Pid')]))
    // Same object, not a copy — the session overlay installs this verbatim.
    expect(harness.programPou).toBe(harnessProgram(harness))
    expect(harness.programPou.name).toBe(harness.programName)
  })

  it('flags every harness variable for debug so the watch table fills on connect', () => {
    const harness = composeLibraryDebugHarness(libraryData([functionBlock('Pid')]))
    const program = harnessProgram(harness)
    expect(program.interface?.variables.every((v) => v.debug === true)).toBe(true)
  })

  it('adds the harness task and instance, replacing whatever the library carried', () => {
    const data = libraryData([functionBlock('Pid')])
    data.configurations.resource.tasks = [{ name: 'stale', triggering: 'Cyclic', interval: 'T#1s', priority: 9 }]
    data.configurations.resource.instances = [{ name: 'stale', program: 'gone', task: 'stale' }]

    const harness = composeLibraryDebugHarness(data)

    expect(harness.projectData.configurations.resource.tasks).toEqual([
      { name: HARNESS_TASK_NAME, triggering: 'Cyclic', interval: 'T#100ms', priority: 1 },
    ])
    expect(harness.projectData.configurations.resource.instances).toEqual([
      { name: HARNESS_INSTANCE_NAME, program: HARNESS_PROGRAM_NAME, task: HARNESS_TASK_NAME },
    ])
    expect(harness.instanceName).toBe(HARNESS_INSTANCE_NAME)
    expect(harness.taskName).toBe(HARNESS_TASK_NAME)
  })

  it('keeps the library POUs and everything else on the project data', () => {
    const data = libraryData([functionBlock('Pid')])
    data.configurations.resource.globalVariables = [variable('SHARED', { class: 'global' })]

    const harness = composeLibraryDebugHarness(data)

    expect(harness.projectData.pous).toHaveLength(2)
    expect(harness.projectData.pous[0].name).toBe('Pid')
    expect(harness.projectData.configurations.resource.globalVariables).toHaveLength(1)
  })

  it('skips functions — they are not instantiable state', () => {
    const fn: PLCPou = {
      name: 'Scale',
      pouType: 'function',
      interface: { returnType: 'REAL', variables: [variable('IN')] },
      body: { language: 'st', value: 'Scale := IN;' },
      documentation: '',
    }
    const harness = composeLibraryDebugHarness(libraryData([fn, functionBlock('Pid')]))

    expect(harness.blocks).toEqual([{ pouName: 'Pid', instanceVariable: 'PID_I' }])
    expect(harness.skipped).toEqual([])
  })

  it('skips Python blocks and says why', () => {
    const harness = composeLibraryDebugHarness(
      libraryData([functionBlock('PyBlock', [], { language: 'python' }), functionBlock('Pid')]),
    )

    expect(harness.blocks).toEqual([{ pouName: 'Pid', instanceVariable: 'PID_I' }])
    expect(harness.skipped).toEqual([
      { pouName: 'PyBlock', reason: expect.stringContaining('Python blocks cannot run on the simulator') },
    ])
  })

  it('instantiates C/C++ blocks — they compile into the firmware', () => {
    const harness = composeLibraryDebugHarness(libraryData([functionBlock('CppBlock', [], { language: 'cpp' })]))
    expect(harness.blocks).toEqual([{ pouName: 'CppBlock', instanceVariable: 'CPPBLOCK_I' }])
    expect(harness.skipped).toEqual([])
  })

  it('binds VAR_IN_OUT members to harness locals at the call site', () => {
    // An unbound VAR_IN_OUT is a reference with nothing behind it, so a bare
    // `BUF_I();` would not compile.
    const harness = composeLibraryDebugHarness(
      libraryData([
        functionBlock('Buf', [
          variable('IN'),
          variable('BUFFER', { class: 'inOut', type: { definition: 'base-type', value: 'DINT' } }),
        ]),
      ]),
    )

    const program = harnessProgram(harness)
    expect(program.interface?.variables).toEqual([
      expect.objectContaining({ name: 'BUF_I' }),
      expect.objectContaining({ name: 'BUF_IO_BUFFER', type: { definition: 'base-type', value: 'DINT' } }),
    ])
    expect(program.body.value).toBe('BUF_I(BUFFER := BUF_IO_BUFFER);')
  })

  it('honours the include filter, case-insensitively', () => {
    const harness = composeLibraryDebugHarness(
      libraryData([functionBlock('Pid'), functionBlock('Ramp'), functionBlock('Filter')]),
      { include: ['pid', 'FILTER'] },
    )
    expect(harness.blocks.map((b) => b.pouName)).toEqual(['Pid', 'Filter'])
    // A filtered-out block is a choice, not a problem — nothing to warn about.
    expect(harness.skipped).toEqual([])
  })

  it('returns no blocks for a library with nothing instantiable', () => {
    const harness = composeLibraryDebugHarness(libraryData([]))
    expect(harness.blocks).toEqual([])
    expect(harnessProgram(harness).interface?.variables).toEqual([])
  })

  it('uniquifies instance names when two blocks generate the same one', () => {
    // `Pid` and `PID` are the same identifier to IEC, so the generated
    // instance names collide.
    const harness = composeLibraryDebugHarness(libraryData([functionBlock('Pid'), functionBlock('PID')]))
    expect(harness.blocks.map((b) => b.instanceVariable)).toEqual(['PID_I', 'PID_I_2'])
  })

  it('yields the program name when the library already owns LIBDBG_MAIN', () => {
    const harness = composeLibraryDebugHarness(libraryData([functionBlock(HARNESS_PROGRAM_NAME), functionBlock('Pid')]))
    expect(harness.programName).toBe(`${HARNESS_PROGRAM_NAME}_2`)
    expect(harnessProgram(harness).name).toBe(`${HARNESS_PROGRAM_NAME}_2`)
    expect(harness.projectData.configurations.resource.instances[0].program).toBe(`${HARNESS_PROGRAM_NAME}_2`)
  })

  it('accepts a scan-interval override', () => {
    const harness = composeLibraryDebugHarness(libraryData([functionBlock('Pid')]), { scanInterval: 'T#20ms' })
    expect(harness.projectData.configurations.resource.tasks[0].interval).toBe('T#20ms')
  })

  it('does not mutate the project data it was given', () => {
    const data = libraryData([functionBlock('Pid')])
    const before = JSON.stringify(data)
    composeLibraryDebugHarness(data)
    expect(JSON.stringify(data)).toBe(before)
  })
})
