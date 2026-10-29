// Runs in the renderer on purpose: the transpiler is pure, and it must be the same one the compile path runs.

import { transpileToSt } from '../../../backend/shared/transpilers/st-transpiler'
import { fromPortShape } from '../../../backend/shared/transpilers/transpile-from-port'
import type { PLCProjectData } from '../../shared/ports/types'

// Matches `ProjectStTranspiler` structurally: an adapter may not import `frontend/services`.
/** Never throws; a failed transpile answers `null`. */
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
