/**
 * A WebAssembly clang runner on Node worker threads, for the scripts and harnesses that compile outside the app: each
 * thread loads `@yowasp/clang` and runs one job at a time, as the editor's clang workers do.
 */
import { Worker } from 'node:worker_threads'

import type {
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
} from '../src/middleware/shared/ports/wasm-toolchain-mechanisms'

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

/** A runner on `size` threads; `end` terminates them. */
export function threadRunner(size: number): WasmClangRunner & { end(): Promise<void> } {
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
