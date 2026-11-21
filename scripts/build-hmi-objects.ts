/**
 * Builds the compiled objects the editor ships (`release/hmi-objects/`): the HMI core, font tables, hosts and widget
 * library units, the default palette gallery, and the bundled libraries' OpenPLC Simulator units, compiled with the
 * pinned WebAssembly toolchain. Run before packaging (`npm run build:hmi-objects`); the packaged app reads them from
 * its resources, development builds from the folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

import { mergeStrucppRuntimeIntoSkeleton } from '../src/backend/shared/compile/steps/merge-strucpp-runtime-into-skeleton'
import { buildHmiShippedObjects } from '../src/backend/shared/hmi/lib-object/fixed-objects'
import { isHmiPreviewSource } from '../src/backend/shared/hmi/preview/build-hmi-preview'
import { threadRunner } from './clang-thread-runner'

const ROOT = join(__dirname, '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const RUNTIME = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const OUT = join(ROOT, 'release', 'hmi-objects')
/** The bundled library archives, as the library manager reads them: STruC++'s, then the pinned HMI widgets release. */
const BUNDLED_LIBRARIES = [join(ROOT, 'node_modules', 'strucpp', 'libs'), join(ROOT, 'vendor', 'hmi-widgets')]

/** Every `.stlib` of the bundled folders, parsed, each folder in file name order; throws when the widgets are missing. */
function bundledArchives(): unknown[] {
  const widgets = BUNDLED_LIBRARIES[1]
  if (!existsSync(widgets)) throw new Error(`${widgets} is missing: run npm run setup:hmi-widgets`)
  return BUNDLED_LIBRARIES.flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.stlib'))
          .sort()
          .map((f): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8')))
      : [],
  )
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

/** Files of a folder by `<prefix>/<name>`, as text; subfolders too when `recurse`. */
function readTree(dir: string, prefix: string, recurse: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (recurse) Object.assign(out, readTree(join(dir, entry.name), `${prefix}/${entry.name}`, true))
    } else out[`${prefix}/${entry.name}`] = readFileSync(join(dir, entry.name), 'utf8')
  }
  return out
}

/** The OpenPLC Simulator's firmware skeleton as the editor's compile lays it out (`loadFirmwareSkeletonInMemory`). */
function simulatorSkeleton(runtime: Record<string, string>): Record<string, string> {
  const sources = join(ROOT, 'resources', 'sources')
  return mergeStrucppRuntimeIntoSkeleton({
    firmwareSkeleton: {
      ...readTree(join(sources, 'arduino'), 'src', false),
      ...readTree(join(sources, 'Baremetal'), 'examples/Baremetal', false),
      ...readTree(join(sources, 'wasm-sim'), 'wasm-sim', true),
    },
    strucppRuntimeHeaders: Object.fromEntries(
      Object.entries(runtime).map(([name, content]) => [`strucpp_runtime/include/${name}`, content]),
    ),
    boardHalContent: readFileSync(join(sources, 'hal', 'simulator.cpp'), 'utf8'),
  })
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
    Object.fromEntries(Object.entries(hmiSources).filter(([path]) => isHmiPreviewSource(path))),
  )
  const bundled = bundledArchives()
  const runner = threadRunner(Math.max(1, Math.min(4, cpus().length - 1)))
  try {
    const files = await buildHmiShippedObjects(runner, {
      preview: {
        runtimeHeaders: runtime,
        hmiSources: previewSources,
        readFont: (file) => Promise.resolve(new Uint8Array(readFileSync(join(HMI, 'fonts', file)))),
        projectLibraries: bundled,
      },
      hmiSources,
      runtimeHeaders: Object.fromEntries(
        Object.entries(runtime).map(([name, content]) => [`strucpp_runtime/include/${name}`, content]),
      ),
      simulator: { firmwareFiles: simulatorSkeleton(runtime), libraries: bundled },
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
