/**
 * @file run.mjs
 * Headless frames of the StandardWidgets library: compiles the library and the test screens (screens.st) with
 * STruC++, builds them with the C core and driver.cpp on each native compiler, runs the scripted frames and checks the
 * output against golden.txt. Every compiler must print the same lines (display lists and pixels). Needs STruC++
 * installed (`npm run setup:strucpp`).
 *
 *   node tests/hmi-lib/run.mjs [--cc "gcc clang"] [--update] [--png DIR]
 *
 * --update rewrites golden.txt from the first compiler; --png writes the dumped frames as PNG files for review.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writePngs } from '../hmi-core/png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CORE = join(ROOT, 'resources', 'sources', 'hmi', 'core')
const CORE_SOURCES = ['hmi_core.c', 'hmi_theme.c', 'hmi_math.c', 'hmi_raster.c', 'hmi_text.c']
const STRUCPP = join(ROOT, 'node_modules', 'strucpp')
const RUNTIME_INCLUDE = join(STRUCPP, 'src', 'runtime', 'include')
const CFLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-ffp-contract=off']
/* STruC++ output builds with the flags product builds use; the C core keeps its warning gate. */
const CXXFLAGS = ['-std=gnu++17', '-O2', '-ffp-contract=off']
const GOLDEN = join(HERE, 'golden.txt')
const CXX = { gcc: 'g++', clang: 'clang++', cc: 'c++' }

function parseArgs(argv) {
  const opts = { cc: ['cc'], update: false, png: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--cc') opts.cc = argv[++i].split(/\s+/).filter(Boolean)
    else if (a === '--update') opts.update = true
    else if (a === '--png') opts.png = argv[++i]
    else throw new Error(`unknown argument ${a}`)
  }
  return opts
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (r.error) throw r.error
  return r
}

function must(r, what) {
  if (r.status !== 0) {
    process.stderr.write(r.stdout ?? '')
    process.stderr.write(r.stderr ?? '')
    throw new Error(`${what} failed (exit ${r.status})`)
  }
  return r.stdout
}

/* Library and screens through STruC++, the way the HMI build compiles them. */
async function generate(work) {
  const json = join(work, 'library.json')
  must(run('npx', ['ts-node', '-T', join(HERE, 'library-sources.ts'), json], { cwd: ROOT }), 'library sources')
  const { library, sources } = JSON.parse(readFileSync(json, 'utf8'))
  const strucpp = await import(join(STRUCPP, 'dist', 'index.js'))
  const lib = strucpp.compileStlib(sources, library)
  if (lib.errors.length > 0)
    throw new Error(`library: ${lib.errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join('\n')}`)
  const archive = strucpp.loadStlibFromString(JSON.stringify(lib.archive), library.name)
  const unit = strucpp.compile(readFileSync(join(HERE, 'screens.st'), 'utf8'), {
    libraries: [archive],
    headerFileName: 'hmi_unit.hpp',
  })
  if (unit.errors.length > 0) throw new Error(`screens: ${unit.errors.map((e) => `${e.line}: ${e.message}`).join('\n')}`)
  writeFileSync(join(work, 'hmi_unit.hpp'), unit.headerCode)
  writeFileSync(join(work, 'hmi_unit.cpp'), unit.cppCode)
  const fonts = join(work, 'fonts.c')
  must(
    run('npx', ['ts-node', '-T', join(ROOT, 'tests', 'hmi-core', 'font-table.ts'), fonts, 'all', 'compact'], {
      cwd: ROOT,
    }),
    'font table',
  )
  return fonts
}

function build(cc, work, fonts) {
  const name = basename(cc)
  const objects = []
  for (const src of [...CORE_SOURCES.map((s) => join(CORE, s)), fonts]) {
    const obj = join(work, `${name}_${basename(src, '.c')}.o`)
    must(run(cc, [...CFLAGS, `-I${CORE}`, '-c', src, '-o', obj]), `${cc} ${basename(src)}`)
    objects.push(obj)
  }
  const cxx = CXX[name] ?? cc
  const out = join(work, `driver_${name}`)
  const r = run(cxx, [
    ...CXXFLAGS,
    `-I${RUNTIME_INCLUDE}`,
    `-I${CORE}`,
    `-I${work}`,
    join(HERE, 'driver.cpp'),
    join(work, 'hmi_unit.cpp'),
    ...objects,
    '-lm',
    '-o',
    out,
  ])
  must(r, `${cxx} driver`)
  return { name, out }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'hmi-lib-'))
  let failed = false
  const fail = (msg) => {
    console.error(`FAIL ${msg}`)
    failed = true
  }
  try {
    const fonts = await generate(work)
    let reference = null
    for (const cc of opts.cc) {
      const target = build(cc, work, fonts)
      const dump = opts.png && reference === null ? join(work, 'dump') : null
      if (dump) mkdirSync(dump, { recursive: true })
      const r = run(target.out, dump ? [dump] : [])
      if (r.status !== 0) {
        fail(`${target.name} driver:\n${r.stderr}${r.stdout}`)
        continue
      }
      if (dump) writePngs(dump, opts.png)
      reference ??= r.stdout
      if (r.stdout !== reference) fail(`${target.name} frames differ from ${opts.cc[0]}`)
      else console.log(`${target.name}: ${r.stdout.trim().split('\n').length} lines`)
    }
    if (reference !== null) {
      if (opts.update) {
        writeFileSync(GOLDEN, reference)
        console.log('golden.txt updated')
      } else if (reference !== readFileSync(GOLDEN, 'utf8')) {
        fail(`frames differ from golden.txt:\n${reference}`)
      } else {
        console.log('frames match golden.txt')
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
