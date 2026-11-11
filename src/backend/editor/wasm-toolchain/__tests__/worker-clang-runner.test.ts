/**
 * @jest-environment node
 */
import { join } from 'node:path'

import { afterAll, describe, expect, it } from '@jest/globals'

import { resolveWasmToolchainPaths } from '../toolchain-paths'
import { WorkerClangRunner } from '../worker-clang-runner'

const repo = join(__dirname, '..', '..', '..', '..', '..')
const toolchainDir = join(repo, 'node_modules', '@yowasp', 'clang')
const fixture = (name: string): string => join(__dirname, 'fixtures', name)

const runners: WorkerClangRunner[] = []
const track = (runner: WorkerClangRunner): WorkerClangRunner => {
  runners.push(runner)
  return runner
}
afterAll(async () => {
  await Promise.all(runners.map((r) => r.terminate()))
})

describe('resolveWasmToolchainPaths', () => {
  it('takes the worker from the built main process and clang from the extra resources when packaged', () => {
    expect(
      resolveWasmToolchainPaths({ isPackaged: true, resourcesPath: '/app/Resources', cwd: '/x', mainDir: '/app/main' }),
    ).toEqual({
      workerScript: join('/app/main', 'clang-worker.js'),
      toolchainDir: join('/app/Resources', 'yowasp-clang'),
    })
  })

  it('takes clang from the repository otherwise', () => {
    expect(
      resolveWasmToolchainPaths({ isPackaged: false, resourcesPath: '/r', cwd: '/repo', mainDir: '/repo/dist' }),
    ).toEqual({
      workerScript: join('/repo/dist', 'clang-worker.js'),
      toolchainDir: join('/repo', 'node_modules', '@yowasp', 'clang'),
    })
  })
})

// Real worker threads with stand-in worker scripts; the real clang runs in the end-to-end tests.
describe('WorkerClangRunner thread mechanism', () => {
  it('runs a job on a worker thread and returns its reply', async () => {
    const runner = track(new WorkerClangRunner({ workerScript: fixture('echo-worker.mjs'), toolchainDir }, 2))
    await runner.prepare()
    const result = await runner.run({ argv: ['clang', '-c', 'a.c'], tree: { 'a.c': 'int a;' } })
    expect(result).toEqual({ exitCode: 0, stderr: 'clang -c a.c', tree: { 'a.c': 'int a;' } })
  })

  it('rejects prepare when the worker cannot load, and can try again', async () => {
    const runner = track(new WorkerClangRunner({ workerScript: fixture('failing-worker.mjs'), toolchainDir }, 1))
    await expect(runner.prepare()).rejects.toThrow('toolchain failed to load')
    await expect(runner.prepare()).rejects.toThrow('toolchain failed to load')
  })

  it('rejects prepare when the toolchain is missing', async () => {
    const runner = track(
      new WorkerClangRunner({ workerScript: fixture('echo-worker.mjs'), toolchainDir: join(__dirname, 'missing') }, 1),
    )
    await expect(runner.prepare()).rejects.toThrow()
  })

  it('fails the jobs of a worker that stops and replaces it', async () => {
    const runner = track(new WorkerClangRunner({ workerScript: fixture('exiting-worker.mjs'), toolchainDir }, 1))
    await runner.prepare()
    await expect(runner.run({ argv: ['clang', '--version'], tree: {} })).rejects.toThrow(
      'The compiler worker stopped (exit code 3).',
    )
    // The replacement worker takes the next job, and stops on it the same way.
    await expect(runner.run({ argv: ['clang', '--version'], tree: {} })).rejects.toThrow('exit code 3')
  })
})
