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

/**
 * Runs one clang invocation; a non-zero exit is a result, anything else that goes wrong rejects. `argv` starts with
 * the tool name (`clang` or `clang++`), as argv[0] would.
 */
export async function runClangJob(
  clang: YowaspClang,
  argv: string[],
  tree: WasmToolchainTree,
): Promise<WasmClangJobResult> {
  let stderr = ''
  let stdout = ''
  const errors = new TextDecoder()
  const output = new TextDecoder()
  try {
    const out = await clang.runClang(argv, tree, {
      stdout: (bytes) => {
        if (bytes) stdout += output.decode(bytes, { stream: true })
      },
      stderr: (bytes) => {
        if (bytes) stderr += errors.decode(bytes, { stream: true })
      },
      decodeASCII: false,
      fetchProgress: () => undefined,
    })
    return { exitCode: 0, stderr, stdout, tree: out }
  } catch (error) {
    if (error instanceof clang.Exit) return { exitCode: error.code, stderr, stdout, tree: {} }
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

/** How long a download may go without receiving any bytes before it counts as stalled. */
export const DOWNLOAD_STALL_MS = 30_000

/** Opens a download; the platform's transport, given a signal that aborts it. */
export type OpenDownload = (url: string, signal: AbortSignal) => Promise<Response>

/**
 * Downloads `url` with no limit on total time: it fails only when no bytes arrive for `stallMs`, so a slow but
 * moving download always finishes. Empty chunks are not progress. Every wait races the stall, so a transport that
 * ignores the abort cannot hang it.
 */
export async function downloadWithStallLimit(
  url: string,
  open: OpenDownload,
  stallMs: number = DOWNLOAD_STALL_MS,
): Promise<Uint8Array> {
  const controller = new AbortController()
  const stallError = new Error(`Download of ${url} stalled: no data for ${Math.round(stallMs / 1000)} s.`)
  let timer: ReturnType<typeof setTimeout> | null = null
  let onStall: () => void = () => undefined
  const stalled = new Promise<never>((_resolve, reject) => {
    onStall = () => {
      controller.abort()
      reject(stallError)
    }
  })
  stalled.catch(() => undefined)
  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onStall, stallMs)
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  arm()
  try {
    const response = await Promise.race([open(url, controller.signal), stalled])
    if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status}).`)
    if (!response.body) return new Uint8Array(await Promise.race([response.arrayBuffer(), stalled]))
    arm()
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stalled])
      if (done) break
      if (value.byteLength === 0) continue
      chunks.push(value)
      total += value.byteLength
      arm()
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (error) {
    if (controller.signal.aborted) {
      void reader?.cancel().catch(() => undefined)
      throw stallError
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  open: OpenDownload,
  stallMs: number = DOWNLOAD_STALL_MS,
): Promise<Record<string, Uint8Array>> {
  const entries = await Promise.all(
    resources.map(
      async ({ name, url }) =>
        [name, await decodeToolchainResource(await downloadWithStallLimit(url, open, stallMs), compressed)] as const,
    ),
  )
  return Object.fromEntries(entries)
}
