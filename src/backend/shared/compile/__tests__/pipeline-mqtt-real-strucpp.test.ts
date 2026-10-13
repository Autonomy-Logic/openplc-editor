import { createDefaultMqttIntegration } from '../../../../frontend/utils/mqtt/project/model'
import type {
  MqttProjectIntegrationV1,
  MqttProjectSelectionV1,
  MqttRuntimeConfigV1,
  MqttSourceToken,
} from '../../../../frontend/utils/mqtt/contract/contract'
import type {
  CompilerPlatformPort,
  MaterializeRuntimeV4BundleArgs,
  UploadRuntimeV4Args,
} from '../../../../middleware/shared/ports/compiler-platform-port'
import hals from '../../firmware/hals.json'
import { __setStrucppRuntimeForTests } from '../../library/strucpp-runtime'
import type { PLCProjectData } from '../../types/PLC/open-plc'
import { type PipelineProgressEvent, runCompilePipeline, type RunCompilePipelineArgs } from '../pipeline'

const PROGRAM_ST = `TYPE
  Point : STRUCT
    X : REAL;
    Tags : ARRAY[1..2] OF INT;
  END_STRUCT;
  Color : (Red, Green);
END_TYPE

FUNCTION_BLOCK Stepper
  VAR_INPUT
    En : BOOL;
  END_VAR
  VAR_OUTPUT
    Cnt : DINT;
  END_VAR
  IF En THEN
    Cnt := Cnt + 1;
  END_IF;
END_FUNCTION_BLOCK

PROGRAM Main
  VAR
    Counter : DINT;
    Toggle : BOOL;
    Grid : ARRAY[-1..0, 2..3] OF INT;
    P : Point;
    Fb1 : Stepper;
    Mode : Color;
    W : WSTRING;
    Big : LINT;
  END_VAR
  VAR_EXTERNAL
    GCount : DINT;
  END_VAR
  Counter := Counter + 1;
  Toggle := NOT Toggle;
  Fb1(En := TRUE);
  GCount := GCount + 1;
END_PROGRAM

CONFIGURATION Config0
  VAR_GLOBAL
    GCount : DINT;
  END_VAR
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : Main;
  END_RESOURCE
END_CONFIGURATION
`
const PROGRAM_MD5 = '9b2f3c1d0e4a5b6c7d8e9f0a1b2c3d4e'

const variable = (name: string, cls = 'local', value = 'DINT', definition = 'base-type') => ({
  name,
  class: cls,
  type: { definition, value },
  location: '',
  documentation: '',
})

const projectData = (mqttConfig: MqttProjectIntegrationV1): PLCProjectData =>
  ({
    pous: [
      {
        type: 'program',
        data: {
          language: 'st',
          name: 'Main',
          variables: [
            variable('Counter'),
            variable('Toggle', 'local', 'BOOL'),
            {
              ...variable('Grid'),
              type: {
                definition: 'array',
                value: 'ARRAY[-1..0, 2..3] OF INT',
                data: {
                  baseType: { definition: 'base-type', value: 'INT' },
                  dimensions: [{ dimension: '-1..0' }, { dimension: '2..3' }],
                },
              },
            },
            variable('P', 'local', 'Point', 'user-data-type'),
            variable('Fb1', 'local', 'Stepper', 'derived'),
            variable('Mode', 'local', 'Color', 'user-data-type'),
            variable('W', 'local', 'WSTRING'),
            variable('Big', 'local', 'LINT'),
            variable('GCount', 'external'),
          ],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      },
      {
        type: 'function-block',
        data: {
          language: 'st',
          name: 'Stepper',
          variables: [variable('En', 'input', 'BOOL'), variable('Cnt', 'output')],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      },
    ],
    dataTypes: [
      {
        name: 'Point',
        derivation: 'structure',
        variable: [
          { name: 'X', type: { definition: 'base-type', value: 'REAL' } },
          {
            name: 'Tags',
            type: {
              definition: 'array',
              value: 'ARRAY[1..2] OF INT',
              data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '1..2' }] },
            },
          },
        ],
      },
      { name: 'Color', derivation: 'enumerated', values: [{ description: 'Red' }, { description: 'Green' }] },
    ],
    configuration: {
      resource: {
        tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
        instances: [{ name: 'instance0', task: 'task0', program: 'Main' }],
        globalVariables: [
          { name: 'GCount', type: { definition: 'base-type', value: 'DINT' }, location: '', documentation: '' },
        ],
      },
    },
    servers: [{ name: 'broker', protocol: 'mqtt', mqttConfig }],
    remoteDevices: [],
  }) as unknown as PLCProjectData

const programToken: MqttSourceToken[] = [
  { role: 'instance', name: 'instance0' },
  { role: 'program', name: 'Main' },
]
const select = (...rest: MqttSourceToken[]): MqttProjectSelectionV1 => ({
  source: { tokens: [...programToken, ...rest] },
})
const v = (name: string): MqttSourceToken => ({ role: 'variable', name })
const f = (name: string): MqttSourceToken => ({ role: 'field', name })

const SELECTIONS: MqttProjectSelectionV1[] = [
  select(v('Counter')),
  select(v('Toggle')),
  select(v('Grid'), { role: 'index', indices: [-1, 3] }),
  select(v('P'), f('Tags'), { role: 'index', indices: [2] }),
  select(v('Fb1'), f('Cnt')),
  select(v('W')),
  select(v('Big')),
  { source: { tokens: [{ role: 'instance', name: 'Config0' }, v('GCount')] } },
]

const integration = (overrides: Partial<MqttProjectIntegrationV1> = {}): MqttProjectIntegrationV1 => {
  const base = createDefaultMqttIntegration('plc-linha1')
  return {
    ...base,
    enabled: true,
    connection: { ...base.connection, host: 'broker.example.net' },
    selections: SELECTIONS,
    ...overrides,
  }
}

interface Capture {
  uploaded: UploadRuntimeV4Args['bundle'][]
  materialized: MaterializeRuntimeV4BundleArgs['bundle'][]
}

const makePort = (capture: Capture): CompilerPlatformPort => ({
  computeMd5: () => Promise.resolve(PROGRAM_MD5),
  transpileToSt: () => Promise.resolve({ ok: true, programSt: PROGRAM_ST }),
  installArduinoCore: () => Promise.resolve({ ok: true }),
  installArduinoLib: () => Promise.resolve({ ok: true }),
  compileArduino: () => Promise.resolve({ ok: false }),
  uploadRuntimeV4: (args) => {
    capture.uploaded.push(args.bundle)
    return Promise.resolve({ ok: true })
  },
  uploadArduinoBoard: () => Promise.resolve({ ok: false }),
  uploadRuntimeV3: () => Promise.resolve({ ok: false }),
  checkRuntimeVersion: () =>
    Promise.resolve({ ok: true, version: '4.2.0', minEditorVersion: null, supportsProjectSnapshot: false }),
  packageVppPlugin: () => Promise.resolve({ files: {} }),
  materializeRuntimeV4Bundle: (args) => {
    capture.materialized.push(args.bundle)
    return Promise.resolve({ written: Object.keys(args.bundle).length })
  },
})

const run = async (config: MqttProjectIntegrationV1, overrides: Partial<RunCompilePipelineArgs> = {}) => {
  const capture: Capture = { uploaded: [], materialized: [] }
  const events: PipelineProgressEvent[] = []
  const result = await runCompilePipeline(
    {
      projectData: projectData(config),
      boardTarget: 'OpenPLC Runtime v4',
      boardRuntime: 'openplc-compiler',
      boardEntry: hals['OpenPLC Runtime v4'] as unknown as RunCompilePipelineArgs['boardEntry'],
      devicePinMapping: [],
      isSimulator: false,
      isRuntimeV4: true,
      isRuntimeV3: false,
      compileOnly: false,
      libraryArchives: [],
      missingLibraries: [],
      firmwareSkeleton: {},
      strucppRuntimeHeaders: {},
      avrLibStdCppInclude: '',
      arduinoCliParallel: false,
      deviceContext: { kind: 'editor-https', ip: '127.0.0.1', jwt: 'jwt' },
      ...overrides,
    },
    makePort(capture),
    (event) => events.push(event),
  )
  return { result, capture, events }
}

const debugLeaves = (bundle: Record<string, string | Uint8Array>) => {
  const content = bundle['debug-map.json']
  if (typeof content !== 'string') throw new Error('debug-map.json missing')
  const map = JSON.parse(content) as {
    md5: string
    leaves: Array<{ arrayIdx: number; elemIdx: number; path: string; type: string; size: number }>
  }
  return { md5: map.md5, byPath: new Map(map.leaves.map((l) => [l.path, l])) }
}

const mqttConf = (bundle: Record<string, string | Uint8Array>): MqttRuntimeConfigV1 => {
  const content = bundle['conf/mqtt.json']
  if (typeof content !== 'string') throw new Error('conf/mqtt.json missing')
  return JSON.parse(content) as MqttRuntimeConfigV1
}

beforeAll(() => {
  __setStrucppRuntimeForTests(null)
})

describe('Compile + Download with MQTT against the real STruC++', () => {
  it('uploads conf/mqtt.json whose leaves are the compiled addresses of the selected values', async () => {
    const { result, capture, events } = await run(integration())
    expect(events.filter((e) => e.level === 'error')).toEqual([])
    expect(result).toMatchObject({ success: true, uploaded: true })
    expect(capture.uploaded).toHaveLength(1)
    const bundle = capture.uploaded[0]
    const conf = mqttConf(bundle)
    const program = debugLeaves(bundle)
    expect(conf.program.md5).toBe(program.md5)
    expect(conf.leaves.map((l) => [l.source.debug_path, l.iec_type, l.size, l.destination])).toEqual([
      ['INSTANCE0.COUNTER', 'DINT', 4, 'openplc/plc-linha1/instance0/Main/Counter'],
      ['INSTANCE0.TOGGLE', 'BOOL', 1, 'openplc/plc-linha1/instance0/Main/Toggle'],
      ['INSTANCE0.GRID[-1][3]', 'INT', 2, 'openplc/plc-linha1/instance0/Main/Grid/-1,3'],
      ['INSTANCE0.P.TAGS[2]', 'INT', 2, 'openplc/plc-linha1/instance0/Main/P/Tags/2'],
      ['INSTANCE0.FB1.CNT', 'DINT', 4, 'openplc/plc-linha1/instance0/Main/Fb1/Cnt'],
      ['INSTANCE0.W', 'WSTRING', 253, 'openplc/plc-linha1/instance0/Main/W'],
      ['INSTANCE0.BIG', 'LINT', 8, 'openplc/plc-linha1/instance0/Main/Big'],
      ['GCOUNT', 'DINT', 4, 'openplc/plc-linha1/Config0/GCount'],
    ])
    for (const leaf of conf.leaves) {
      const compiled = program.byPath.get(leaf.source.debug_path)
      expect(compiled).toBeDefined()
      expect(leaf.address).toEqual({ arr: compiled?.arrayIdx, elem: compiled?.elemIdx })
      expect(leaf.iec_type).toBe(compiled?.type)
      expect(leaf.size).toBe(compiled?.size)
    }
    expect(capture.materialized[0]['conf/mqtt.json']).toBe(bundle['conf/mqtt.json'])
    expect(events.some((e) => e.message === 'Generated conf/mqtt.json for "broker": 8 leaves, mode generic')).toBe(true)
  })

  it('uploads a Sparkplug configuration with its birth bound', async () => {
    const { result, capture, events } = await run(integration({ mode: 'sparkplug_b' }))
    expect(result.success).toBe(true)
    // 1038 is what the runtime's sparkplug_birth_upper_bound returns for this bundle.
    expect(events.some((e) => e.message.endsWith('mode sparkplug_b, NBIRTH up to 1038 bytes'))).toBe(true)
    const conf = mqttConf(capture.uploaded[0])
    expect(conf).toMatchObject({ mode: 'sparkplug_b', sparkplug: { group_id: 'openplc', edge_node_id: 'plc-linha1' } })
    expect(conf.leaves.map((l) => l.destination)).toContain('instance0.Main.Grid[-1,3]')
  })

  it('leaves conf/mqtt.json out of the bundle when the integration is disabled', async () => {
    const { result, capture } = await run(integration({ enabled: false }))
    expect(result).toMatchObject({ success: true, uploaded: true })
    expect('conf/mqtt.json' in capture.uploaded[0]).toBe(false)
  })

  it('writes the same conf/mqtt.json on a compile-only build without uploading', async () => {
    const { result, capture } = await run(integration(), { compileOnly: true })
    expect(result).toMatchObject({ success: true, uploaded: false })
    expect(capture.uploaded).toHaveLength(0)
    expect(mqttConf(capture.materialized[0]).leaves).toHaveLength(8)
  })

  it('stops before writing or uploading anything when a selection does not match the program', async () => {
    const { result, capture, events } = await run(integration({ selections: [...SELECTIONS, select(v('Removed'))] }))
    expect(result.success).toBe(false)
    expect(capture.uploaded).toHaveLength(0)
    expect(capture.materialized).toHaveLength(0)
    expect(
      events.some((e) => e.level === 'error' && e.message.includes('project_selection_unresolved/leaf_missing')),
    ).toBe(true)
  })

  it('refuses an enumeration even though the compiler stores it as INT', async () => {
    const { result, capture, events } = await run(integration({ selections: [select(v('Mode'))] }))
    expect(result.success).toBe(false)
    expect(capture.uploaded).toHaveLength(0)
    expect(events.some((e) => e.message.includes('config_type_unsupported/type_enumeration'))).toBe(true)
  })
})
