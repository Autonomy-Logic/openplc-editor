import { createTestStore } from '@root/frontend/store/testing'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const USER_DATA = mkdtempSync(join(tmpdir(), 'dope829-userdata-'))

jest.mock('electron', () => ({
  app: {
    getPath: () => USER_DATA,
    getAppPath: () => process.cwd(),
    getName: () => 'openplc-editor',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
}))

import { parseArgs } from '../args'
import { runBuild } from '../commands/build'
import { Reporter } from '../output'

const PROJECT_JSON = JSON.stringify({
  meta: { name: 'Gated', type: 'plc-project' },
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

const DEVICE_CONFIG = JSON.stringify({
  deviceBoard: '',
  communicationPort: '',
  runtimeIpAddress: '',
  selectedPlatformOptions: {},
})

const UNTERMINATED = 'PROGRAM main\nVAR\n  a : INT;\n\na := 1;\nEND_PROGRAM\n'
const TERMINATED = 'PROGRAM main\nVAR\n  a : INT;\nEND_VAR\n\na := 1;\n\nEND_PROGRAM\n'

const roots: string[] = [USER_DATA]

mkdirSync(join(USER_DATA, 'User', 'Runtime'), { recursive: true })
writeFileSync(join(USER_DATA, 'User', 'Runtime', 'arduino-core-control.json'), '[]')

function writeProject(mainSt: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dope829-cli-'))
  roots.push(root)
  mkdirSync(join(root, 'devices'), { recursive: true })
  mkdirSync(join(root, 'pous', 'programs'), { recursive: true })
  writeFileSync(join(root, 'project.json'), PROJECT_JSON)
  writeFileSync(join(root, 'devices', 'configuration.json'), DEVICE_CONFIG)
  writeFileSync(join(root, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(join(root, 'pous', 'programs', 'main.st'), mainSt)
  return root
}

interface Outcome {
  exitCode: number
  document: { ok?: boolean; error?: { code?: string; message?: string } }
}

async function build(projectPath: string): Promise<Outcome> {
  const out: string[] = []
  const reporter = new Reporter({
    mode: 'json',
    streams: {
      out: (chunk: string) => out.push(chunk),
      err: () => undefined,
    },
    quiet: true,
  })
  const result = await runBuild(
    createTestStore(),
    parseArgs(['compile', projectPath, '--target', 'No Such Board']),
    reporter,
    { withUpload: false },
  )
  const parsed: unknown = JSON.parse(out.join(''))
  return { exitCode: result.exitCode, document: parsed as Outcome['document'] }
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(() => {
  consoleSpy.mockRestore()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('the CLI build refuses a POU whose variables do not parse', () => {
  it('fails with project_invalid and exit code 4 before it looks the target up', async () => {
    const outcome = await build(writeProject(UNTERMINATED))

    expect(outcome.document.error?.code).toBe('project_invalid')
    expect(outcome.document.error?.message).toMatch(/^The variables of "main" /)
    expect(outcome.exitCode).toBe(4)
  })

  it('reaches the unknown-target failure once the block is closed, so the gate runs before the lookup', async () => {
    const outcome = await build(writeProject(TERMINATED))

    expect(outcome.document.error?.code).toBe('target_unknown')
  })
})
