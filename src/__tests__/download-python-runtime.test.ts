/**
 * scripts/download-python-runtime.ts run as `npm run setup:python` runs it, from a temporary repository root, against
 * a local HTTP server.
 * @jest-environment node
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals'

const repo = join(__dirname, '..', '..')
const script = join(repo, 'scripts', 'download-python-runtime.ts')
const tsNode = join(repo, 'node_modules', '.bin', 'ts-node')

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

const PYTHON_BYTES = bytesOf('the pinned python package')
const NUMPY_BYTES = bytesOf('the pinned numpy wheel')
const TAMPERED_BYTES = bytesOf('something else')

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const served = new Map<string, Uint8Array>([
  ['/python.webc', PYTHON_BYTES],
  ['/numpy.whl', NUMPY_BYTES],
  ['/tampered.webc', TAMPERED_BYTES],
])
const requests: string[] = []
let server: Server
let base = ''
const roots: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? ''
    requests.push(url)
    const body = served.get(url)
    response.writeHead(body ? 200 : 404)
    response.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address: AddressInfo | string | null = server.address()
  if (address === null || typeof address === 'string') throw new Error('The test server has no port.')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

afterEach(() => {
  requests.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Pin {
  file: string
  path: string
  sha256: string
}

function repositoryRoot(pins: Record<string, Pin>): string {
  const root = mkdtempSync(join(tmpdir(), 'download-python-runtime-'))
  roots.push(root)
  const manifest = Object.fromEntries(
    Object.entries(pins).map(([key, pin]) => [key, { file: pin.file, url: `${base}${pin.path}`, sha256: pin.sha256 }]),
  )
  writeFileSync(join(root, 'python-runtime.json'), JSON.stringify(manifest))
  return root
}

const runtimeDir = (root: string): string => join(root, 'vendor', 'python-runtime')

interface Run {
  code: number
  stdout: string
  stderr: string
}

function runScript(root: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      tsNode,
      [script],
      {
        cwd: root,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true', TS_NODE_PROJECT: join(repo, 'tsconfig.json') },
        timeout: 60000,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1
        resolve({ code, stdout, stderr })
      },
    )
  })
}

const pythonPin: Pin = { file: 'python.webc', path: '/python.webc', sha256: sha256(PYTHON_BYTES) }
const numpyPin: Pin = { file: 'numpy.whl', path: '/numpy.whl', sha256: sha256(NUMPY_BYTES) }

describe('download-python-runtime', () => {
  it('downloads every pinned file whose bytes match its sha256', async () => {
    const root = repositoryRoot({ python: pythonPin, numpy: numpyPin })

    const run = await runScript(root)

    expect(run).toMatchObject({ code: 0 })
    expect(new Uint8Array(readFileSync(join(runtimeDir(root), 'python.webc')))).toEqual(PYTHON_BYTES)
    expect(new Uint8Array(readFileSync(join(runtimeDir(root), 'numpy.whl')))).toEqual(NUMPY_BYTES)
    expect(readdirSync(runtimeDir(root)).sort()).toEqual(['numpy.whl', 'python.webc'])
  }, 60000)

  it('refuses a downloaded file whose sha256 differs from the pin and writes nothing for it', async () => {
    const root = repositoryRoot({
      python: { file: 'python.webc', path: '/tampered.webc', sha256: sha256(PYTHON_BYTES) },
      numpy: numpyPin,
    })

    const run = await runScript(root)

    expect(run.code).toBe(1)
    expect(run.stderr).toContain(
      `${base}/tampered.webc has sha256 ${sha256(TAMPERED_BYTES)}, expected ${sha256(PYTHON_BYTES)}`,
    )
    expect(requests).toEqual(['/tampered.webc'])
    expect(readdirSync(runtimeDir(root))).toEqual([])
  }, 60000)

  it('keeps a file already present with the pinned hash without downloading it again', async () => {
    const root = repositoryRoot({ python: pythonPin, numpy: numpyPin })
    mkdirSync(runtimeDir(root), { recursive: true })
    writeFileSync(join(runtimeDir(root), 'python.webc'), PYTHON_BYTES)

    const run = await runScript(root)

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('python.webc already present, skipping.')
    expect(requests).toEqual(['/numpy.whl'])
    expect(new Uint8Array(readFileSync(join(runtimeDir(root), 'python.webc')))).toEqual(PYTHON_BYTES)
  }, 60000)

  it('replaces a file already present whose hash differs from the pin', async () => {
    const root = repositoryRoot({ python: pythonPin, numpy: numpyPin })
    mkdirSync(runtimeDir(root), { recursive: true })
    writeFileSync(join(runtimeDir(root), 'python.webc'), TAMPERED_BYTES)

    const run = await runScript(root)

    expect(run.code).toBe(0)
    expect(requests).toEqual(['/python.webc', '/numpy.whl'])
    expect(new Uint8Array(readFileSync(join(runtimeDir(root), 'python.webc')))).toEqual(PYTHON_BYTES)
    expect(existsSync(join(runtimeDir(root), 'python.webc.partial'))).toBe(false)
  }, 60000)
})
