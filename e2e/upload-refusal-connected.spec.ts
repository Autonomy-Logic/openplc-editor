/**
 * A refused upload fails with the runtime's reason; a CLI upload keeps the runtime compiling.
 * Needs a production build, the preload copy (CLAUDE.md) and E2E_RUNTIME_HOST/USER/PASS.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import {
  buildFromMenu,
  connectRuntime,
  EK1818_STATION,
  launch,
  PROJECT_NAME,
  quitApp,
  runtimeApi,
  writeEthercatProject,
} from './helpers/ethercat-project'

const HOST = process.env.E2E_RUNTIME_HOST ?? ''
const USER = process.env.E2E_RUNTIME_USER ?? ''
const PASS = process.env.E2E_RUNTIME_PASS ?? ''
const REFUSAL = 'Runtime is compiling another program, please wait'

/** Attaches the console lines about the upload, so a failed run shows what the editor reported. */
async function attachUploadLog(page: Page): Promise<void> {
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '')
  const lines = text.split('\n').filter((line) => /upload|compilation|Runtime is/i.test(line))
  await test.info().attach('upload-log', { body: lines.join('\n'), contentType: 'text/plain' })
}

/** Logs in and returns a function reading the runtime's compilation status. */
async function compilationStatusReader(): Promise<() => Promise<string>> {
  const login = await runtimeApi(HOST, 'POST', '/api/login', { username: USER, password: PASS })
  const token = String(login.access_token ?? '')
  return async () => String((await runtimeApi(HOST, 'GET', '/api/compilation-status', undefined, token)).status ?? '')
}

/** Resolves once the runtime reports a compilation in progress. */
async function waitForCompiling(readStatus: () => Promise<string>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await readStatus()) === 'COMPILING') return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('the runtime never started compiling the CLI upload')
}

/** A program large enough that the runtime takes a while to compile it, widening the refusal window. */
const LONG_COMPILE_STATION = {
  bus: EK1818_STATION.bus,
  program: `PROGRAM main\n  VAR\n    acc : DINT;\n  END_VAR\n\n${Array.from(
    { length: 10000 },
    (_, i) => `acc := (acc * 3 + ${i}) MOD 1000003;`,
  ).join('\n')}\n\nEND_PROGRAM\n`,
}

/** Runs `openplc-cli upload --clean --yes` on @p project, the same flow as Build and Upload. */
function cliUpload(project: string, userData: string): { child: ChildProcess; output: string[] } {
  const root = join(__dirname, '..')
  const output: string[] = []
  const child = spawn(
    join(root, 'node_modules', '.bin', 'electron'),
    [
      join(root, 'release', 'app', 'dist', 'main', 'main.js'),
      '--cli',
      'upload',
      project,
      '--host',
      HOST,
      '--clean',
      '--yes',
      '--user-data',
      userData,
    ],
    { env: { ...process.env, OPENPLC_USER: USER, OPENPLC_PASSWORD: PASS }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  return { child, output }
}

/** Waits for @p child to end, killing it after @p timeoutMs. A child ended by a signal counts as ended. */
async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

test('a refused upload fails with the reason the runtime gave', async () => {
  test.skip(HOST === '' || USER === '' || PASS === '', 'set E2E_RUNTIME_HOST, E2E_RUNTIME_USER and E2E_RUNTIME_PASS')
  test.setTimeout(600000)
  const gui = writeEthercatProject(join(tmpdir(), 'openplc-e2e-refusal-gui'), HOST, EK1818_STATION)
  const other = writeEthercatProject(join(tmpdir(), 'openplc-e2e-refusal-cli'), HOST, LONG_COMPILE_STATION)
  const { app, page } = await launch(gui.userData)
  let cli: ReturnType<typeof cliUpload> | undefined
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await connectRuntime(page, USER, PASS)

    const readStatus = await compilationStatusReader()
    cli = cliUpload(other.project, other.userData)
    await waitForCompiling(readStatus, 120000)
    await buildFromMenu(page, 'Build and upload')

    await page.getByText('Uploading Runtime v4 bundle...').first().waitFor({ timeout: 120000 })
    const statusAtUpload = await readStatus()
    test.skip(statusAtUpload !== 'COMPILING', `the CLI build ended (${statusAtUpload}) before the editor uploaded`)

    await expect(page.getByText(`Failed to upload program to runtime: ${REFUSAL}`).first()).toBeVisible({
      timeout: 60000,
    })
    await expect(page.getByText('Program uploaded successfully to runtime.')).toHaveCount(0)
    await expect(page.getByText('Upload complete.')).toHaveCount(0)
  } finally {
    await attachUploadLog(page)
    if (cli !== undefined) {
      // The CLI ends when the runtime finishes its build, so the next spec finds the runtime idle
      await waitForExit(cli.child, 240000)
      await test.info().attach('cli-output', { body: cli.output.join(''), contentType: 'text/plain' })
    }
    await quitApp(app, page)
  }
})
