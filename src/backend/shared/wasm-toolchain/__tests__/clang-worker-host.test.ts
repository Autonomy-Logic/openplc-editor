import { describe, expect, it } from '@jest/globals'

import type { WasmToolchainTree } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import {
  type ClangWorkerPort,
  isClangWorkerJob,
  isYowaspClang,
  runClangJob,
  serveClangWorker,
  type YowaspClang,
} from '../clang-worker-host'
import type { ClangWorkerReply } from '../clang-worker-pool'

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

type Behaviour = (args: string[], options: { stderr: (b: Uint8Array | null) => void }) => WasmToolchainTree | Error

/** A stand-in for the `@yowasp/clang` module. */
function fakeClang(
  behaviour: Behaviour = () => ({ 'out.o': new Uint8Array([1]) }),
): YowaspClang & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    Exit,
    runClang: (args, _files, options) => {
      calls.push(args)
      const outcome = behaviour(args, options)
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
    },
  }
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

/** An in-memory port: `replies` collects what the worker posts, `deliver` hands it a message. */
function memoryPort(): ClangWorkerPort & { replies: ClangWorkerReply[]; deliver: (message: unknown) => void } {
  const listeners: Array<(message: unknown) => void> = []
  const replies: ClangWorkerReply[] = []
  return {
    replies,
    post: (message) => replies.push(message),
    onMessage: (listener) => listeners.push(listener),
    deliver: (message) => listeners.forEach((l) => l(message)),
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('runClangJob', () => {
  it('returns the output tree and everything written to stderr', async () => {
    const clang = fakeClang((_args, options) => {
      options.stderr(encode('warn'))
      options.stderr(null)
      options.stderr(encode('ing\n'))
      return { 'a.o': new Uint8Array([7]) }
    })
    const result = await runClangJob(clang, ['clang', '-c', 'a.c'], { 'a.c': 'x' })
    expect(result).toEqual({ exitCode: 0, stderr: 'warning\n', tree: { 'a.o': new Uint8Array([7]) } })
    expect(clang.calls).toEqual([['clang', '-c', 'a.c']])
  })

  it('turns a non-zero exit into a result', async () => {
    const clang = fakeClang((_args, options) => {
      options.stderr(encode('a.c:1:1: error: x\n'))
      return new Exit(1)
    })
    expect(await runClangJob(clang, ['clang', '-c', 'a.c'], {})).toEqual({
      exitCode: 1,
      stderr: 'a.c:1:1: error: x\n',
      tree: {},
    })
  })

  it('rejects when clang fails in any other way', async () => {
    const clang = fakeClang(() => new Error('out of memory'))
    await expect(runClangJob(clang, ['clang'], {})).rejects.toThrow('out of memory')
  })
})

describe('serveClangWorker', () => {
  it('checks clang with --version, reports ready, then answers each job', async () => {
    const clang = fakeClang()
    const port = memoryPort()
    await serveClangWorker(() => Promise.resolve(clang), port)
    expect(clang.calls[0]).toEqual(['clang', '--version'])
    expect(port.replies).toEqual([{ type: 'ready' }])

    port.deliver({ id: 4, argv: ['clang', '-c', 'a.c'], tree: { 'a.c': 'int a;' } })
    port.deliver({ type: 'init' })
    port.deliver({ id: 5, argv: [1], tree: {} })
    await settle()
    expect(port.replies).toEqual([
      { type: 'ready' },
      { type: 'result', id: 4, result: { exitCode: 0, stderr: '', tree: { 'out.o': new Uint8Array([1]) } } },
    ])
  })

  it('answers a job clang could not run with an error reply', async () => {
    const clang = fakeClang((args) => (args.includes('--version') ? {} : new Error('trap')))
    const port = memoryPort()
    await serveClangWorker(() => Promise.resolve(clang), port)
    port.deliver({ id: 1, argv: ['clang', '-c', 'a.c'], tree: {} })
    await settle()
    expect(port.replies[1]).toEqual({ type: 'error', id: 1, message: 'trap' })
  })

  it('rejects a module that is not the toolchain', async () => {
    await expect(serveClangWorker(() => Promise.resolve({}), memoryPort())).rejects.toThrow(
      'The compiler bundle does not export runClang and Exit.',
    )
  })

  it('rejects when clang --version fails, without reporting ready', async () => {
    const port = memoryPort()
    await expect(serveClangWorker(() => Promise.resolve(fakeClang(() => new Exit(2))), port)).rejects.toThrow(
      'clang --version exited with code 2',
    )
    expect(port.replies).toEqual([])
  })
})

describe('message checks', () => {
  it('recognises the toolchain module', () => {
    expect(isYowaspClang(fakeClang())).toBe(true)
    expect(isYowaspClang({ runClang: () => undefined })).toBe(false)
    expect(isYowaspClang(null)).toBe(false)
  })

  it.each([
    [{ id: 1, argv: ['clang'], tree: {} }, true],
    [{ id: '1', argv: [], tree: {} }, false],
    [{ id: 1, argv: 'clang', tree: {} }, false],
    [{ id: 1, argv: [], tree: new Uint8Array(1) }, false],
    [{ id: 1, argv: [] }, false],
    [null, false],
  ])('job %j -> %s', (value, expected) => {
    expect(isClangWorkerJob(value)).toBe(expected)
  })
})
