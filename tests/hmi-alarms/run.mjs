/**
 * @file run.mjs
 * Headless test of the HmiAlarms PLC library: compiles it and program.st with STruC++, builds them with driver.cpp on
 * each native compiler, runs the scripted scans and checks the output against golden.txt. Needs STruC++ installed
 * (`npm run setup:strucpp`).
 *
 *   node tests/hmi-alarms/run.mjs [--cc "gcc clang"] [--update]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const STRUCPP = join(ROOT, 'node_modules', 'strucpp')
const RUNTIME_INCLUDE = join(STRUCPP, 'src', 'runtime', 'include')
const CXXFLAGS = ['-std=gnu++17', '-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all']
const GOLDEN = join(HERE, 'golden.txt')
const CXX = { gcc: 'g++', clang: 'clang++', cc: 'c++' }

function parseArgs(argv) {
  const opts = { cc: ['cc'], update: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cc') opts.cc = argv[++i].split(/\s+/).filter(Boolean)
    else if (argv[i] === '--update') opts.update = true
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  return opts
}

function must(r, what) {
  if (r.error) throw r.error
  if (r.status !== 0) {
    process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}`)
    throw new Error(`${what} failed (exit ${r.status})`)
  }
  return r.stdout
}

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...options })

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'hmi-alarms-'))
  try {
    const json = join(work, 'library.json')
    must(run('npx', ['ts-node', '-T', join(HERE, 'library-sources.ts'), json], { cwd: ROOT }), 'library sources')
    const { library, sources } = JSON.parse(readFileSync(json, 'utf8'))
    const strucpp = await import(join(STRUCPP, 'dist', 'index.js'))
    const lib = strucpp.compileStlib(sources, library)
    if (lib.errors.length > 0) throw new Error(`library: ${lib.errors.map((e) => `${e.line}: ${e.message}`).join('\n')}`)
    const archive = strucpp.loadStlibFromString(JSON.stringify(lib.archive), library.name)
    const unit = strucpp.compile(readFileSync(join(HERE, 'program.st'), 'utf8'), {
      libraries: [archive],
      headerFileName: 'alarms_program.hpp',
    })
    if (unit.errors.length > 0) throw new Error(`program: ${unit.errors.map((e) => `${e.line}: ${e.message}`).join('\n')}`)
    writeFileSync(join(work, 'alarms_program.hpp'), unit.headerCode)
    writeFileSync(join(work, 'alarms_program.cpp'), unit.cppCode)
    let reference = null
    let failed = false
    for (const cc of opts.cc) {
      const cxx = CXX[basename(cc)] ?? cc
      const out = join(work, `driver_${basename(cc)}`)
      must(
        run(cxx, [...CXXFLAGS, `-I${RUNTIME_INCLUDE}`, `-I${work}`, join(HERE, 'driver.cpp'), join(work, 'alarms_program.cpp'), '-o', out]),
        `${cxx} driver`,
      )
      const output = must(run(out, []), `${cc} run`)
      reference ??= output
      if (output !== reference) {
        console.error(`FAIL ${cc} output differs from ${opts.cc[0]}`)
        failed = true
      } else console.log(`${cc}: ${output.trim().split('\n').length} lines`)
    }
    if (opts.update) {
      writeFileSync(GOLDEN, reference)
      console.log('golden.txt updated')
    } else if (reference !== readFileSync(GOLDEN, 'utf8')) {
      console.error(`FAIL output differs from golden.txt:\n${reference}`)
      failed = true
    } else console.log('output matches golden.txt')
    if (failed) process.exit(1)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
