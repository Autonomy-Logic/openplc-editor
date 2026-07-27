/**
 * Import a PLCopen XML file, overwriting the currently open project in-place.
 *
 * This is a content replacement, not a project switch: the existing
 * project's `path` (and file-storage identity) is preserved, only the
 * in-memory project data is replaced with what the XML parses to.
 */

import type { ProjectPort } from '../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../store'
import type { OpenProjectResponseData } from '../store/slices/shared/types'
import { buildProjectResponseFromPlcopenParse } from '../utils/PLC/build-plcopen-project-response'
import { parsePlcopenXml } from '../utils/PLC/xml-parser'
import { toast } from '../utils/toast'

/**
 * Pick a PLCopen XML file via the platform port, parse it, and overwrite
 * the currently open project with the result. Equivalent to File →
 * "Import PLCopen XML" (routed through the confirm-overwrite modal).
 */
export async function executeImportPlcopen(projectPort: ProjectPort): Promise<{ success: boolean }> {
  const picked = await projectPort.pickPlcopenImportFile()
  if (!picked.success || !picked.content) {
    // User cancelled the picker (or the platform failed silently) — no
    // error toast, this isn't a failure the user needs to be told about.
    return { success: false }
  }

  const state = openPLCStoreBase.getState()

  try {
    const parseResult = parsePlcopenXml(picked.content)
    const { warnings } = parseResult

    const data: OpenProjectResponseData = buildProjectResponseFromPlcopenParse(parseResult, state.project.meta.path)

    state.sharedWorkspaceActions.handleOpenProjectResponse(data)

    if (warnings.length > 0) {
      for (const warning of warnings) {
        console.warn(`[PLCopen import] ${warning}`)
      }
      toast({
        title: 'Project imported',
        description: `Imported with ${warnings.length} warning(s), see console.`,
        variant: 'warn',
      })
    } else {
      toast({
        title: 'Project imported',
        description: 'The PLCopen XML file was imported successfully.',
        variant: 'default',
      })
    }

    return { success: true }
  } catch (err) {
    toast({
      title: 'Error importing PLCopen XML',
      description: err instanceof Error ? err.message : 'Failed to parse the selected file.',
      variant: 'fail',
    })
    return { success: false }
  }
}
