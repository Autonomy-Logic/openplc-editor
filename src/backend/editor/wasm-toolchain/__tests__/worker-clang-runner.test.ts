/**
 * @jest-environment node
 */
import { join } from 'node:path'

import { afterAll, describe, expect, it } from '@jest/globals'

import { compileStrucppToWasm } from '../../../shared/wasm-toolchain/compile-strucpp-to-wasm'
import { compileToWasm } from '../../../shared/wasm-toolchain/compile-to-wasm'
import { BoundedWasmObjectCache } from '../../../shared/wasm-toolchain/wasm-object-cache'
import { resolveWasmToolchainPaths } from '../toolchain-paths'
import { WorkerClangRunner } from '../worker-clang-runner'

const repo = join(__dirname, '..', '..', '..', '..', '..')
const paths = resolveWasmToolchainPaths({ isPackaged: false, resourcesPath: '', cwd: repo })
const fixture = (name: string): string => join(__dirname, 'fixtures', name)

const runners: WorkerClangRunner[] = []
const track = (runner: WorkerClangRunner): WorkerClangRunner => {
  runners.push(runner)
  return runner
}
afterAll(async () => {
  await Promise.all(runners.map((r) => r.terminate()))
})

const WASI_STUB = new Proxy({}, { get: () => () => 0 })

describe('resolveWasmToolchainPaths', () => {
  it('uses the extra resources in a packaged app and the repository otherwise', () => {
    expect(resolveWasmToolchainPaths({ isPackaged: true, resourcesPath: '/app/Resources', cwd: '/x' })).toEqual({
      workerScript: join('/app/Resources', 'sources', 'wasm-toolchain', 'clang-worker.mjs'),
      toolchainDir: join('/app/Resources', 'yowasp-clang'),
    })
    expect(resolveWasmToolchainPaths({ isPackaged: false, resourcesPath: '/r', cwd: '/repo' })).toEqual({
      workerScript: join('/repo', 'resources', 'sources', 'wasm-toolchain', 'clang-worker.mjs'),
      toolchainDir: join('/repo', 'node_modules', '@yowasp', 'clang'),
    })
  })
})

describe('WorkerClangRunner with the real toolchain', () => {
  const runner = track(new WorkerClangRunner(paths, 2))

  it('compiles C and C++ into a module that runs', async () => {
    const cache = new BoundedWasmObjectCache(64 * 1024 * 1024)
    const request = {
      files: {
        'core.c': 'int core(void) { return 41; }',
        'main.cpp':
          '#include <string>\nextern "C" int core(void);\n' +
          'extern "C" __attribute__((export_name("answer"))) int answer() { std::string s("x"); return core() + (int)s.size(); }',
      },
      units: [
        { source: 'core.c', language: 'c' as const, flags: ['-std=c99'] },
        { source: 'main.cpp', language: 'c++' as const, flags: ['-std=gnu++17', '-fno-exceptions'] },
      ],
      linkFlags: ['-mexec-model=reactor'],
    }
    const first = await compileToWasm(request, { runner, cache })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const { instance } = await WebAssembly.instantiate(first.wasm, { wasi_snapshot_preview1: WASI_STUB })
    const answer = instance.exports.answer
    expect(typeof answer === 'function' ? answer() : undefined).toBe(42)

    const again = await compileToWasm(request, { runner, cache })
    expect(again.stats.cached).toBe(2)
  }, 120_000)

  it('compiles STruC++-shaped output against its runtime headers', async () => {
    const result = await compileStrucppToWasm(
      {
        strucppFiles: {
          'generated.hpp': '#pragma once\n#include "iec_mini.hpp"\nint program_scan();',
          'generated.cpp': '#include "generated.hpp"\nint program_scan() { return IEC_ONE; }',
        },
        runtimeHeaders: { 'iec_mini.hpp': '#pragma once\n#define IEC_ONE 1' },
        extraFiles: {
          'host.cpp':
            '#include "generated.hpp"\nextern "C" __attribute__((export_name("scan"))) int scan() { return program_scan(); }',
        },
        extraUnits: [{ source: 'host.cpp', language: 'c++' }],
        linkFlags: ['-mexec-model=reactor'],
      },
      { runner },
    )
    expect(result.ok).toBe(true)
  }, 120_000)

  it('reports a compile error with clang diagnostics', async () => {
    const result = await compileToWasm(
      { files: { 'x.c': 'int f( {' }, units: [{ source: 'x.c', language: 'c' }] },
      { runner },
    )
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.level === 'error' && d.message.includes('x.c:1:'))).toBe(true)
  }, 120_000)
})

describe('WorkerClangRunner failures', () => {
  it('rejects prepare when the toolchain cannot load, and can try again', async () => {
    const runner = track(new WorkerClangRunner({ ...paths, workerScript: fixture('failing-worker.mjs') }, 1))
    await expect(runner.prepare()).rejects.toThrow('toolchain failed to load')
    await expect(runner.prepare()).rejects.toThrow('toolchain failed to load')
  })

  it('rejects prepare when the toolchain is missing', async () => {
    const runner = track(new WorkerClangRunner({ ...paths, toolchainDir: join(__dirname, 'missing') }, 1))
    await expect(runner.prepare()).rejects.toThrow()
  })

  it('fails the jobs of a worker that stops and replaces it', async () => {
    const runner = track(new WorkerClangRunner({ ...paths, workerScript: fixture('exiting-worker.mjs') }, 1))
    await runner.prepare()
    await expect(runner.run({ argv: ['clang', '--version'], tree: {} })).rejects.toThrow(
      'The compiler worker stopped (exit code 3).',
    )
    // The replacement worker takes the next job, and stops on it the same way.
    await expect(runner.run({ argv: ['clang', '--version'], tree: {} })).rejects.toThrow('exit code 3')
  })
})
