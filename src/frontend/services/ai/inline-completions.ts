import type * as monaco from 'monaco-editor'

import type { AICompletionLanguage, AIPort } from '../../../middleware/shared/ports/ai-port'
import type { EdgeSessionState } from '../../../middleware/shared/ports/edge-account-port'
import type { OpenPLCStore } from '../../store'
import { setImeComposing } from './ime-state'
import { AIInlineCompletionProvider } from './inline-completion-provider'

let didWarmCache = false
let didWireImeListeners = false

/** Test seam: resets the once-per-session latches. */
export function __resetInlineCompletionsForTests(): void {
  didWarmCache = false
  didWireImeListeners = false
}

/** Existing and future Monaco editors both, once per session. */
function wireImeCompositionListeners(m: InlineCompletionsMonaco): void {
  if (didWireImeListeners) return
  didWireImeListeners = true

  const attach = (editor: monaco.editor.ICodeEditor) => {
    editor.onDidCompositionStart(() => setImeComposing(true))
    editor.onDidCompositionEnd(() => setImeComposing(false))
  }

  m.editor.getEditors().forEach(attach)
  m.editor.onDidCreateEditor(attach)
}

export type InlineCompletionsMonaco = {
  languages: Pick<typeof monaco.languages, 'registerInlineCompletionsProvider'>
  editor: Pick<typeof monaco.editor, 'getEditors' | 'onDidCreateEditor'>
}

export type InlineCompletionsModelUri = Pick<monaco.Uri, 'scheme' | 'fsPath' | 'toString'>

/** Dispose when the POU or the language changes. */
export function registerAIInlineCompletions(
  store: OpenPLCStore,
  ai: AIPort,
  params: {
    monacoInstance: InlineCompletionsMonaco
    modelUri: InlineCompletionsModelUri
    pouName: string
    language: AICompletionLanguage
    session?: EdgeSessionState
  },
): { dispose: () => void } {
  // Fire-and-forget: warms the cache once per session, no await.
  if (!didWarmCache) {
    didWarmCache = true
    ai.warmCache?.()
  }

  wireImeCompositionListeners(params.monacoInstance)

  const provider = new AIInlineCompletionProvider(
    store,
    params.pouName,
    params.language,
    ai,
    params.session,
    params.modelUri.toString(),
  )
  // Scoped to this editor's model: a language-only selector would answer for every open POU of that language.
  const selector: monaco.languages.LanguageFilter = {
    language: params.language,
    scheme: params.modelUri.scheme,
    pattern: params.modelUri.fsPath,
  }
  const disposable = params.monacoInstance.languages.registerInlineCompletionsProvider(selector, provider)

  return {
    dispose() {
      disposable.dispose()
      provider.dispose()
    },
  }
}
