import type { HmiBuildSources } from '../../../middleware/shared/ports/hmi-preview-types'
import type { PLCProjectData } from '../../../middleware/shared/ports/types'
import { hmiLibraryBlocksOfArchives, hmiPlcVariables } from '../../../middleware/shared/utils/hmi/plc-variables'
import { hmiPlcDeclarations } from './hmi-plc-declarations'

/**
 * The project's HMI as a device build compiles it, or null when the project has no screens. `project` is the
 * compile-ready project data: located variables already carry their resolved addresses, so no alias index is needed.
 * `libraryArchives` are the PLC's loaded `.stlib` archives, so screens may use library block pins.
 */
export function hmiBuildSources(
  project: PLCProjectData,
  libraryArchives: readonly unknown[] = [],
): HmiBuildSources | null {
  const hmi = project.hmi
  if (!hmi || hmi.screens.length === 0) return null
  return {
    screens: hmi.screens,
    widgets: hmi.widgets,
    settings: hmi.settings,
    plcVariables: hmiPlcVariables(project, hmiLibraryBlocksOfArchives(libraryArchives)),
    plcDeclarations: hmiPlcDeclarations(project),
    projectNames: [...project.pous.map((p) => p.name), ...project.dataTypes.map((d) => d.name)],
  }
}
