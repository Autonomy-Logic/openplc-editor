/**
 * A refused upload fails with the runtime's reason; a CLI upload keeps the runtime compiling.
 * Needs a production build, the preload copy (CLAUDE.md) and E2E_RUNTIME_HOST/USER/PASS.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { request } from 'node:https'
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
  writeEthercatProject,
} from './helpers/ethercat-project'

const HOST = process.env.E2E_RUNTIME_HOST ?? ''
const USER = process.env.E2E_RUNTIME_USER ?? ''
const PASS = process.env.E2E_RUNTIME_PASS ?? ''
const REFUSAL = 'Runtime is compiling another program, please wait'

/** One JSON request to the runtime API; the runtime serves a self-signed certificate. */
function runtimeApi(method: string, path: string, body?: object, token?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = request(
      {
        hostname: HOST,
        port: 8443,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => (data += chunk.toString()))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as Record<string, unknown>)
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/** Attaches the console lines about the upload, so a failed run shows what the editor reported. */
async function attachUploadLog(page: Page): Promise<void> {
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '')
  const lines = text.split('\n').filter((line) => /upload|compilation|Runtime is/i.test(line))
  await test.info().attach('upload-log', { body: lines.join('\n'), contentType: 'text/plain' })
}

/** Resolves once the runtime reports a compilation in progress. */
async function waitForCompiling(timeoutMs: number): Promise<void> {
  const login = await runtimeApi('POST', '/api/login', { username: USER, password: PASS })
  const token = String(login.access_token ?? '')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await runtimeApi('GET', '/api/compilation-status', undefined, token)
    if (status.status === 'COMPILING') return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('the runtime never started compiling the CLI upload')
}

/** Runs `openplc-cli upload --clean --yes` on @p project, the same flow as Build and Upload. */
function cliUpload(project: string, userData: string): ChildProcess {
  const root = join(__dirname, '..')
  return spawn(
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
      `--user-data-dir=${userData}`,
    ],
    { env: { ...process.env, OPENPLC_USER: USER, OPENPLC_PASSWORD: PASS }, stdio: 'ignore' },
  )
}

test('a refused upload fails with the reason the runtime gave', async () => {
  test.skip(HOST === '' || USER === '' || PASS === '', 'set E2E_RUNTIME_HOST, E2E_RUNTIME_USER and E2E_RUNTIME_PASS')
  test.setTimeout(300000)
  const gui = writeEthercatProject(join(tmpdir(), 'openplc-e2e-refusal-gui'), HOST, EK1818_STATION)
  const other = writeEthercatProject(join(tmpdir(), 'openplc-e2e-refusal-cli'), HOST, EK1818_STATION)
  const { app, page } = await launch(gui.userData)
  let cli: ChildProcess | undefined
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await connectRuntime(page, USER, PASS)

    cli = cliUpload(other.project, other.userData)
    await waitForCompiling(120000)
    await buildFromMenu(page, 'Build and upload')

    await expect(page.getByText(`Failed to upload program to runtime: ${REFUSAL}`).first()).toBeVisible({
      timeout: 120000,
    })
    await expect(page.getByText('Program uploaded successfully to runtime.')).toHaveCount(0)
    await expect(page.getByText('Upload complete.')).toHaveCount(0)
  } finally {
    await attachUploadLog(page)
    const running = cli
    if (running !== undefined && running.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          running.kill('SIGKILL')
          resolve()
        }, 240000)
        running.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    await quitApp(app, page)
  }
})
