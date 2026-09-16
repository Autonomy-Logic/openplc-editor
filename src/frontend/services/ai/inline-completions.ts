import type * as monaco from 'monaco-editor'

import type { AICompletionLanguage, AIPort } from '../../../middleware/shared/ports/ai-port'
import type { EdgeSessionState } from '../../../middleware/shared/ports/edge-account-port'
import { setImeComposing } from './ime-state'
import { AIInlineCompletionProvider } from './inline-completion-provider'

let didWarmCache = false

/** Test seam: resets the once-per-session latches. */
export function __resetInlineCompletionsForTests(): void {
  didWarmCache = false
}
let didWireImeListeners = false

/** Existing and future Monaco editors both, once per session. */
function wireImeCompositionListeners(m: typeof monaco): void {
  if (didWireImeListeners) return
  didWireImeListeners = true

  const attach = (editor: monaco.editor.ICodeEditor) => {
    editor.onDidCompositionStart(() => setImeComposing(true))
    editor.onDidCompositionEnd(() => setImeComposing(false))
  }

  m.editor.getEditors().forEach(attach)
  m.editor.onDidCreateEditor(attach)
}

/** Dispose when the POU or the language changes. */
export function registerAIInlineCompletions(
  ai: AIPort,
  params: {
    monacoInstance: typeof monaco
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

  const provider = new AIInlineCompletionProvider(params.pouName, params.language, ai, params.session)
  const disposable = params.monacoInstance.languages.registerInlineCompletionsProvider(params.language, provider)

  return {
    dispose() {
      disposable.dispose()
      provider.dispose()
    },
  }
}
