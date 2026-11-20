/**
 * Builds the compiled HMI objects the editor ships (`release/hmi-objects/`): the HMI core, font tables, hosts and
 * widget library units, compiled with the pinned WebAssembly toolchain. Run before packaging
 * (`npm run build:hmi-objects`); the packaged app reads them from its resources, development builds from the folder.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

import { buildHmiShippedObjects } from '../src/backend/shared/hmi/lib-object/fixed-objects'
import { threadRunner } from './clang-thread-runner'

const ROOT = join(__dirname, '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const RUNTIME = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const OUT = join(ROOT, 'release', 'hmi-objects')

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
