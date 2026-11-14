/**
 * Fetches the Python runtime the simulator bundles (the CPython package and the numpy wheel) into
 * `vendor/python-runtime/`, pinned by `python-runtime.json`. A file whose sha256 differs is refused, so a build never
 * ships anything but the pinned bytes. Files already present with the right hash are kept.
 *
 * Usage, from the repository root: npm run setup:python [-- --force]
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface PinnedFile {
  file: string
  url: string
  sha256: string
}

/** The repository root: package scripts run from it, in both repositories (one is CommonJS, the other ESM). */
const ROOT = process.cwd()
const PINS = path.join(ROOT, 'python-runtime.json')
const PYTHON_RUNTIME_DIR = path.join(ROOT, 'vendor', 'python-runtime')

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const isPinnedFile = (value: unknown): value is PinnedFile =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'file') === 'string' &&
  typeof Reflect.get(value, 'url') === 'string' &&
  /^[0-9a-f]{64}$/.test(String(Reflect.get(value, 'sha256')))

function readPins(): PinnedFile[] {
  const parsed: unknown = JSON.parse(readFileSync(PINS, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${PINS} is not an object`)
  return Object.values(parsed).map((entry) => {
    if (!isPinnedFile(entry)) throw new Error(`${PINS} has an entry without file, url and sha256`)
    return entry
  })
}

async function fetchPinned(pin: PinnedFile, force: boolean): Promise<void> {
  const target = path.join(PYTHON_RUNTIME_DIR, pin.file)
  if (!force && existsSync(target) && sha256(new Uint8Array(readFileSync(target))) === pin.sha256) {
    console.log(`  ${pin.file} already present, skipping.`)
    return
  }
  console.log(`  Downloading ${pin.file}...`)
  const response = await fetch(pin.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Failed to download ${pin.url}: ${response.status} ${response.statusText}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== pin.sha256) throw new Error(`${pin.url} has sha256 ${actual}, expected ${pin.sha256}`)
  const partial = `${target}.partial`
  writeFileSync(partial, bytes)
  renameSync(partial, target)
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  mkdirSync(PYTHON_RUNTIME_DIR, { recursive: true })
  for (const pin of readPins()) await fetchPinned(pin, force)
  console.log('[download-python-runtime] Done.')
}

main().catch((error: unknown) => {
  console.error('[download-python-runtime]', error instanceof Error ? error.message : error)
  process.exit(1)
})
