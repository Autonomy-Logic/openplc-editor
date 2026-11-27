import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { createTestStore } from '@root/frontend/store/testing'

const USER_DATA = mkdtempSync(join(tmpdir(), 'rtop410-userdata-'))

jest.mock('electron', () => ({
  app: {
    getPath: () => USER_DATA,
    getAppPath: () => process.cwd(),
    getName: () => 'openplc-editor',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
}))

import { CompilerModule } from '@root/backend/editor/compiler'

import { parseArgs } from '../args'
import { runBuild } from '../commands/build'
import { ErrorCode, ExitCode } from '../exit-codes'
import { Reporter } from '../output'

const PROJECT_JSON = JSON.stringify({
  meta: { name: 'Master', type: 'plc-project' },
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

const MAIN_ST = 'PROGRAM main\nVAR\n  a : INT;\nEND_VAR\n\na := a + 1;\n\nEND_PROGRAM\n'

const tcpDevice = (name: string, host: string, slaveId: number, reconnect: boolean, iecLocation: string) => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'tcp',
    host,
    port: 502,
    reconnect,
    slaveId,
    timeout: 1000,
    ioGroups: [
      {
        id: `${name}-g`,
        name: 'Inputs',
        functionCode: '3',
        cycleTime: 100,
        offset: '0',
        length: 1,
        errorHandling: 'keep-last-value',
        ioPoints: [{ id: `${name}-p`, name: `${name}_in`, type: 'WORD', iecLocation }],
      },
    ],
  },
})

const roots: string[] = [USER_DATA]

mkdirSync(join(USER_DATA, 'User', 'Runtime'), { recursive: true })
writeFileSync(join(USER_DATA, 'User', 'Runtime', 'arduino-core-control.json'), '[]')

/** A project on disk for `board`, with one file per remote device under devices/remote. */
function writeProject(board: string, devices: Array<ReturnType<typeof tcpDevice>>): string {
  const root = mkdtempSync(join(tmpdir(), 'rtop410-cli-'))
  roots.push(root)
  mkdirSync(join(root, 'devices', 'remote'), { recursive: true })
  mkdirSync(join(root, 'pous', 'programs'), { recursive: true })
  writeFileSync(join(root, 'project.json'), PROJECT_JSON)
  writeFileSync(
    join(root, 'devices', 'configuration.json'),
    JSON.stringify({ deviceBoard: board, communicationPort: '', runtimeIpAddress: '', selectedPlatformOptions: {} }),
  )
  writeFileSync(join(root, 'devices', 'pin-mapping.json'), '{}')
  for (const device of devices) {
    writeFileSync(join(root, 'devices', 'remote', `${device.name}.json`), JSON.stringify(device, null, 2))
  }
  writeFileSync(join(root, 'pous', 'programs', 'main.st'), MAIN_ST)
  return root
}

/** Runs `openplc-cli compile` on the project and returns its exit code, error code and progress lines. */
async function compile(projectPath: string, target: string) {
  const out: string[] = []
  const err: string[] = []
  const reporter = new Reporter({
    mode: 'json',
    streams: { out: (chunk: string) => out.push(chunk), err: (chunk: string) => err.push(chunk) },
    quiet: false,
  })
  const result = await runBuild(createTestStore(), parseArgs(['compile', projectPath, '--target', target]), reporter, {
    withUpload: false,
  })
  const parsed: unknown = JSON.parse(out.join('') || '{}')
  const error =
    typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'object'
      ? (parsed.error as { code?: string })
      : undefined
  return { exitCode: result.exitCode, errorCode: error?.code, lines: err.join('').split('\n') }
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(CompilerModule.prototype, 'checkArduinoCliAvailability').mockResolvedValue({ success: true, data: 'test' })
  jest.spyOn(CompilerModule.prototype, 'checkStrucppAvailability').mockReturnValue({ success: true, data: 'test' })
})

afterAll(() => {
  consoleSpy.mockRestore()
  jest.restoreAllMocks()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('openplc-cli compile runs the Modbus master checks of the shared pipeline', () => {
  it('refuses a Runtime v4 project whose devices disagree on Reconnect, as the GUI does', async () => {
    const project = writeProject('OpenPLC Runtime v4', [
      tcpDevice('A', '10.0.0.5', 1, true, '%IW0'),
      tcpDevice('B', '10.0.0.5', 2, false, '%IW1'),
    ])

    const outcome = await compile(project, 'OpenPLC Runtime v4')

    expect(outcome.lines).toContain('error: Remote devices "A" and "B" on 10.0.0.5:502 disagree on Reconnect.')
    expect(outcome.errorCode).toBe(ErrorCode.CompileFailed)
    expect(outcome.exitCode).toBe(ExitCode.CompileFailed)
  }, 60_000)

  it('warns once on Runtime v3 with the new Remote IO text', async () => {
    const project = writeProject('OpenPLC Runtime v3', [
      tcpDevice('A', 'plc.local', 1, true, '%IW0'),
      tcpDevice('B', 'plc.local', 2, false, '%IW1'),
    ])

    const outcome = await compile(project, 'OpenPLC Runtime v3')

    expect(outcome.lines.filter((line) => line.includes('Remote IO'))).toEqual([
      'Warning: Your project contains Remote IO configurations, but the selected target (OpenPLC Runtime v3) does not support this feature. The remote device configurations will be ignored during compilation.',
    ])
  }, 60_000)
})
