/**
 * The Electron fuses of a packaged build and the test-only package script, read from electron-builder.json,
 * package.json and the CI workflows. The package scripts run under `sh` with recording stubs in place of
 * `ts-node`, `npm`, `npx` and `electron-builder`, so no build runs.
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'

const repo = join(__dirname, '..', '..')
const TEST_FLAG = 'OPENPLC_TEST_PACKAGE'

/** A command one package script ran, with the value of the test-only flag it saw. */
type Step = { command: string[]; flag: string | null }

/** A fuse override passed to electron-builder: a dotted `-c.` assignment or a `--config` file. */
type Override = { kind: 'dotted'; assignment: string } | { kind: 'file'; path: string }

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function scriptOf(name: string): string {
  const value = field(field(readJson(join(repo, 'package.json')), 'scripts'), name)
  return typeof value === 'string' ? value : ''
}

/**
 * Node source of the recording stub. It appends each call to `STUB_LOG`, drops a leading `npx`, and expands
 * `npm run <script>` for any script other than `build` and `build:dll`, so a script that delegates is followed.
 */
const RECORDER = `
const { appendFileSync, readFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const LEAVES = new Set(['build', 'build:dll'])
let command = process.argv.slice(2)
if (command[0] === 'npx') {
  command = command.slice(1)
  while (command.length > 0 && command[0].startsWith('-')) command = command.slice(1)
}
if (command[0] === 'npm' && command[1] === 'run' && !LEAVES.has(command[2])) {
  const scripts = JSON.parse(readFileSync(process.env.STUB_PACKAGE_JSON, 'utf8')).scripts
  const extra = command.slice(3).filter((arg, index) => !(index === 0 && arg === '--'))
  execFileSync('/bin/sh', ['-c', [scripts[command[2]], ...extra].join(' ')], { stdio: 'inherit' })
  process.exit(0)
}
const flag = process.env.${TEST_FLAG} === undefined ? null : process.env.${TEST_FLAG}
appendFileSync(process.env.STUB_LOG, JSON.stringify({ command, flag }) + '\\n')
`

let stubs = ''

function installStubs(): void {
  stubs = mkdtempSync(join(realpathSync(tmpdir()), 'fuses-stubs-'))
  const recorder = join(stubs, 'record.js')
  writeFileSync(recorder, RECORDER)
  for (const name of ['ts-node', 'npm', 'npx', 'electron-builder']) {
    const stub = join(stubs, name)
    writeFileSync(stub, `#!/bin/sh\nexec "${process.execPath}" "${recorder}" ${name} "$@"\n`)
    chmodSync(stub, 0o755)
  }
}

/** Runs one package.json script the way npm would on a POSIX shell, and returns the commands it ran. */
function stepsOf(name: string): Step[] {
  const log = join(stubs, `${name.replace(/[^a-z]/g, '-')}.log`)
  writeFileSync(log, '')
  const path = [stubs, join(repo, 'node_modules', '.bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(':')
  execFileSync('/bin/sh', ['-c', scriptOf(name)], {
    cwd: repo,
    env: { PATH: path, HOME: stubs, STUB_LOG: log, STUB_PACKAGE_JSON: join(repo, 'package.json') },
    stdio: 'pipe',
  })
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): Step => {
      const parsed: unknown = JSON.parse(line)
      const command = field(parsed, 'command')
      const flag = field(parsed, 'flag')
      return {
        command: Array.isArray(command) ? command.map(String) : [],
        flag: typeof flag === 'string' ? flag : null,
      }
    })
}

function splitBuilderArgs(args: string[]): { rest: string[]; overrides: Override[] } {
  const rest: string[] = []
  const overrides: Override[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const dotted = /^(?:-c|--config)\.(.+)$/.exec(arg)
    if (dotted) overrides.push({ kind: 'dotted', assignment: dotted[1] })
    else if (arg === '-c' || arg === '--config') {
      overrides.push({ kind: 'file', path: args[index + 1] ?? '' })
      index += 1
    } else if (arg.startsWith('--config=')) overrides.push({ kind: 'file', path: arg.slice('--config='.length) })
    else rest.push(arg)
  }
  return { rest, overrides }
}

function isBuilder(step: Step): boolean {
  return step.command[0] === 'electron-builder'
}

/** The fuse override of a step, as the dotted assignments and the parsed contents of the config files it names. */
function overrideSummary(step: Step | undefined): { dotted: string[]; files: unknown[] } | undefined {
  if (step === undefined) return undefined
  const { overrides } = splitBuilderArgs(step.command.slice(1))
  return {
    dotted: overrides.flatMap((entry) => (entry.kind === 'dotted' ? [entry.assignment] : [])),
    files: overrides.flatMap((entry) => (entry.kind === 'file' ? [readJson(join(repo, entry.path))] : [])),
  }
}

describe('Electron fuses of a packaged build', () => {
  it('sets exactly the five hardening fuses and the ad hoc re-signing in electron-builder.json, and no other key', () => {
    const builder = readJson(join(repo, 'electron-builder.json'))

    expect(field(builder, 'electronFuses')).toStrictEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      resetAdHocDarwinSignature: true,
    })
  })

  it('keeps the package script unchanged', () => {
    expect(scriptOf('package')).toBe(
      'ts-node scripts/clean.js dist && npm run build && electron-builder build --publish never && npm run build:dll',
    )
  })

  it('names the test-only flag or a fuse override in no CI workflow', () => {
    const workflows = join(repo, '.github', 'workflows')
    const offenders = readdirSync(workflows)
      .filter((name) => statSync(join(workflows, name)).isFile())
      .flatMap((name) => {
        const text = readFileSync(join(workflows, name), 'utf8')
        return ['package:test', TEST_FLAG, 'electronFuses']
          .filter((token) => text.includes(token))
          .map((token) => `${name}: ${token}`)
      })

    expect(offenders).toEqual([])
  })
})

const posix = process.platform === 'win32' ? describe.skip : describe

posix('the test-only package script', () => {
  let packageSteps: Step[] = []
  let testSteps: Step[] = []

  beforeAll(() => {
    installStubs()
    packageSteps = stepsOf('package')
    testSteps = stepsOf('package:test')
  })

  afterAll(() => {
    rmSync(stubs, { recursive: true, force: true })
  })

  it('sets OPENPLC_TEST_PACKAGE=1 for every step of the run', () => {
    expect(testSteps.map((step) => step.flag)).toEqual(packageSteps.map(() => '1'))
  })

  it('runs the steps of the package script in the same order, with the same electron-builder arguments', () => {
    const withoutOverride = (step: Step): string[] =>
      isBuilder(step) ? [step.command[0], ...splitBuilderArgs(step.command.slice(1)).rest] : step.command

    expect(testSteps.map(withoutOverride)).toEqual(packageSteps.map((step) => step.command))
  })

  it('turns on only the inspect fuse for electron-builder, by a dotted -c. override or an extending config file', () => {
    const builderSteps = testSteps.filter(isBuilder)

    expect(builderSteps).toHaveLength(1)
    expect([
      { dotted: ['electronFuses.enableNodeCliInspectArguments=true'], files: [] },
      {
        dotted: [],
        files: [{ extends: './electron-builder.json', electronFuses: { enableNodeCliInspectArguments: true } }],
      },
    ]).toContainEqual(overrideSummary(builderSteps[0]))
  })
})
