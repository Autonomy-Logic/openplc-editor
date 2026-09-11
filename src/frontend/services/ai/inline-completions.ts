/**
 * Wiring that turns the AI port into ghost text in a Monaco editor.
 *
 * This used to live inside the web AI adapter, which meant the desktop could
 * never have inline completions no matter how good its transport got. Nothing in
 * here is web-specific: the provider talks to the platform only through the
 * port, and Monaco is Monaco on both builds. What IS platform-specific — warming
 * the model's prompt cache — is an optional port call, so a build without a warm
 * endpoint simply skips it.
 */

import type * as monaco from 'monaco-editor'

import type { AICompletionLanguage, AIPort } from '../../../middleware/shared/ports/ai-port'
import type { EdgeSessionState } from '../../../middleware/shared/ports/edge-account-port'
import { setImeComposing } from './ime-state'
import { AIInlineCompletionProvider } from './inline-completion-provider'

let didWarmCache = false

/**
 * Test seam: drop the once-per-session latches. Without it every test after the first
 * runs against an already-warmed cache, and a case named for the warm-cache branch
 * cannot reach it — which is exactly what happened to the test that claimed to.
 */
export function __resetInlineCompletionsForTests(): void {
  didWarmCache = false
}
let didWireImeListeners = false

/**
 * Attach IME composition listeners to every Monaco editor (existing and future)
 * exactly once per session, so the inline-completion provider can suppress
 * type-through/requests while a CJK composition is in progress.
 */
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

/**
 * Register AI inline completions for one POU's editor. Returns a disposable that
 * tears down both the Monaco registration and the provider's own state; the
 * caller is expected to call it when the POU or the language changes.
 *
 * `session` is the Edge account's session, where the platform has one: the provider
 * stops asking while it is expired and resumes the moment it is restored.
 */
export function registerAIInlineCompletions(
  ai: AIPort,
  params: {
    monacoInstance: typeof monaco
    pouName: string
    language: AICompletionLanguage
    session?: EdgeSessionState
  },
): { dispose: () => void } {
  // Warm the model's prompt cache once per session (fire-and-forget).
  if (!didWarmCache) {
    didWarmCache = true
    ai.warmCache?.()
  }

  // Track IME composition so type-through doesn't misfire on CJK input.
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
