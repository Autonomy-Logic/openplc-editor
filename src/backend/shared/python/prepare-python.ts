export type PythonRuntimeReadiness = { ok: true; ms: number } | { ok: false; message: string }

/** Runs a Python runtime load or file check, booting no interpreter. A failure carries the message to report. */
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
