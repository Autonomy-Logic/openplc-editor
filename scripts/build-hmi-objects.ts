/**
 * Builds the compiled HMI objects the editor ships (`release/hmi-objects/`): the HMI core, font tables, hosts,
 * precompiled header and widget library units, compiled with the pinned WebAssembly toolchain. Run before packaging
 * (`npm run build:hmi-objects`); the packaged app reads them from its resources, development builds from the folder.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { buildHmiShippedObjects } from '../src/backend/shared/hmi/lib-object/fixed-objects'
import type {
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
} from '../src/middleware/shared/ports/wasm-toolchain-mechanisms'

const ROOT = join(__dirname, '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const RUNTIME = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const OUT = join(ROOT, 'release', 'hmi-objects')

/** Runs clang jobs; the same calls the editor's clang worker makes. */
const WORKER = `
const { parentPort } = require('node:worker_threads')
const loaded = import('@yowasp/clang')
parentPort.on('message', async ({ id, argv, tree }) => {
  const clang = await loaded
  let stderr = ''
  const decoder = new TextDecoder()
  try {
    const out = await clang.runClang(argv, tree, {
      stdout: () => undefined,
      stderr: (bytes) => { if (bytes) stderr += decoder.decode(bytes, { stream: true }) },
      decodeASCII: false,
    })
    parentPort.postMessage({ id, exitCode: 0, stderr, stdout: '', tree: out })
  } catch (error) {
    const exitCode = error instanceof clang.Exit ? error.code : -1
    parentPort.postMessage({ id, exitCode, stderr: stderr || String(error), stdout: '', tree: {} })
  }
})
`

function threadRunner(size: number): WasmClangRunner & { end(): Promise<void> } {
  const workers = Array.from({ length: size }, () => new Worker(WORKER, { eval: true }))
  const idle = [...workers]
  const waiting: Array<() => void> = []
  const pending = new Map<number, (result: WasmClangJobResult) => void>()
  let next = 0
  for (const worker of workers)
    worker.on('message', (message: WasmClangJobResult & { id: number }) => {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    })
  const take = async (): Promise<Worker> => {
    for (;;) {
      const worker = idle.pop()
      if (worker) return worker
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
  }
  return {
    concurrency: size,
    prepare: () => Promise.resolve(),
    release: () => Promise.resolve(),
    async run(job: WasmClangJob) {
      const worker = await take()
      const id = next++
      try {
        return await new Promise<WasmClangJobResult>((resolve) => {
          pending.set(id, resolve)
          worker.postMessage({ id, ...job })
        })
      } finally {
        idle.push(worker)
        waiting.shift()?.()
      }
    },
    end: async () => {
      await Promise.all(workers.map((worker) => worker.terminate()))
    },
  }
}

/** Every file under a folder by its relative path: C and C++ sources as text, the rest as bytes. */
function readAll(dir: string, prefix = ''): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, readAll(path, `${prefix}${entry.name}/`))
    else
      out[`${prefix}${entry.name}`] = /\.(c|h|cpp|hpp)$/.test(entry.name)
        ? readFileSync(path, 'utf8')
        : new Uint8Array(readFileSync(path))
  }
  return out
}

const text = (files: Record<string, string | Uint8Array>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(files).flatMap(([path, content]) => (typeof content === 'string' ? [[path, content]] : [])),
  )

async function main(): Promise<void> {
  const started = performance.now()
  const hmiSources = readAll(HMI)
  const runtime = text(readAll(RUNTIME))
  const previewSources = text(
    Object.fromEntries(
      Object.entries(hmiSources).filter(([path]) => /^(core|unit|preview)\//.test(path) && /\.(c|h|cpp)$/.test(path)),
    ),
  )
  const runner = threadRunner(Math.max(1, Math.min(4, cpus().length - 1)))
  try {
    const files = await buildHmiShippedObjects(runner, {
      preview: {
        runtimeHeaders: runtime,
        hmiSources: previewSources,
        readFont: (file) => Promise.resolve(new Uint8Array(readFileSync(join(HMI, 'fonts', file)))),
      },
      hmiSources,
      runtimeHeaders: Object.fromEntries(
        Object.entries(runtime).map(([name, content]) => [`strucpp_runtime/include/${name}`, content]),
      ),
    })
    rmSync(OUT, { recursive: true, force: true })
    mkdirSync(OUT, { recursive: true })
    let bytes = 0
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(OUT, name), content)
      bytes += content.length
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    console.log(
      `[build-hmi-objects] ${Object.keys(files).length - 1} objects, ${(bytes / 1048576).toFixed(1)} MB in ${seconds} s`,
    )
  } finally {
    await runner.end()
  }
}

main().catch((error: unknown) => {
  console.error(`[build-hmi-objects] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
