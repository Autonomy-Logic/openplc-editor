/**
 * `openplc-cli simulate`: builds the Python blocks fixture for the OpenPLC Simulator, runs it with its Python blocks
 * and prints their Console until Ctrl+C. The toolchain and the Python runtime load on first need; one that cannot
 * load ends the command with its reason and a non-zero exit.
 *
 * Every wait also watches the process: it fails at once, quoting the output, when the CLI exits or reports an error.
 * Running needs a production build; see "Electron e2e" in CLAUDE.md.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import electronPath from 'electron'

const REPO = join(__dirname, '..')
const MAIN = join(REPO, 'release', 'app', 'dist', 'main', 'main.js')
const FIXTURE = join(__dirname, 'fixtures', 'python-blocks')
const CLI_FAILURE = /^error \[|"ok":false|Simulator compilation failed/m

function writeProject(slug: string): { root: string; project: string; userData: string } {
  const root = join(realpathSync(tmpdir()), slug)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  cpSync(FIXTURE, project, { recursive: true })
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(join(userData, 'User', 'History'), { recursive: true })
  mkdirSync(runtime, { recursive: true })
  mkdirSync(join(userData, 'arduino', 'data'), { recursive: true })
  writeFileSync(join(userData, 'User', 'History', 'projects.json'), '[]')
  writeFileSync(join(userData, 'User', 'History', 'libraries.json'), '[]')
  for (const control of ['arduino-core-control.json', 'arduino-library-control.json']) {
    writeFileSync(join(runtime, control), '[]')
  }
  return { root, project, userData }
}

/** A working directory that mirrors the repository through symlinks, leaving out `omit` (paths relative to it). */
function mirrorRepo(root: string, omit: string[]): string {
  const cwd = join(root, 'cwd')
  const link = (from: string, to: string): void => {
    for (const entry of readdirSync(from)) {
      const relative = join(to.slice(cwd.length), entry).replace(/^\//, '')
      if (omit.includes(relative)) continue
      if (omit.some((path) => path.startsWith(`${relative}/`))) {
        mkdirSync(join(to, entry), { recursive: true })
        link(join(from, entry), join(to, entry))
      } else {
        symlinkSync(join(from, entry), join(to, entry))
      }
    }
  }
  mkdirSync(cwd, { recursive: true })
  link(REPO, cwd)
  return cwd
}

class CliRun {
  stdout = ''
  stderr = ''
  exit: number | null | undefined = undefined
  private readonly child: ChildProcess

  constructor(project: string, userData: string, cwd = REPO) {
    this.child = spawn(String(electronPath), [MAIN, '--cli', 'simulate', project, '--user-data', userData], {
      cwd,
      env: { ...process.env, NODE_ENV: 'production' },
    })
    this.child.stdout?.on('data', (chunk: Buffer) => (this.stdout += chunk.toString()))
    this.child.stderr?.on('data', (chunk: Buffer) => (this.stderr += chunk.toString()))
    this.child.on('exit', (code) => (this.exit = code))
  }

  get output(): string {
    return `${this.stdout}${this.stderr}`
  }

  /** Waits for `pattern` on the output; fails at once if the CLI exits or reports a failure first. */
  async waitFor(pattern: RegExp, timeout = 60000): Promise<RegExpMatchArray> {
    const deadline = Date.now() + timeout
    for (;;) {
      const match = this.output.match(pattern)
      if (match) return match
      if (CLI_FAILURE.test(this.output) || this.exit !== undefined || Date.now() > deadline) {
        const why = this.exit !== undefined ? `the CLI exited with ${this.exit}` : 'the CLI reported a failure'
        throw new Error(`${Date.now() > deadline ? 'timed out' : why} before ${pattern}:\n${this.output.slice(-3000)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /** Waits for the process to end, killing it after `timeout`. */
  async ended(timeout = 60000): Promise<number | null> {
    const deadline = Date.now() + timeout
    while (this.exit === undefined) {
      if (Date.now() > deadline) {
        this.child.kill('SIGKILL')
        throw new Error(`the CLI did not exit within ${timeout} ms:\n${this.output.slice(-3000)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return this.exit
  }

  interrupt(): void {
    this.child.kill('SIGINT')
  }

  kill(): void {
    if (this.exit === undefined) this.child.kill('SIGKILL')
  }
}

const resultOf = (run: CliRun): unknown => JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '')

test('simulate runs the Python blocks with the PLC, prints their Console and stops on Ctrl+C', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeProject('openplc-e2e-cli-simulate')
  const run = new CliRun(project, userData)
  try {
    await run.waitFor(/Simulator module compiled: \d+ files/, 120000)
    await run.waitFor(/\[PyStats\] PyStats started, numpy 2\.3\.2/)
    await run.waitFor(/\[PyFail\] RuntimeError: planned failure after 30 loops/)
    await run.waitFor(/\[PySocket\] socket\.gaierror/)
    const before = Number((await run.waitFor(/\[PyStats\] count=(\d+) beats=(\d+)/))[1])
    const later = await run.waitFor(new RegExp(`\\[PyStats\\] count=${before + 20} beats=(\\d+)`))
    expect(Number(later[1])).toBeGreaterThan(0)
    await run.waitFor(/Press Ctrl\+C to stop/)

    const interrupted = Date.now()
    run.interrupt()
    expect(await run.ended(15000)).toBe(0)
    expect(Date.now() - interrupted).toBeLessThan(15000)
    expect(resultOf(run)).toEqual(
      expect.objectContaining({ ok: true, target: 'OpenPLC Simulator', project: 'python-blocks', pythonBlocks: 4 }),
    )
  } finally {
    run.kill()
  }
})

test('simulate ends with the reason and a non-zero exit when the Python runtime cannot load', async () => {
  test.setTimeout(180000)
  const { root, project, userData } = writeProject('openplc-e2e-cli-simulate-no-python')
  const run = new CliRun(project, userData, mirrorRepo(root, ['vendor/python-runtime']))
  try {
    expect(await run.ended(150000)).toBe(7)
    expect(run.stdout).toContain('"code":"simulator_failed"')
    expect(run.stdout).toContain('The Python runtime could not be loaded:')
    expect(run.output).not.toContain('[PyStats]')
  } finally {
    run.kill()
  }
})

test('simulate ends with the reason and a non-zero exit when the toolchain cannot load', async () => {
  test.setTimeout(180000)
  const { root, project, userData } = writeProject('openplc-e2e-cli-simulate-no-toolchain')
  const run = new CliRun(project, userData, mirrorRepo(root, ['node_modules/@yowasp']))
  try {
    expect(await run.ended(150000)).toBe(4)
    expect(run.stdout).toContain('"code":"compile_failed"')
    expect(run.output).toMatch(/toolchain|clang/i)
  } finally {
    run.kill()
  }
})

test('Ctrl+C during the build exits as interrupted, without running the project', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeProject('openplc-e2e-cli-simulate-early-interrupt')
  const run = new CliRun(project, userData)
  try {
    await run.waitFor(/Building "python-blocks" for OpenPLC Simulator/, 120000)
    run.interrupt()
    expect(await run.ended(60000)).toBe(130)
    expect(run.stdout).toContain('"code":"interrupted"')
    expect(run.output).not.toContain('[PyStats]')
  } finally {
    run.kill()
  }
})
