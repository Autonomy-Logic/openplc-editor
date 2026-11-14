export type PythonRuntimeReadiness = { ok: true; ms: number } | { ok: false; message: string }

/** Loads the Python runtime at editor start, booting no interpreter. A failure carries the startup screen's message. */
export async function preparePythonRuntime(runtime: { load(): Promise<void> }): Promise<PythonRuntimeReadiness> {
  const start = performance.now()
  try {
    await runtime.load()
    return { ok: true, ms: performance.now() - start }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `The Python runtime could not be loaded: ${reason}` }
  }
}
