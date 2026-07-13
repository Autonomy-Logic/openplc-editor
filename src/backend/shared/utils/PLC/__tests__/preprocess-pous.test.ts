// structuredClone is available in Node 17+ but jsdom test environment may not expose it
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
}

import type { PLCPou, PLCProjectData, PLCVariable } from '../../../../../middleware/shared/ports/types'
import { preprocessPous } from '../preprocess-pous'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function makeVariable(name: string, cls: PLCVariable['class'] = 'local', type = 'INT'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'base-type', value: type },
    location: '',
    documentation: '',
    debug: false,
  }
}

function makeStPou(name: string, body = ''): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: [makeVariable('x')] },
    body: { language: 'st', value: body },
    documentation: '',
  }
}

function makePythonPou(name: string, code: string, variables?: PLCVariable[]): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: variables ?? [makeVariable('a', 'input'), makeVariable('b', 'output')] },
    body: { language: 'python', value: code },
    documentation: '',
  }
}

function makeCppPou(name: string, code: string, variables?: PLCVariable[]): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: variables ?? [makeVariable('x', 'input'), makeVariable('y', 'output')] },
    body: { language: 'cpp', value: code },
    documentation: '',
  }
}

function makeProjectData(pous: PLCPou[]): PLCProjectData {
  return {
    dataTypes: [],
    pous,
    configurations: {
      resource: {
        tasks: [],
        instances: [],
        globalVariables: [],
      },
    },
  }
}

function collectLog(): { log: (level: 'info' | 'error', message: string) => void; messages: string[] } {
  const messages: string[] = []
  return {
    log: (_level: 'info' | 'error', message: string) => {
      messages.push(message)
    },
    messages,
  }
}

// ---------------------------------------------------------------------------
// ST/IL passthrough
// ---------------------------------------------------------------------------
describe('preprocessPous — ST/IL passthrough', () => {
  it('returns ST POUs unchanged', () => {
    const project = makeProjectData([makeStPou('Main', '// line comment\nx := 1;')])
    const logger = collectLog()
    const { projectData, validationFailed } = preprocessPous(project, false, logger.log)

    expect(validationFailed).toBe(false)
    expect(projectData.pous[0].body.value).toBe('// line comment\nx := 1;')
    expect(projectData.pous[0].body.language).toBe('st')
  })

  it('returns IL POUs unchanged', () => {
    const project = makeProjectData([
      {
        name: 'IlProg',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'il', value: '// il comment\nLD x' },
        documentation: '',
      },
    ])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)

    expect(projectData.pous[0].body.value).toBe('// il comment\nLD x')
  })
})

// ---------------------------------------------------------------------------
// Python processing
// ---------------------------------------------------------------------------
describe('preprocessPous — Python', () => {
  it('replaces Python POUs with ST stubs in simulator mode', () => {
    const project = makeProjectData([makePythonPou('PyProg', 'print("hello")')])
    const logger = collectLog()
    const { projectData, validationFailed } = preprocessPous(project, true, logger.log)

    expect(validationFailed).toBe(false)
    expect(projectData.pous[0].body.language).toBe('st')
    expect(projectData.pous[0].body.value).toBe('first_run := 0;')
    expect(logger.messages.some((m) => m.includes('empty stubs for simulator'))).toBe(true)
  })

  it('processes Python POUs with full pipeline in non-simulator mode', () => {
    const project = makeProjectData([makePythonPou('PyProg', 'x = 1')])
    const logger = collectLog()
    const { projectData, validationFailed } = preprocessPous(project, false, logger.log)

    expect(validationFailed).toBe(false)
    expect(projectData.pous[0].body.language).toBe('st')
    // The generated ST code should contain C blocks and function references
    const body = projectData.pous[0].body.value as string
    // STruC++ uses `{external …}` pragma blocks for inline C/C++.
    expect(body).toContain('{external')
    expect(logger.messages.some((m) => m.includes('Successfully processed'))).toBe(true)
  })

  it('adds runtime local variables to Python POUs', () => {
    const project = makeProjectData([makePythonPou('PyProg', 'pass')])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, true, logger.log)

    const vars = projectData.pous[0].interface?.variables ?? []
    expect(vars.some((v) => v.name === 'first_run')).toBe(true)
    expect(vars.some((v) => v.name === 'shm_in_ptr')).toBe(true)
    expect(vars.some((v) => v.name === 'shm_out_ptr')).toBe(true)
  })

  it('skips Python processing when no Python POUs exist', () => {
    const project = makeProjectData([makeStPou('Main', 'x := 1;')])
    const logger = collectLog()
    preprocessPous(project, false, logger.log)
    expect(logger.messages.some((m) => m.includes('Python'))).toBe(false)
  })

  it('preserves non-Python POUs in full pipeline mode when mixed with Python', () => {
    const project = makeProjectData([makeStPou('StProg', 'x := 1;'), makePythonPou('PyProg', 'pass')])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)
    // ST POU should pass through the Python non-simulator map unchanged
    expect(projectData.pous[0].body.language).toBe('st')
    // Python POU should be converted to ST
    expect(projectData.pous[1].body.language).toBe('st')
  })

  it('preserves non-Python POUs unchanged in simulator mode when mixed with Python', () => {
    const project = makeProjectData([makeStPou('StProg', 'x := 1;'), makePythonPou('PyProg', 'pass')])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, true, logger.log)

    // ST POU should pass through the Python simulator map unchanged
    expect(projectData.pous[0].body.language).toBe('st')
    expect(projectData.pous[0].body.value).toBe('x := 1;')
    // Python POU should be stubbed
    expect(projectData.pous[1].body.value).toBe('first_run := 0;')
  })

  it('logs each Python POU found', () => {
    const project = makeProjectData([makePythonPou('Py1', 'pass'), makePythonPou('Py2', 'pass')])
    const logger = collectLog()
    preprocessPous(project, false, logger.log)
    expect(logger.messages.filter((m) => m.includes('Found Python POU')).length).toBe(2)
  })

  it('handles Python POU with no interface (undefined)', () => {
    const pou: PLCPou = {
      name: 'NoIface',
      pouType: 'program',
      body: { language: 'python', value: 'pass' },
      documentation: '',
    }
    const project = makeProjectData([pou])
    const logger = collectLog()
    const { projectData, validationFailed } = preprocessPous(project, true, logger.log)
    expect(validationFailed).toBe(false)
    // Should still work -- interface gets created by addPythonLocalVariables
    expect(projectData.pous[0].body.language).toBe('st')
  })
})

// ---------------------------------------------------------------------------
// C++ processing
// ---------------------------------------------------------------------------
describe('preprocessPous — C++', () => {
  const validCppCode = 'void setup() {}\nvoid loop() {}'

  it('processes valid C++ POUs and replaces with ST code', () => {
    const project = makeProjectData([makeCppPou('CppProg', validCppCode)])
    const logger = collectLog()
    const { projectData, validationFailed } = preprocessPous(project, false, logger.log)

    expect(validationFailed).toBe(false)
    expect(projectData.pous[0].body.language).toBe('st')
    const body = projectData.pous[0].body.value as string
    // STruC++ uses `{external …}` pragma blocks for inline C/C++.
    expect(body).toContain('{external')
    expect(logger.messages.some((m) => m.includes('Successfully processed'))).toBe(true)
  })

  it('stores original C++ POU data in originalCppPous', () => {
    const project = makeProjectData([makeCppPou('CppProg', validCppCode)])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)

    expect(projectData.originalCppPous).toBeDefined()
    expect(projectData.originalCppPous!.length).toBe(1)
    expect(projectData.originalCppPous![0].name).toBe('CppProg')
    expect(projectData.originalCppPous![0].code).toBe(validCppCode)
  })

  it('returns validationFailed=true for invalid C++ code', () => {
    const project = makeProjectData([makeCppPou('CppProg', 'no setup or loop')])
    const logger = collectLog()
    const { validationFailed } = preprocessPous(project, false, logger.log)

    expect(validationFailed).toBe(true)
    expect(logger.messages.some((m) => m.includes('Validation failed'))).toBe(true)
  })

  it('adds hasBeenInitialized local variable', () => {
    const project = makeProjectData([makeCppPou('CppProg', validCppCode)])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)

    const vars = projectData.pous[0].interface?.variables ?? []
    expect(vars.some((v) => v.name === 'hasBeenInitialized')).toBe(true)
  })

  it('keeps C++ sidecar variables aligned with the generated ST bridge', () => {
    const variables = [
      makeVariable('Enable', 'input', 'BOOL'),
      makeVariable('PrevSeq', 'local', 'USINT'),
      makeVariable('NewData', 'output', 'BOOL'),
    ]
    const project = makeProjectData([makeCppPou('can_rx', validCppCode, variables)])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)

    const body = projectData.pous[0].body.value as string
    expect(body).toContain('vars.PREVSEQ = &PREVSEQ;')
    expect(projectData.originalCppPous?.[0].variables.map((v) => v.name)).toEqual(
      expect.arrayContaining(['PrevSeq', 'hasBeenInitialized']),
    )
  })

  it('skips C++ processing when no C++ POUs exist', () => {
    const project = makeProjectData([makeStPou('Main', 'x := 1;')])
    const logger = collectLog()
    preprocessPous(project, false, logger.log)
    expect(logger.messages.some((m) => m.includes('C/C++'))).toBe(false)
  })

  it('logs each C++ POU found', () => {
    const project = makeProjectData([makeCppPou('Cpp1', validCppCode), makeCppPou('Cpp2', validCppCode)])
    const logger = collectLog()
    preprocessPous(project, false, logger.log)
    expect(logger.messages.filter((m) => m.includes('Found C/C++ POU')).length).toBe(2)
  })

  it('handles C++ POU with no interface (undefined)', () => {
    const pou: PLCPou = {
      name: 'CppNoIface',
      pouType: 'program',
      body: { language: 'cpp', value: validCppCode },
      documentation: '',
    }
    const project = makeProjectData([pou])
    const logger = collectLog()
    const { projectData, validationFailed } = preprocessPous(project, false, logger.log)
    expect(validationFailed).toBe(false)
    expect(projectData.pous[0].body.language).toBe('st')
  })

  it('preserves non-C++ POUs when processing C++ alongside them', () => {
    const project = makeProjectData([makeStPou('StProg', 'x := 1;'), makeCppPou('CppProg', validCppCode)])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)
    // ST POU should remain unchanged through C++ processing map
    expect(projectData.pous[0].body.language).toBe('st')
    expect(projectData.pous[1].body.language).toBe('st')
  })
})

// ---------------------------------------------------------------------------
// Mixed scenarios
// ---------------------------------------------------------------------------
describe('preprocessPous — mixed', () => {
  it('handles a project with ST, Python, and C++ POUs', () => {
    const project = makeProjectData([
      makeStPou('StProg', 'x := 1;'),
      makePythonPou('PyProg', 'pass'),
      makeCppPou('CppProg', 'void setup() {}\nvoid loop() {}'),
    ])
    const logger = collectLog()
    const { projectData, validationFailed } = preprocessPous(project, false, logger.log)

    expect(validationFailed).toBe(false)
    // All should have been processed
    expect(projectData.pous.length).toBe(3)
    // Python and C++ should now be ST
    expect(projectData.pous[1].body.language).toBe('st')
    expect(projectData.pous[2].body.language).toBe('st')
  })

  it('does not include originalCppPous when no C++ code', () => {
    const project = makeProjectData([makeStPou('Main', 'x := 1;')])
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)
    expect(projectData.originalCppPous).toBeUndefined()
  })

  it('generates SoftMotion axis artifacts for a CiA 402 EtherCAT drive', () => {
    const project: PLCProjectData = {
      ...makeProjectData([makeStPou('main', 'pwr(Axis := X_Axis, Enable := TRUE);')]),
      remoteDevices: [
        {
          name: 'ethercat-bus',
          protocol: 'ethercat',
          ethercatConfig: {
            devices: [
              {
                id: 'd1',
                name: 'X_Axis',
                esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
                vendorId: '0x0',
                productCode: '0x0',
                revisionNo: '0x0',
                addedFrom: 'repository',
                config: {},
                cia402: { enabled: true, scaleNum: 1, scaleDenom: 1, scaleFactor: 1 },
                channelInfo: [
                  {
                    channelId: 'c1',
                    name: 'Controlword',
                    direction: 'output',
                    pdoIndex: '0x1600',
                    entryIndex: '0x6040',
                    entrySubIndex: '0x0',
                    dataType: 'UINT',
                    bitLen: 16,
                    iecType: 'UINT',
                  },
                  {
                    channelId: 'c2',
                    name: 'Statusword',
                    direction: 'input',
                    pdoIndex: '0x1A00',
                    entryIndex: '0x6041',
                    entrySubIndex: '0x0',
                    dataType: 'UINT',
                    bitLen: 16,
                    iecType: 'UINT',
                  },
                ],
                channelMappings: [
                  { channelId: 'c1', iecLocation: '%QW0' },
                  { channelId: 'c2', iecLocation: '%IW0' },
                ],
              },
            ],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    }
    const logger = collectLog()
    const { projectData } = preprocessPous(project, false, logger.log)
    // Bridge program + axis global generated; VAR_EXTERNAL injected into main.
    expect(projectData.pous.some((p) => p.name === '__sm3_bridge')).toBe(true)
    expect(
      projectData.configurations.resource.globalVariables.some(
        (g) => g.name === 'X_Axis' && g.type.value === 'AXIS_REF_SM3',
      ),
    ).toBe(true)
    const main = projectData.pous.find((p) => p.name === 'main')!
    expect(main.interface!.variables.some((v) => v.name === 'X_Axis' && v.class === 'external')).toBe(true)
  })
})
