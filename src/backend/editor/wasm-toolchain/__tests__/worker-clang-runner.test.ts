/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from '@jest/globals'

import { WasmToolchainLoadError } from '@root/backend/shared/wasm-toolchain/clang-worker-pool'
import { WASM_TOOLCHAIN_PACKAGE_FILES } from '@root/backend/shared/wasm-toolchain/toolchain-files'

import { resolveWasmToolchainPaths } from '../toolchain-paths'
import { createThreadClangWorkerMechanism, WorkerClangRunner } from '../worker-clang-runner'

const repo = join(__dirname, '..', '..', '..', '..', '..')
const installedDir = join(repo, 'node_modules', '@yowasp', 'clang')
const installedBundle = readFileSync(join(installedDir, 'gen', 'bundle.js'), 'utf8')
const NOTICE =
  '// This file was changed from the @yowasp/clang package: a run given no fetchProgress gets no default progress callback.\n'
const PATCHED_LINE_ONLY = installedBundle.replace(
  'this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)',
  'this.#fetchResources(options.fetchProgress)',
)
const PATCHED_BUNDLE = NOTICE + PATCHED_LINE_ONLY
const fixture = (name: string): string => join(__dirname, 'fixtures', name)
const scratch = mkdtempSync(join(tmpdir(), 'worker-clang-runner-'))

const runners: WorkerClangRunner[] = []
const track = (runner: WorkerClangRunner): WorkerClangRunner => {
  runners.push(runner)
  return runner
}
afterAll(async () => {
  await Promise.all(runners.map((r) => r.release()))
  rmSync(scratch, { recursive: true, force: true })
})

/** Writes a toolchain package directory holding every toolchain file except `missing`, `bundle.js` holding `bundle`. */
function packageWithout(name: string, missing: string[], bundle = ''): string {
  const dir = join(scratch, name)
  for (const file of WASM_TOOLCHAIN_PACKAGE_FILES) {
    if (missing.includes(file)) continue
    const path = join(dir, file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, file === 'gen/bundle.js' ? bundle : '')
  }
  return dir
}

/** A prepared toolchain package: every file present, `bundle.js` the patched loader. */
const toolchainDir = packageWithout('prepared', [], PATCHED_BUNDLE)

describe('resolveWasmToolchainPaths', () => {
  it('takes the worker from the built main process and clang from the extra resources when packaged', () => {
    expect(
      resolveWasmToolchainPaths({ isPackaged: true, resourcesPath: '/app/Resources', cwd: '/x', mainDir: '/app/main' }),
    ).toEqual({
      workerScript: join('/app/main', 'clang-worker.js'),
      toolchainDir: join('/app/Resources', 'yowasp-clang'),
    })
  })

  it('takes clang from the prepared copy in the repository otherwise, never from node_modules', () => {
    expect(
      resolveWasmToolchainPaths({ isPackaged: false, resourcesPath: '/r', cwd: '/repo', mainDir: '/repo/dist' }),
    ).toEqual({
      workerScript: join('/repo/dist', 'clang-worker.js'),
      toolchainDir: join('/repo', 'release', 'yowasp-clang'),
    })
  })
})

describe('createThreadClangWorkerMechanism load', () => {
  it('resolves when every toolchain file is present and the loader is patched', async () => {
    const mechanism = createThreadClangWorkerMechanism({ workerScript: fixture('echo-worker.mjs'), toolchainDir })

    await expect(mechanism.load()).resolves.toBeUndefined()
  })

  it('rejects the installed package, whose loader is not patched, naming its bundle.js', async () => {
    const mechanism = createThreadClangWorkerMechanism({
      workerScript: fixture('echo-worker.mjs'),
      toolchainDir: installedDir,
    })

    await expect(mechanism.load()).rejects.toThrow(
      `The toolchain's loader is not patched: ${join(installedDir, 'gen', 'bundle.js')}`,
    )
  })

  it('rejects a complete package whose bundle.js is not the patched loader', async () => {
    const dir = packageWithout('unpatched', [], installedBundle)
    const mechanism = createThreadClangWorkerMechanism({ workerScript: fixture('echo-worker.mjs'), toolchainDir: dir })

    await expect(mechanism.load()).rejects.toThrow(
      `The toolchain's loader is not patched: ${join(dir, 'gen', 'bundle.js')}`,
    )
  })

  it('rejects a bundle.js with the patched line but no change notice as not patched', async () => {
    const dir = packageWithout('patched-line-no-notice', [], PATCHED_LINE_ONLY)
    const mechanism = createThreadClangWorkerMechanism({ workerScript: fixture('echo-worker.mjs'), toolchainDir: dir })

    await expect(mechanism.load()).rejects.toThrow(
      `The toolchain's loader is not patched: ${join(dir, 'gen', 'bundle.js')}`,
    )
  })

  it('rejects naming the missing toolchain file', async () => {
    const dir = packageWithout('no-core3', ['gen/llvm.core3.wasm'])
    const mechanism = createThreadClangWorkerMechanism({ workerScript: fixture('echo-worker.mjs'), toolchainDir: dir })

    await expect(mechanism.load()).rejects.toThrow(`Missing toolchain file: ${join(dir, 'gen/llvm.core3.wasm')}`)
  })

  it('names the first missing file in the package list order', async () => {
    const dir = packageWithout('no-resources-no-core4', ['gen/llvm-resources.tar', 'gen/llvm.core4.wasm'])
    const mechanism = createThreadClangWorkerMechanism({ workerScript: fixture('echo-worker.mjs'), toolchainDir: dir })
    const first = WASM_TOOLCHAIN_PACKAGE_FILES.find(
      (file: string) => file === 'gen/llvm-resources.tar' || file === 'gen/llvm.core4.wasm',
    )

    await expect(mechanism.load()).rejects.toThrow(`Missing toolchain file: ${join(dir, first ?? '')}`)
  })
})

describe('WorkerClangRunner thread mechanism', () => {
  it('runs a job on a worker thread and returns its reply', async () => {
    const runner = track(new WorkerClangRunner({ workerScript: fixture('echo-worker.mjs'), toolchainDir }))
    await runner.prepare()
    const result = await runner.run({ argv: ['clang', '-c', 'a.c'], tree: { 'a.c': 'int a;' } })
    expect(result).toEqual({ exitCode: 0, stderr: 'clang -c a.c', stdout: '', tree: { 'a.c': 'int a;' } })
    expect(runner.concurrency).toBe(1)
  })

  it('holds the worker thread only while it runs a job', async () => {
    const activeResources: unknown = Reflect.get(process, 'getActiveResourcesInfo')
    const workers = (): number => {
      const list: unknown = typeof activeResources === 'function' ? activeResources.call(process) : []
      return Array.isArray(list) ? list.filter((r) => r === 'Worker' || r === 'MessagePort').length : 0
    }
    expect(typeof activeResources).toBe('function')
    const before = workers()
    const runner = track(new WorkerClangRunner({ workerScript: fixture('echo-worker.mjs'), toolchainDir }))
    await runner.prepare()
    expect(workers()).toBe(before)
    await runner.run({ argv: ['clang', '--version'], tree: {} })
    expect(workers()).toBe(before)
  })

  it('ends the worker thread on release, and starts a new one for the next job', async () => {
    const runner = track(new WorkerClangRunner({ workerScript: fixture('echo-worker.mjs'), toolchainDir }))
    await runner.run({ argv: ['clang', '-c', 'a.c'], tree: {} })

    await expect(runner.release()).resolves.toBeUndefined()

    await expect(runner.run({ argv: ['clang', '-c', 'b.c'], tree: {} })).resolves.toMatchObject({
      stderr: 'clang -c b.c',
    })
  })

  it('reports a worker that cannot load as a toolchain load failure until release', async () => {
    const runner = track(new WorkerClangRunner({ workerScript: fixture('failing-worker.mjs'), toolchainDir }))
    await expect(runner.prepare()).resolves.toBeUndefined()

    const first = await runner.run({ argv: ['clang', '--version'], tree: {} }).catch((reason: unknown) => reason)
    expect(first).toBeInstanceOf(WasmToolchainLoadError)
    expect(first instanceof Error ? first.message : '').toBe(
      'The WebAssembly compiler could not be loaded: toolchain failed to load',
    )
    await expect(runner.run({ argv: ['clang', '--version'], tree: {} })).rejects.toThrow(
      'The WebAssembly compiler could not be loaded: toolchain failed to load',
    )
  })

  it('rejects prepare when the loader is not patched, so the splash or the first build reports it', async () => {
    const dir = packageWithout('runner-unpatched', [], installedBundle)
    const runner = track(new WorkerClangRunner({ workerScript: fixture('echo-worker.mjs'), toolchainDir: dir }))

    await expect(runner.prepare()).rejects.toThrow(
      `The toolchain's loader is not patched: ${join(dir, 'gen', 'bundle.js')}`,
    )
  })

  it('rejects prepare naming the missing toolchain file, without starting a worker', async () => {
    const dir = packageWithout('runner-no-bundle', ['gen/bundle.js'])
    const runner = track(new WorkerClangRunner({ workerScript: fixture('echo-worker.mjs'), toolchainDir: dir }))

    await expect(runner.prepare()).rejects.toThrow(`Missing toolchain file: ${join(dir, 'gen/bundle.js')}`)
  })

  it('fails the jobs of a worker that stops and replaces it', async () => {
    const runner = track(new WorkerClangRunner({ workerScript: fixture('exiting-worker.mjs'), toolchainDir }))
    await runner.prepare()
    await expect(runner.run({ argv: ['clang', '--version'], tree: {} })).rejects.toThrow(
      'The compiler worker stopped (exit code 3).',
    )
    await expect(runner.run({ argv: ['clang', '--version'], tree: {} })).rejects.toThrow('exit code 3')
  })
})
