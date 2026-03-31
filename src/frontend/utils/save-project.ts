/**
 * Save project orchestration utilities.
 *
 * Handles pre-save preparation (POU sanitization, debug variable collection)
 * and post-save cleanup (state reset, deleted lists, toast).
 */

import type { SaveProjectParams } from '../../middleware/shared/ports/project-port'
import type { PLCPou } from '../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// Structural types (avoids store layer import — architecture rule)
// ---------------------------------------------------------------------------

/** Minimal editor shape needed for POU sanitization. */
export interface EditorLike {
  type: string
  meta: { name: string }
  variable?: { display: string; code?: string | null }
}

// ---------------------------------------------------------------------------
// POU Sanitization
// ---------------------------------------------------------------------------

/**
 * Syncs a POU's variablesText with the current code editor state.
 *
 * When a user edits variables in "code" display mode, the text lives in the
 * editor model but hasn't been parsed back into structured variables yet.
 * Before saving we must capture that text so the IPC layer writes it to disk.
 */
export function sanitizePou(pou: PLCPou, editor: EditorLike | undefined): PLCPou {
  if (!editor || (editor.type !== 'plc-textual' && editor.type !== 'plc-graphical') || !editor.variable) {
    return pou
  }

  if (editor.variable.display === 'code' && editor.variable.code != null) {
    return {
      ...pou,
      variablesText: editor.variable.code,
    } as PLCPou & { variablesText?: string }
  }

  return pou
}

// ---------------------------------------------------------------------------
// Debug Variable Collection
// ---------------------------------------------------------------------------

/**
 * Collects debug flags from all variables (global + per-POU).
 * Returns undefined if no variables have debug enabled.
 */
export function collectDebugVariables(
  globalVariables: { name: string; debug?: boolean }[],
  pous: PLCPou[],
): { global?: string[]; pous?: Record<string, string[]> } | undefined {
  const debugVars: { global?: string[]; pous?: Record<string, string[]> } = {}

  const globalDebug = globalVariables.filter((v) => v.debug === true).map((v) => v.name)
  if (globalDebug.length > 0) {
    debugVars.global = globalDebug
  }

  const pouDebug: Record<string, string[]> = {}
  for (const pou of pous) {
    const vars = (pou.interface?.variables ?? []).filter((v) => v.debug === true).map((v) => v.name)
    if (vars.length > 0) {
      pouDebug[pou.name] = vars
    }
  }
  if (Object.keys(pouDebug).length > 0) {
    debugVars.pous = pouDebug
  }

  return debugVars.global || debugVars.pous ? debugVars : undefined
}

// ---------------------------------------------------------------------------
// Build Save Params
// ---------------------------------------------------------------------------

export interface PrepareSavePayloadArgs {
  projectPath: string
  projectName: string
  projectData: {
    dataTypes: unknown[]
    pous: PLCPou[]
    configurations: {
      resource: { tasks: unknown[]; instances: unknown[]; globalVariables: { name: string; debug?: boolean }[] }
    }
    servers?: unknown[]
    remoteDevices?: unknown[]
  }
  deviceConfiguration: SaveProjectParams['deviceConfiguration']
  devicePinMapping: SaveProjectParams['devicePinMapping']
  /** Current editor + editors list for POU sanitization. */
  editors: EditorLike[]
  activeEditor: EditorLike
}

/**
 * Prepares the save payload by sanitizing POUs and collecting debug variables.
 * Returns a SaveProjectParams ready to be passed to `projectPort.saveProject()`.
 */
export function prepareSavePayload(args: PrepareSavePayloadArgs): SaveProjectParams {
  const { projectPath, projectName, projectData, deviceConfiguration, devicePinMapping, editors, activeEditor } = args

  // Build editor lookup for POU sanitization
  const editorsByName = new Map<string, EditorLike>()
  for (const ed of editors) {
    if (ed.type === 'plc-textual' || ed.type === 'plc-graphical') {
      editorsByName.set(ed.meta.name, ed)
    }
  }
  if (activeEditor.type === 'plc-textual' || activeEditor.type === 'plc-graphical') {
    editorsByName.set(activeEditor.meta.name, activeEditor)
  }

  // Sanitize POUs (sync variablesText from code editor)
  const sanitizedPous = projectData.pous.map((pou) => sanitizePou(pou, editorsByName.get(pou.name)))

  // Collect debug variable flags
  const debugVariables = collectDebugVariables(projectData.configurations.resource.globalVariables, projectData.pous)

  // Build project data with sanitized POUs and debug variables
  const preparedProjectData = {
    ...projectData,
    pous: sanitizedPous,
    debugVariables,
  }

  return {
    projectPath,
    projectName,
    projectData: preparedProjectData as SaveProjectParams['projectData'],
    deviceConfiguration,
    devicePinMapping,
  }
}
