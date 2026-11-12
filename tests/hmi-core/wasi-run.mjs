/* Runs a WASI module: node wasi-run.mjs <module.wasm> [args...]. Exits with the module's exit code. */
import { readFileSync } from 'node:fs'
import { WASI } from 'node:wasi'

const [file, ...args] = process.argv.slice(2)
const wasi = new WASI({ version: 'preview1', args: [file, ...args], env: {}, returnOnExit: true })
const module = await WebAssembly.compile(readFileSync(file))
const instance = await WebAssembly.instantiate(module, wasi.getImportObject())
process.exitCode = wasi.start(instance)
