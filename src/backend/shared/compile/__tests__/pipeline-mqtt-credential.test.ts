// Byte-identical with openplc-web; runs under Jest and Vitest.

import type { MqttProjectIntegrationV1, MqttRuntimeConfigV1 } from '../../../../frontend/utils/mqtt/contract/contract'
import { createDefaultMqttIntegration } from '../../../../frontend/utils/mqtt/project/model'
import type {
  CompilerPlatformPort,
  DiscardMqttCredentialStagingArgs,
  MaterializeRuntimeV4BundleArgs,
  PlatformDeviceContext,
  StageMqttCredentialArgs,
  StageMqttCredentialResult,
  UploadRuntimeV4Args,
} from '../../../../middleware/shared/ports/compiler-platform-port'
import hals from '../../firmware/hals.json'
import { __setStrucppRuntimeForTests } from '../../library/strucpp-runtime'
import type { PLCProjectData } from '../../types/PLC/open-plc'
import { type PipelineProgressEvent, runCompilePipeline, type RunCompilePipelineArgs } from '../pipeline'

const PROGRAM_ST = `PROGRAM Main
  VAR
    Counter : DINT;
    Toggle : BOOL;
  END_VAR
  Counter := Counter + 1;
  Toggle := NOT Toggle;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : Main;
  END_RESOURCE
END_CONFIGURATION
`

const STAGING_ID = '0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70'
const CREDENTIAL_ID = '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f'
const SECRET_MARKER = 'MARKER-PW-e5-pipeline-5c21'

const variable = (name: string, value: string) => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value },
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
          variables: [variable('Counter', 'DINT'), variable('Toggle', 'BOOL')],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      },
    ],
    dataTypes: [],
    configuration: {
      resource: {
        tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
        instances: [{ name: 'instance0', task: 'task0', program: 'Main' }],
        globalVariables: [],
      },
    },
    servers: [{ name: 'broker', protocol: 'mqtt', mqttConfig }],
    remoteDevices: [],
  }) as unknown as PLCProjectData

const integration = (overrides: Partial<MqttProjectIntegrationV1> = {}): MqttProjectIntegrationV1 => {
  const base = createDefaultMqttIntegration('plc-linha1')
  return {
    ...base,
    enabled: true,
    authMethod: 'username_password',
    connection: { ...base.connection, host: 'broker.example.net' },
    selections: [
      {
        source: {
          tokens: [
            { role: 'instance', name: 'instance0' },
            { role: 'program', name: 'Main' },
            { role: 'variable', name: 'Counter' },
          ],
        },
      },
    ],
    ...overrides,
  }
}

type Step = string

interface Harness {
  steps: Step[]
  staged: StageMqttCredentialArgs[]
  discarded: DiscardMqttCredentialStagingArgs[]
  uploaded: UploadRuntimeV4Args['bundle'][]
  materialized: MaterializeRuntimeV4BundleArgs['bundle'][]
}

interface PortOptions {
  stage?: ((args: StageMqttCredentialArgs) => Promise<StageMqttCredentialResult>) | null
  uploadOk?: boolean
  version?: string
  failConfMaterialize?: boolean
}

const staged = (stagingId: string | null = STAGING_ID): StageMqttCredentialResult => ({
  ok: true,
  credentialRef: { id: CREDENTIAL_ID, revision: 4, staging_id: stagingId },
  stagingId,
})

const makePort = (harness: Harness, options: PortOptions = {}): CompilerPlatformPort => {
  const port: CompilerPlatformPort = {
    computeMd5: () => Promise.resolve('9b2f3c1d0e4a5b6c7d8e9f0a1b2c3d4e'),
    transpileToSt: () => Promise.resolve({ ok: true, programSt: PROGRAM_ST }),
    installArduinoCore: () => Promise.resolve({ ok: true }),
    installArduinoLib: () => Promise.resolve({ ok: true }),
    compileArduino: () => Promise.resolve({ ok: false }),
    uploadRuntimeV4: (args) => {
      harness.steps.push('upload')
      harness.uploaded.push({ ...args.bundle })
      return Promise.resolve({ ok: options.uploadOk ?? true })
    },
    uploadArduinoBoard: () => Promise.resolve({ ok: false }),
    uploadRuntimeV3: () => Promise.resolve({ ok: false }),
    checkRuntimeVersion: () => {
      harness.steps.push('version')
      return Promise.resolve({
        ok: true,
        version: options.version ?? '4.3.0',
        minEditorVersion: null,
        supportsProjectSnapshot: false,
      })
    },
    packageVppPlugin: () => {
      harness.steps.push('vpp')
      return Promise.resolve({ files: {} })
    },
    materializeRuntimeV4Bundle: (args) => {
      harness.materialized.push({ ...args.bundle })
      const confOnly = Object.keys(args.bundle).length === 1 && 'conf/mqtt.json' in args.bundle
      harness.steps.push(confOnly ? 'materialize-conf' : 'materialize')
      if (confOnly && options.failConfMaterialize) {
        return Promise.resolve({
          written: 0,
          errors: [{ message: 'disk full', line: 0, column: 0, severity: 'error' }],
        })
      }
      return Promise.resolve({ written: Object.keys(args.bundle).length })
    },
    discardMqttCredentialStaging: (args) => {
      harness.steps.push('discard')
      harness.discarded.push(args)
      return Promise.resolve()
    },
  }
  if (options.stage !== null) {
    const stage = options.stage ?? (() => Promise.resolve(staged()))
    port.stageMqttCredential = (args) => {
      harness.steps.push('stage')
      harness.staged.push(args)
      return stage(args)
    }
  }
  return port
}

const CONTEXT: PlatformDeviceContext = { kind: 'editor-https', ip: '192.0.2.10', jwt: 'jwt' }

const run = async (
  config: MqttProjectIntegrationV1,
  options: PortOptions = {},
  overrides: Partial<RunCompilePipelineArgs> = {},
) => {
  const harness: Harness = { steps: [], staged: [], discarded: [], uploaded: [], materialized: [] }
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
      deviceContext: CONTEXT,
      ...overrides,
    },
    makePort(harness, options),
    (event) => events.push(event),
  )
  return { result, harness, events }
}

const mqttConf = (bundle: Record<string, string | Uint8Array>): MqttRuntimeConfigV1 => {
  const content = bundle['conf/mqtt.json']
  if (typeof content !== 'string') throw new Error('conf/mqtt.json missing')
  return JSON.parse(content) as MqttRuntimeConfigV1
}

const debugMapMd5 = (bundle: Record<string, string | Uint8Array>): string => {
  const content = bundle['debug-map.json']
  if (typeof content !== 'string') throw new Error('debug-map.json missing')
  return (JSON.parse(content) as { md5: string }).md5
}

const errors = (events: PipelineProgressEvent[]) => events.filter((e) => e.level === 'error').map((e) => e.message)

beforeAll(() => {
  __setStrucppRuntimeForTests(null)
})

describe('Download with an MQTT credential against the real STruC++', () => {
  it('stages after every gate and uploads conf/mqtt.json with the staged reference', async () => {
    const { result, harness, events } = await run(integration())
    expect(errors(events)).toEqual([])
    expect(result).toMatchObject({ success: true, uploaded: true })
    expect(harness.steps).toEqual(['version', 'vpp', 'materialize', 'stage', 'materialize-conf', 'upload'])
    const bundle = harness.uploaded[0]
    expect(harness.staged).toHaveLength(1)
    expect(harness.staged[0]).toMatchObject({ context: CONTEXT, serverName: 'broker', programMd5: debugMapMd5(bundle) })
    const conf = mqttConf(bundle)
    expect(conf.auth).toEqual({
      method: 'username_password',
      credential_ref: { id: CREDENTIAL_ID, revision: 4, staging_id: STAGING_ID },
    })
    expect(conf.program.md5).toBe(debugMapMd5(bundle))
    expect(harness.materialized[1]).toEqual({ 'conf/mqtt.json': bundle['conf/mqtt.json'] })
    expect('conf/mqtt.json' in harness.materialized[0]).toBe(false)
    expect(harness.discarded).toEqual([])
    expect(events.some((e) => e.message === 'Generated conf/mqtt.json for "broker": 1 leaves, mode generic')).toBe(true)
  })

  it('reuses the runtime active credential without a staging', async () => {
    const { result, harness } = await run(integration({ authMethod: 'client_certificate' }), {
      stage: () => Promise.resolve(staged(null)),
    })
    expect(result.success).toBe(true)
    expect(mqttConf(harness.uploaded[0]).auth).toEqual({
      method: 'client_certificate',
      credential_ref: { id: CREDENTIAL_ID, revision: 4, staging_id: null },
    })
  })

  it('stops before the upload when the credential cannot be staged, naming the reason', async () => {
    const { result, harness, events } = await run(integration(), {
      stage: () =>
        Promise.resolve({ ok: false, code: 'runtime_trust_missing', message: 'The runtime identity is not verified.' }),
    })
    expect(result.success).toBe(false)
    expect(harness.uploaded).toEqual([])
    expect(harness.steps).not.toContain('materialize-conf')
    expect(errors(events).join('\n')).toContain(
      'MQTT "broker": The runtime identity is not verified. [runtime_trust_missing]',
    )
  })

  it('treats a throwing platform as a failed staging', async () => {
    const { result, harness, events } = await run(integration(), {
      stage: () => Promise.reject(new Error(SECRET_MARKER)),
    })
    expect(result.success).toBe(false)
    expect(harness.uploaded).toEqual([])
    expect(events.some((e) => e.message.includes(SECRET_MARKER))).toBe(false)
  })

  it('cancels the staging when the upload fails', async () => {
    const { result, harness } = await run(integration(), { uploadOk: false })
    expect(result.success).toBe(false)
    expect(harness.steps.slice(-2)).toEqual(['upload', 'discard'])
    expect(harness.discarded).toEqual([{ context: CONTEXT, stagingId: STAGING_ID }])
  })

  it('cancels the staging when conf/mqtt.json cannot be written, and uploads nothing', async () => {
    const { result, harness } = await run(integration(), { failConfMaterialize: true })
    expect(result.success).toBe(false)
    expect(harness.uploaded).toEqual([])
    expect(harness.discarded).toEqual([{ context: CONTEXT, stagingId: STAGING_ID }])
  })

  it('does not cancel a reused active credential when the upload fails', async () => {
    const { harness } = await run(integration(), { uploadOk: false, stage: () => Promise.resolve(staged(null)) })
    expect(harness.discarded).toEqual([])
  })

  it('cancels the staging when the runtime hands back a malformed reference', async () => {
    const { result, harness, events } = await run(integration(), {
      stage: () =>
        Promise.resolve({
          ok: true,
          credentialRef: { id: 'nope', revision: 0, staging_id: STAGING_ID },
          stagingId: STAGING_ID,
        }),
    })
    expect(result.success).toBe(false)
    expect(harness.uploaded).toEqual([])
    expect(harness.discarded).toEqual([{ context: CONTEXT, stagingId: STAGING_ID }])
    expect(errors(events).join('\n')).toContain('credential_ref_invalid')
  })

  it('never stages for a runtime the version gate refuses', async () => {
    const { result, harness } = await run(integration(), { version: '4.0.9' })
    expect(result.success).toBe(false)
    expect(harness.staged).toEqual([])
  })

  it('never stages when a selection does not resolve', async () => {
    const config = integration()
    const broken = integration({
      selections: [
        ...config.selections,
        {
          source: {
            tokens: [
              { role: 'instance', name: 'instance0' },
              { role: 'program', name: 'Main' },
              { role: 'variable', name: 'Removed' },
            ],
          },
        },
      ],
    })
    const { result, harness, events } = await run(broken)
    expect(result.success).toBe(false)
    expect(harness.staged).toEqual([])
    expect(harness.steps).toEqual(['version'])
    expect(errors(events).join('\n')).toContain('project_selection_unresolved/leaf_missing')
  })

  it('refuses the upload on a platform that cannot stage credentials', async () => {
    const { result, harness, events } = await run(integration(), { stage: null })
    expect(result.success).toBe(false)
    expect(harness.uploaded).toEqual([])
    expect(errors(events).join('\n')).toContain('[config_credential_missing]')
  })

  it('compiles without staging and says why conf/mqtt.json is not written', async () => {
    const { result, harness, events } = await run(integration(), {}, { compileOnly: true })
    expect(result).toMatchObject({ success: true, uploaded: false })
    expect(harness.staged).toEqual([])
    expect(harness.materialized.some((bundle) => 'conf/mqtt.json' in bundle)).toBe(false)
    expect(events.some((e) => e.message.includes('conf/mqtt.json for "broker" was not written'))).toBe(true)
  })

  it('does not stage without a logged-in runtime', async () => {
    const { result, harness } = await run(integration(), {}, { deviceContext: undefined })
    expect(result).toMatchObject({ success: true, uploaded: false })
    expect(harness.staged).toEqual([])
  })

  it('keeps anonymous integrations on the direct path, without staging', async () => {
    const { result, harness } = await run(integration({ authMethod: 'anonymous' }))
    expect(result.success).toBe(true)
    expect(harness.staged).toEqual([])
    expect(mqttConf(harness.uploaded[0]).auth).toEqual({ method: 'anonymous' })
    expect('conf/mqtt.json' in harness.materialized[0]).toBe(true)
  })

  it('keeps each build on its own staging when a slow answer arrives after a newer build', async () => {
    let releaseFirst: (value: StageMqttCredentialResult) => void = () => undefined
    const firstStaging = '11111111-1111-4111-8111-111111111111'
    const secondStaging = '22222222-2222-4222-8222-222222222222'
    const slow = run(
      integration(),
      { stage: () => new Promise((resolve) => (releaseFirst = resolve)) },
      { deviceContext: { kind: 'editor-https', ip: '192.0.2.11', jwt: 'a' } },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const fast = await run(integration(), { stage: () => Promise.resolve(staged(secondStaging)), uploadOk: false })
    releaseFirst(staged(firstStaging))
    const first = await slow
    expect(mqttConf(fast.harness.uploaded[0]).auth).toMatchObject({ credential_ref: { staging_id: secondStaging } })
    expect(fast.harness.discarded).toEqual([{ context: CONTEXT, stagingId: secondStaging }])
    expect(mqttConf(first.harness.uploaded[0]).auth).toMatchObject({ credential_ref: { staging_id: firstStaging } })
    expect(first.harness.discarded).toEqual([])
  })
})
