/**
 * Calls the running app's own `CompilerPort.compileToWasm`, the port the editor's features use.
 *
 * The app exposes no test hook, so this finds the `PlatformProvider` value by walking React's fiber tree up from a
 * rendered element, then calls its `compiler.compileToWasm`. Returns plain data so it crosses `page.evaluate`.
 */
import type { Page } from '@playwright/test'

export interface PortCompileOutcome {
  ok: boolean
  wasm: number[]
  cached: number
  messages: string[]
}

export function compileThroughPort(page: Page, request: unknown): Promise<PortCompileOutcome> {
  return page.evaluate(async (req: unknown) => {
    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
    type Compile = (r: unknown) => Promise<unknown>
    const compilerOf = (value: unknown): Compile | null => {
      if (!isRecord(value) || !isRecord(value.compiler)) return null
      const compile = value.compiler.compileToWasm
      return typeof compile === 'function' ? (r: unknown) => Promise.resolve(compile.call(value.compiler, r)) : null
    }
    let compile: Compile | null = null
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const key = Object.keys(element).find((k) => k.startsWith('__reactFiber$'))
      if (!key) continue
      let fiber: unknown = Reflect.get(element, key)
      while (isRecord(fiber) && compile === null) {
        const props = fiber.memoizedProps
        if (isRecord(props)) compile = compilerOf(props.value)
        fiber = fiber.return
      }
      if (compile) break
    }
    if (!compile) throw new Error('No PlatformProvider with a compiler port found on the page.')
    const result = await compile(req)
    if (!isRecord(result) || !isRecord(result.stats) || !Array.isArray(result.diagnostics)) {
      throw new Error('compileToWasm did not return a compile result.')
    }
    const wasm = result.wasm
    return {
      ok: result.ok === true,
      wasm: wasm instanceof Uint8Array ? Array.from(wasm) : [],
      cached: typeof result.stats.cached === 'number' ? result.stats.cached : -1,
      messages: result.diagnostics.map((d: unknown) => (isRecord(d) && typeof d.message === 'string' ? d.message : '')),
    }
  }, request)
}

/** Instantiates a compiled module outside the app and returns what its `answer` export gives back. */
export async function runAnswer(wasm: number[]): Promise<unknown> {
  const { instance } = await WebAssembly.instantiate(new Uint8Array(wasm), {
    wasi_snapshot_preview1: new Proxy({}, { get: () => () => 0 }),
  })
  const answer = instance.exports.answer
  return typeof answer === 'function' ? answer() : undefined
}
