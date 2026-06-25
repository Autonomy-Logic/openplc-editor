import type * as monacoNs from 'monaco-editor'

/**
 * Custom Monaco context key that reflects whether AI inline completions and the
 * STruC++ LSP suggest widget are allowed to coexist (i.e. AI is enabled,
 * consented and inline completions are turned on).  All Tab overrides below are
 * gated on this key so they only take effect while coexistence is active —
 * toggling AI off restores Monaco's default Tab=accept behaviour without needing
 * to remount the editor.
 */
const COEXISTENCE_CONTEXT_KEY = 'openplcAiLspCoexistence'

export type AiLspCoexistenceController = {
  /** Enable/disable the coexistence Tab overrides at runtime. */
  setActive: (active: boolean) => void
}

/**
 * Wires Tab/Enter so the STruC++ LSP dropdown and the AI ghost text can be shown
 * at the same time:
 *
 *   - Enter (and arrow-key selection) accept the LSP suggest widget — Monaco's
 *     default, left untouched.
 *   - Tab commits the AI inline suggestion, even while the suggest widget is open
 *     (Monaco's default reserves Tab for the dropdown when both are visible).
 *   - While the suggest widget is open but no AI ghost text is present, Tab is
 *     swallowed (reserved for AI) instead of accepting the highlighted LSP item.
 *
 * The two overrides are registered once and gated on {@link COEXISTENCE_CONTEXT_KEY};
 * standalone keybindings added via `addCommand` are registered as overrides that
 * take precedence over Monaco's built-in keybindings when their `when` clause
 * matches.
 */
export function installAiLspCoexistenceKeybindings(
  editor: monacoNs.editor.IStandaloneCodeEditor,
  monaco: typeof monacoNs,
): AiLspCoexistenceController {
  const active = editor.createContextKey<boolean>(COEXISTENCE_CONTEXT_KEY, false)

  // Tab commits the AI inline suggestion even when the LSP dropdown is visible.
  editor.addCommand(
    monaco.KeyCode.Tab,
    () => {
      editor.trigger('openplc-ai-lsp', 'editor.action.inlineSuggest.commit', {})
    },
    `${COEXISTENCE_CONTEXT_KEY} && inlineSuggestionVisible && !editorReadonly`,
  )

  // While the LSP dropdown is open without any AI ghost text, Tab is reserved for
  // AI: swallow it so it never accepts the highlighted LSP item (Enter does that).
  editor.addCommand(
    monaco.KeyCode.Tab,
    () => {
      /* no-op: Tab is reserved for AI completions while coexistence is active */
    },
    `${COEXISTENCE_CONTEXT_KEY} && suggestWidgetVisible && !inlineSuggestionVisible`,
  )

  return {
    setActive: (value: boolean) => active.set(value),
  }
}
