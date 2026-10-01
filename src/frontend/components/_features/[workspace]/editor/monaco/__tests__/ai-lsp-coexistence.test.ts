import { describe, expect, it } from '@jest/globals'
import type * as monacoNs from 'monaco-editor'

import {
  AI_TAB_COMMIT_ACTION_ID,
  AI_TAB_COMMIT_PRECONDITION,
  type AiTabCommitAction,
  type CoexistenceEditor,
  installAiLspCoexistenceKeybindings,
} from '../ai-lsp-coexistence'

const TAB: monacoNs.KeyCode = 2

function makeEditor() {
  const actions: AiTabCommitAction[] = []
  const triggers: Array<{ source: string | null | undefined; handlerId: string }> = []
  const contextKeys = new Map<string, monacoNs.editor.ContextKeyValue>()
  const disposeListeners: Array<() => unknown> = []
  let actionsDisposed = 0

  const editor: CoexistenceEditor = {
    createContextKey: <T extends monacoNs.editor.ContextKeyValue>(key: string, initial: T | undefined) => {
      let value = initial
      contextKeys.set(key, value)
      return {
        set: (next: T) => {
          value = next
          contextKeys.set(key, next)
        },
        reset: () => {
          value = initial
          contextKeys.set(key, initial)
        },
        get: () => value,
      }
    },
    addAction: (action) => {
      actions.push(action)
      return {
        dispose: () => {
          actionsDisposed += 1
        },
      }
    },
    trigger: (source, handlerId) => {
      triggers.push({ source, handlerId })
    },
    onDidDispose: (listener) => {
      disposeListeners.push(listener)
      return { dispose: () => undefined }
    },
  }

  return {
    editor,
    actions,
    triggers,
    contextKeys,
    fireDispose: () => disposeListeners.forEach((listener) => listener()),
    actionsDisposed: () => actionsDisposed,
  }
}

describe('installAiLspCoexistenceKeybindings', () => {
  it('binds Tab through one editor-scoped action', () => {
    const fake = makeEditor()
    installAiLspCoexistenceKeybindings(fake.editor, TAB)

    expect(fake.actions).toHaveLength(1)
    expect(fake.actions[0].id).toBe(AI_TAB_COMMIT_ACTION_ID)
    expect(fake.actions[0].keybindings).toEqual([TAB])
  })

  it('claims Tab only while AI ghost text is visible, so the LSP dropdown keeps Tab otherwise', () => {
    const fake = makeEditor()
    installAiLspCoexistenceKeybindings(fake.editor, TAB)

    expect(fake.actions[0].precondition).toBe(AI_TAB_COMMIT_PRECONDITION)
    expect(AI_TAB_COMMIT_PRECONDITION).toContain('inlineSuggestionVisible')
    expect(AI_TAB_COMMIT_PRECONDITION).not.toContain('suggestWidgetVisible')
  })

  it('commits on the editor that installed the action, not the one that installed last', () => {
    const first = makeEditor()
    const second = makeEditor()
    installAiLspCoexistenceKeybindings(first.editor, TAB)
    installAiLspCoexistenceKeybindings(second.editor, TAB)

    first.actions[0].run()

    expect(first.triggers).toEqual([{ source: 'openplc-ai-lsp', handlerId: 'editor.action.inlineSuggest.commit' }])
    expect(second.triggers).toEqual([])
  })

  it('toggles the coexistence context key', () => {
    const fake = makeEditor()
    const controller = installAiLspCoexistenceKeybindings(fake.editor, TAB)

    expect(fake.contextKeys.get('openplcAiLspCoexistence')).toBe(false)
    controller.setActive(true)
    expect(fake.contextKeys.get('openplcAiLspCoexistence')).toBe(true)
  })

  it('drops the Tab binding when its editor is disposed', () => {
    const fake = makeEditor()
    installAiLspCoexistenceKeybindings(fake.editor, TAB)

    fake.fireDispose()

    expect(fake.actionsDisposed()).toBe(1)
  })
})
