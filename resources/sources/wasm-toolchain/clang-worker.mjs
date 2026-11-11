// Runs the YoWASP clang toolchain in a worker thread and answers one job per message.
import { parentPort, workerData } from 'node:worker_threads'

// Some Electron builds lack compileStreaming, and the bundle's own fallback passes it a promise.
WebAssembly.compileStreaming ??= async (source) => WebAssembly.compile(await (await source).arrayBuffer())

const { runClang, Exit } = await import(workerData.bundleUrl)

async function run(argv, tree) {
  let stderr = ''
  const decoder = new TextDecoder()
  const sink = (bytes) => {
    if (bytes) stderr += decoder.decode(bytes, { stream: true })
  }
  try {
    // runClang takes the tool name (`clang` or `clang++`) as its first argument, as argv[0] would be.
    const out = await runClang(argv, tree, { stdout: sink, stderr: sink, decodeASCII: false, fetchProgress: () => {} })
    return { exitCode: 0, stderr, tree: out }
  } catch (error) {
    if (error instanceof Exit) return { exitCode: error.code, stderr, tree: {} }
    throw error
  }
}

// Loads and compiles the toolchain now, so the first real job does not pay for it.
const probe = await run(['clang', '--version'], {})
if (probe.exitCode !== 0) throw new Error(`clang --version exited with code ${probe.exitCode}: ${probe.stderr}`)

parentPort.on('message', async (message) => {
  const { id, argv, tree } = message
  try {
    parentPort.postMessage({ type: 'result', id, result: await run(argv, tree) })
  } catch (error) {
    parentPort.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
})
parentPort.postMessage({ type: 'ready' })
