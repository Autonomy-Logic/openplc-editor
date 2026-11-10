import type { ProjectPort } from '../../middleware/shared/ports/project-port'
import type { PouType } from '../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../store'
import { parseHybridPouFromString, parseTextualPouFromString } from '../utils/PLC/pou-text-parser'
import { hasUnappliedVariablesText } from '../utils/save-project'

export type ExternalBodyReloadOutcome =
  | { kind: 'apply'; body: string }
  | { kind: 'unchanged' }
  | { kind: 'skip-unapplied-variables'; filePath: string }
  | { kind: 'parse-failed'; filePath: string; message: string }
  | { kind: 'read-failed'; filePath: string }

/**
 * What an editor should do with a POU file that changed outside the app. Reads and parses, never
 * writes to the store, so both reload paths of the body editor take the same decision.
 */
export async function resolveExternalBodyReload(
  store: OpenPLCStore,
  projectPort: ProjectPort,
  args: { pouName: string; filePath: string; language: 'st' | 'il' | 'python' | 'cpp'; pouType: PouType },
): Promise<ExternalBodyReloadOutcome> {
  const state = store.getState()
  const pou = state.project.data.pous.find((candidate) => candidate.name === args.pouName)
  if (!pou) return { kind: 'read-failed', filePath: args.filePath }

  const editor = state.editorActions.getEditorFromEditors(args.pouName) ?? undefined
  if (hasUnappliedVariablesText(pou, editor)) {
    return { kind: 'skip-unapplied-variables', filePath: args.filePath }
  }

  const result = await projectPort.readFileContent(args.filePath)
  if (!result.success || !result.content) return { kind: 'read-failed', filePath: args.filePath }

  let parsed
  try {
    parsed =
      args.language === 'st' || args.language === 'il'
        ? parseTextualPouFromString(result.content, args.language, args.pouType)
        : parseHybridPouFromString(result.content, args.language, args.pouType)
  } catch (error) {
    return {
      kind: 'parse-failed',
      filePath: args.filePath,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const body = typeof parsed.body.value === 'string' ? parsed.body.value : ''
  const current = typeof pou.body.value === 'string' ? pou.body.value : ''
  return body === current ? { kind: 'unchanged' } : { kind: 'apply', body }
}

/** The warning a reload that did not happen should show, or `null` when there is nothing to say. */
export function externalReloadWarning(
  outcome: ExternalBodyReloadOutcome,
): { title: string; description: string } | null {
  if (outcome.kind === 'skip-unapplied-variables') {
    return {
      title: 'File not reloaded',
      description:
        `${outcome.filePath} changed on disk, but the variables pane holds text that has not been applied. ` +
        'The editor kept its content.',
    }
  }
  if (outcome.kind === 'parse-failed') {
    return {
      title: 'File not reloaded',
      description: `${outcome.filePath} changed on disk and could not be parsed: ${outcome.message}. The editor kept its content.`,
    }
  }
  return null
}
