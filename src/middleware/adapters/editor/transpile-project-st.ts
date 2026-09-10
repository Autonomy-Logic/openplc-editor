/**
 * Editor implementation of the AI feature's `ProjectStTranspiler`.
 *
 * The shared graphical-context module owns the caching and the formatting; how ST
 * actually gets produced is per-platform. On the desktop it is produced right here, in
 * the renderer: the transpiler is a pure function over the project IR
 * (`backend/shared/transpilers/st-transpiler/`) with no filesystem and no subprocess
 * behind it, so sending a whole ladder program to the main process and waiting for the
 * text to come back would buy nothing but latency and a second failure mode. It is the
 * same transpiler the compile and library paths run, which is the point — what the model
 * reads has to match what the pipeline emits, or it will answer about a program that
 * never gets built.
 *
 * Without this, a graphical POU reaches the model as its React Flow graph and nothing
 * else, and the assistant silently reasons about a program it cannot actually read.
 */

import { transpileToSt } from '../../../backend/shared/transpilers/st-transpiler'
import type { PLCProjectData } from '../../shared/ports/types'
import { fromPortShape } from './transpile-from-port'

/**
 * Satisfies the shared `ProjectStTranspiler` structurally rather than by importing it:
 * an adapter may not depend on `frontend/services/`, and the signature is the whole
 * contract.
 *
 * Never throws — a failed transpile answers `null`, which callers treat as "this diagram
 * has no ST right now" rather than "this POU is empty". Errors are reported to the
 * console rather than to the user: the chat still works without graphical context, and a
 * toast about the transpiler while someone is mid-question would explain nothing they
 * asked about.
 */
export function transpileProjectStInProcess(projectData: PLCProjectData): Promise<string | null> {
  try {
    const result = transpileToSt(fromPortShape(projectData))

    if (result.programSt && result.errors.length === 0) {
      return Promise.resolve(result.programSt)
    }

    if (result.errors.length > 0) {
      console.warn('[AI Graphical] transpile-from-json error:', result.errors.join('\n'))
    }

    return Promise.resolve(null)
  } catch (error) {
    console.warn('[AI Graphical] transpile-from-json error:', error)

    return Promise.resolve(null)
  }
}
