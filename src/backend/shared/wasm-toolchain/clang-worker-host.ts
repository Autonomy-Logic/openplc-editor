import type {
  ClangWorkerJobMessage,
  WasmClangJobResult,
  WasmToolchainTree,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import type { ClangWorkerReply } from './clang-worker-pool'

/** How a worker talks to the page or process that started it. */
export interface ClangWorkerPort {
  post(message: ClangWorkerReply): void
  onMessage(listener: (message: unknown) => void): void
}

interface RunOptions {
  stdout: (bytes: Uint8Array | null) => void
  stderr: (bytes: Uint8Array | null) => void
  decodeASCII: boolean
  fetchProgress: () => void
}

/** The part of the `@yowasp/clang` module the worker uses. */
export interface YowaspClang {
  runClang(args: string[], files: WasmToolchainTree, options: RunOptions): Promise<WasmToolchainTree>
  Exit: new (...args: never[]) => Error & { code: number }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const isYowaspClang = (value: unknown): value is YowaspClang =>
  isRecord(value) && typeof value.runClang === 'function' && typeof value.Exit === 'function'

export const isClangWorkerJob = (value: unknown): value is ClangWorkerJobMessage =>
  isRecord(value) &&
  typeof value.id === 'number' &&
  Array.isArray(value.argv) &&
  value.argv.every((arg) => typeof arg === 'string') &&
  isRecord(value.tree) &&
  !ArrayBuffer.isView(value.tree)

/** Runs one clang invocation; a non-zero exit is a result, anything else that goes wrong rejects. */
export async function runClangJob(
  clang: YowaspClang,
  argv: string[],
  tree: WasmToolchainTree,
): Promise<WasmClangJobResult> {
  let stderr = ''
  const decoder = new TextDecoder()
  const sink = (bytes: Uint8Array | null) => {
    if (bytes) stderr += decoder.decode(bytes, { stream: true })
  }
  try {
    // runClang takes the tool name (`clang` or `clang++`) as its first argument, as argv[0] would be.
    const out = await clang.runClang(argv, tree, {
      stdout: sink,
      stderr: sink,
      decodeASCII: false,
      fetchProgress: () => undefined,
    })
    return { exitCode: 0, stderr, tree: out }
  } catch (error) {
    if (error instanceof clang.Exit) return { exitCode: error.code, stderr, tree: {} }
    throw error
  }
}

/**
 * The body of a clang worker: loads the toolchain, checks it runs, reports `ready`, then answers one job per
 * message. Rejects when the toolchain cannot load, which the worker turns into its own failure.
 */
export async function serveClangWorker(loadModule: () => Promise<unknown>, port: ClangWorkerPort): Promise<void> {
  const loaded = await loadModule()
  if (!isYowaspClang(loaded)) throw new Error('The compiler bundle does not export runClang and Exit.')
  const probe = await runClangJob(loaded, ['clang', '--version'], {})
  if (probe.exitCode !== 0) throw new Error(`clang --version exited with code ${probe.exitCode}: ${probe.stderr}`)

  port.onMessage((message) => {
    if (!isClangWorkerJob(message)) return
    runClangJob(loaded, message.argv, message.tree).then(
      (result) => port.post({ type: 'result', id: message.id, result }),
      (error: unknown) =>
        port.post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) }),
    )
  })
  port.post({ type: 'ready' })
}

const isGzip = (bytes: Uint8Array): boolean => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

/**
 * A downloaded toolchain resource as clang needs it. Stored compressed, it may still be gzip, or a server that
 * labelled it `Content-Encoding: gzip` may have had it decompressed already.
 */
export async function decodeToolchainResource(bytes: Uint8Array, compressed: boolean): Promise<Uint8Array> {
  if (!compressed || !isGzip(bytes)) return bytes
  const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}

/** One toolchain resource: the name `bundle.js` asks for, and where it is stored. */
export interface ToolchainResourceLocation {
  name: string
  url: string
}

/** Downloads every toolchain resource once and decodes it, keyed by the name `bundle.js` asks for. */
export async function loadToolchainResources(
  resources: ToolchainResourceLocation[],
  compressed: boolean,
  download: (url: string) => Promise<Uint8Array>,
): Promise<Record<string, Uint8Array>> {
  const entries = await Promise.all(
    resources.map(
      async ({ name, url }) => [name, await decodeToolchainResource(await download(url), compressed)] as const,
    ),
  )
  return Object.fromEntries(entries)
}
