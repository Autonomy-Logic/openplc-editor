/**
 * Shared mapping from a `parsePlcopenXml` result to the `{ meta, projectData,
 * warnings }` shape both PLCopen-import call sites need:
 *   - `import-actions.ts`'s `executeImportPlcopen` (interactive File → Import)
 *   - `project-adapter.ts`'s `openProjectByPath` (pending-import auto-convert)
 *
 * Pure and framework-agnostic so it can be reached from both the frontend
 * service and the middleware adapter without either importing the other.
 */

import type { ProjectMeta } from '../../../middleware/shared/ports/types'
import type { PlcopenParseResult } from './xml-parser'

export interface PlcopenProjectResponseData {
  meta: ProjectMeta
  projectData: PlcopenParseResult['projectData']
  warnings: string[]
}

/**
 * Build the `{ meta, projectData, warnings }` triple from a PLCopen parse
 * result. Name precedence: the XML's own `<contentHeader name>` (when
 * non-empty), then `fallbackName`, then the generic `'Imported Project'`
 * default — same precedence the interactive import flow already used.
 */
export function buildProjectResponseFromPlcopenParse(
  parseResult: PlcopenParseResult,
  path: string,
  fallbackName?: string,
): PlcopenProjectResponseData {
  return {
    meta: {
      name: parseResult.projectName || fallbackName || 'Imported Project',
      type: 'plc-project',
      path,
    },
    projectData: parseResult.projectData,
    warnings: parseResult.warnings,
  }
}
