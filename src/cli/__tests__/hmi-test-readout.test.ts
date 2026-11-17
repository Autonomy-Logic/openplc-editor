import { createTestStore } from '@root/frontend/store/testing'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const USER_DATA = mkdtempSync(join(tmpdir(), 'hmi-readout-userdata-'))

jest.mock('electron', () => ({
  app: {
    getPath: () => USER_DATA,
    getAppPath: () => process.cwd(),
    getName: () => 'openplc-editor',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
}))

jest.mock('@root/middleware/adapters/editor/compile-program-flow', () => ({
  compileProgramFlow: jest.fn().mockResolvedValue({ success: false, error: 'not compiled in this test' }),
}))

jest.mock('../compile/cli-transport', () => ({
  createCliCompileTransport: jest.fn().mockReturnValue({}),
}))

const compileProgram = jest.fn().mockResolvedValue(undefined)
jest.mock('@root/backend/editor/compiler', () => ({
  CompilerModule: jest.fn().mockImplementation(() => ({ compileProgram })),
}))

import { CompilerModule } from '@root/backend/editor/compiler'
import type { CompileProgramIpcArgs } from '@root/middleware/adapters/editor/compile-program-flow'

import { parseArgs } from '../args'
import { runBuild } from '../commands/build'
import { createCliCompileTransport } from '../compile/cli-transport'
import { Reporter } from '../output'

const PROJECT_JSON = JSON.stringify({
  meta: { name: 'Panel', type: 'plc-project' },
  data: {
    dataTypes: [],
    pous: [],
    configuration: {
      resource: {
        tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
        instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
        globalVariables: [],
      },
    },
    libraries: [],
    debugVariables: { global: [], pous: {} },
  },
})

const roots: string[] = [USER_DATA]
mkdirSync(join(USER_DATA, 'User', 'Runtime'), { recursive: true })
writeFileSync(join(USER_DATA, 'User', 'Runtime', 'arduino-core-control.json'), '[]')

function writeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'hmi-readout-cli-'))
  roots.push(root)
  mkdirSync(join(root, 'devices'), { recursive: true })
  mkdirSync(join(root, 'pous', 'programs'), { recursive: true })
  writeFileSync(join(root, 'project.json'), PROJECT_JSON)
  writeFileSync(
    join(root, 'devices', 'configuration.json'),
    JSON.stringify({ deviceBoard: '', communicationPort: '', runtimeIpAddress: '', selectedPlatformOptions: {} }),
  )
  writeFileSync(join(root, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(root, 'pous', 'programs', 'main.st'),
    'PROGRAM main\nVAR\n  a : INT;\nEND_VAR\na := 1;\nEND_PROGRAM\n',
  )
  return root
}

async function compile(extra: string[]): Promise<void> {
  const reporter = new Reporter({ mode: 'json', streams: { out: () => undefined, err: () => undefined }, quiet: true })
  await runBuild(
    createTestStore(),
    parseArgs(['compile', writeProject(), '--target', 'OpenPLC Simulator', ...extra]),
    reporter,
    { withUpload: false },
  )
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('openplc-cli compile --hmi-test-readout', () => {
  beforeEach(() => jest.mocked(createCliCompileTransport).mockClear())

  it('asks the compile transport for the test readout when the flag is given', async () => {
    await compile(['--hmi-test-readout'])
    expect(createCliCompileTransport).toHaveBeenCalledWith(null, { hmiTestReadout: true })
  })

  it('leaves it out without the flag', async () => {
    await compile([])
    expect(createCliCompileTransport).toHaveBeenCalledWith(null, { hmiTestReadout: false })
  })
})

describe('createCliCompileTransport', () => {
  const { createCliCompileTransport: realTransport } =
    jest.requireActual<typeof import('../compile/cli-transport')>('../compile/cli-transport')
  const args: CompileProgramIpcArgs = [
    '/p',
    'OpenPLC Simulator',
    null,
    true,
    { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
    null,
    null,
    false,
    null,
    null,
    null,
  ]

  beforeEach(() => jest.mocked(CompilerModule).mockClear())

  it('builds the compiler with the test readout it was given', () => {
    realTransport(null, { hmiTestReadout: true }).runCompileProgram(args, () => undefined)
    expect(CompilerModule).toHaveBeenCalledWith({ dependencyHintSurface: 'cli', hmiTestReadout: true })
  })

  it('builds the compiler without it by default', () => {
    realTransport(null).runCompileProgram(args, () => undefined)
    expect(CompilerModule).toHaveBeenCalledWith({ dependencyHintSurface: 'cli', hmiTestReadout: false })
  })
})
