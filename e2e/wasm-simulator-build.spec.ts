/**
 * The OpenPLC Simulator build: the project is compiled to a WebAssembly module by the in-editor clang, with no
 * arduino-cli. The module the build writes must instantiate and run the sketch's setup and loop.
 *
 * The editor builds the simulator only from Play, which also starts it, so the build runs through openplc-cli
 * on the same compile flow. Running needs a production build; see "Electron e2e" in CLAUDE.md.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import electronPath from 'electron'

const PROJECT_NAME = 'wasm-simulator-build'
const BOARD = 'OpenPLC Simulator'

const PROGRAM = `PROGRAM main
  VAR
    big : ARRAY[0..19999] OF DINT;
    index : DINT;
    counter : DINT;
    block : cpp_fb;
  END_VAR

counter := counter + 1;
index := counter MOD 20000;
big[index] := counter;
block(in_val := counter);

END_PROGRAM
`

const cppBlock = (loopBody: string): string => `FUNCTION_BLOCK cpp_fb
  VAR_INPUT
    in_val : DINT;
  END_VAR
  VAR_OUTPUT
    out_val : DINT;
  END_VAR

void setup()
{
}

void loop()
{
    ${loopBody}
}

END_FUNCTION_BLOCK
`

function writeSimulatorProject(slug: string, loopBody: string): { project: string; userData: string; module: string } {
  const root = join(realpathSync(tmpdir()), slug)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'pous', 'function-blocks'), { recursive: true })
  mkdirSync(join(project, 'devices'), { recursive: true })
  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
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
    }),
  )
  writeFileSync(
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({ deviceBoard: BOARD, communicationPort: '', runtimeIpAddress: '', selectedPlatformOptions: {} }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(join(project, 'pous', 'programs', 'main.st'), PROGRAM)
  writeFileSync(join(project, 'pous', 'function-blocks', 'cpp_fb.cpp'), cppBlock(loopBody))

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  mkdirSync(join(userData, 'arduino', 'data'), { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROJECT_NAME,
        path: project,
        projectFilePath: join(project, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  for (const control of ['arduino-core-control.json', 'arduino-library-control.json']) {
    writeFileSync(join(runtime, control), '[]')
  }
  return { project, userData, module: join(project, 'build', BOARD, 'simulator.wasm') }
}

const MAIN = join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js')

/** Runs `openplc-cli compile` for the simulator on @p project and returns its exit code and output. */
function cliCompile(project: string, userData: string): { status: number | null; output: string } {
  const run = spawnSync(
    String(electronPath),
    [MAIN, '--cli', 'compile', project, '--target', BOARD, '--user-data', userData],
    { encoding: 'utf-8', env: { ...process.env, NODE_ENV: 'production' }, timeout: 480000 },
  )
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

/** Instantiates the simulator module with a recording host and runs setup and a few loops. */
async function runModule(bytes: Uint8Array): Promise<{ scanPeriodUs: number; uartBytes: number }> {
  let clock = 0n
  let uartBytes = 0
  const wasi = new Proxy<Record<string, () => number>>(
    {},
    {
      get: (_target, name) =>
        name === 'proc_exit'
          ? () => {
              throw new Error('proc_exit')
            }
          : () => 0,
    },
  )
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      host_clock_us: () => clock,
      host_uart_write: (_data: number, length: number) => {
        uartBytes += length
      },
    },
    wasi_snapshot_preview1: wasi,
  })
  const call = (name: string): unknown => {
    const exported = instance.exports[name]
    if (typeof exported !== 'function') throw new Error(`the module does not export ${name}`)
    return exported()
  }
  call('_initialize')
  call('sim_setup')
  const scanPeriodUs = Number(call('sim_scan_period_us'))
  for (let scan = 0; scan < 5; scan++) {
    clock += BigInt(scanPeriodUs)
    call('sim_loop')
  }
  return { scanPeriodUs, uartBytes }
}

test('a simulator build compiles to a WebAssembly module that runs, an 80 KB array and a C++ block included', () => {
  test.setTimeout(600000)
  const { project, userData, module } = writeSimulatorProject('openplc-e2e-wasm-simulator-ok', 'out_val = in_val + 1;')

  const { status, output } = cliCompile(project, userData)

  expect(output).toMatch(/Simulator module compiled: \d+ files/)
  expect(output).not.toContain('Compiling Arduino firmware')
  expect(status).toBe(0)
  expect(existsSync(module)).toBe(true)
  return runModule(new Uint8Array(readFileSync(module))).then((result) => {
    expect(result.scanPeriodUs).toBe(20000)
    expect(result.uartBytes).toBe(0)
  })
})

test('a C++ block that writes an AVR register fails the simulator build with the compiler error', () => {
  test.setTimeout(600000)
  const { project, userData, module } = writeSimulatorProject('openplc-e2e-wasm-simulator-portb', 'PORTB = 0xFF;')

  const { status, output } = cliCompile(project, userData)

  expect(output).toMatch(/error: .*PORTB/)
  expect(output).toContain('Simulator compilation failed.')
  expect(status).not.toBe(0)
  expect(existsSync(module)).toBe(false)
})
