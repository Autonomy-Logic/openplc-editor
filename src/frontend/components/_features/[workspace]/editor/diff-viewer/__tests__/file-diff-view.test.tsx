/** `@monaco-editor/react` 4.7 disposes the two text models before the widget that still holds them, which throws uncaught; these tests assert teardown order, not rendering. */

import { beforeEach, describe, expect, it } from '@jest/globals'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../../../../middleware/shared/ports/platform-capabilities'
import type {
  GraphicalDiffResult,
  VersionControlPort,
} from '../../../../../../../middleware/shared/ports/version-control-port'
import { PlatformProvider } from '../../../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../../../middleware/shared/providers/types'
import { FileDiffView, getLanguageFromPath } from '../file-diff-view'
import { useDiffEditorTeardown, useDiffModelPaths } from '../use-diff-editor-teardown'

const events: string[] = []
/** Every theme the diff editor applies, in order. */
const themesApplied: string[] = []

type FakeModel = {
  uri: { toString(): string }
  language: string
  getValue(): string
  setValue(value: string): void
  getFullModelRange(): Record<string, never>
  dispose(): void
}

type ModelPair = { original: FakeModel; modified: FakeModel }

/** What Monaco throws at a disposed widget. Named so the assertions can say so. */
class WidgetDisposedError extends Error {}

/** One diff editor widget: holds a model pair until it is released or disposed. */
class FakeDiffEditor {
  models: ModelPair | null = null
  disposed = false
  options: Record<string, unknown>

  constructor(options: Record<string, unknown>) {
    this.options = options
  }

  private subEditor(side: keyof ModelPair) {
    return {
      getModel: () => this.models?.[side] ?? null,
      setModel: (model: FakeModel) => {
        if (this.models) this.models = { ...this.models, [side]: model }
      },
      // Every diff here is read-only, and the library takes that branch to sync content.
      getOption: () => true,
      getValue: () => this.models?.[side].getValue() ?? '',
      setValue: (value: string) => this.models?.[side].setValue(value),
      executeEdits: () => undefined,
      pushUndoStop: () => undefined,
    }
  }

  getOriginalEditor() {
    return this.subEditor('original')
  }

  getModifiedEditor() {
    return this.subEditor('modified')
  }

  getModel() {
    return this.models
  }

  setModel(models: ModelPair | null) {
    if (this.disposed) throw new WidgetDisposedError('Illegal state: widget is disposed')
    if (models === null) events.push('setModel:null')
    this.models = models
  }

  updateOptions(options: Record<string, unknown>) {
    this.options = { ...this.options, ...options }
  }

  dispose() {
    this.disposed = true
    events.push('dispose:widget')
  }
}

function fakeMonaco() {
  const models = new Map<string, FakeModel>()
  const diffEditors: FakeDiffEditor[] = []

  const createModel = (value: string, language: string, uri: { toString(): string }): FakeModel => {
    let current = value
    const key = uri.toString()
    const model: FakeModel = {
      uri,
      language,
      getValue: () => current,
      setValue: (next) => {
        current = next
      },
      getFullModelRange: () => ({}),
      dispose: () => {
        // Which side this was is what the ordering assertions read.
        events.push(key.endsWith('/original') ? 'dispose:original' : 'dispose:modified')
        models.delete(key)
      },
    }
    models.set(key, model)
    return model
  }

  return {
    models,
    diffEditors,
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    editor: {
      EditorOption: { readOnly: 'readOnly' },
      getModel: (uri: { toString(): string }) => models.get(uri.toString()) ?? null,
      createModel,
      createDiffEditor: (_container: HTMLElement, options: Record<string, unknown>) => {
        const editor = new FakeDiffEditor(options)
        diffEditors.push(editor)
        return editor
      },
      setTheme: (name: string) => {
        themesApplied.push(name)
      },
      defineTheme: () => {},
      setModelLanguage: (model: FakeModel, language: string) => {
        model.language = language
      },
    },
  }
}

const monaco = fakeMonaco()
// The loader's own escape hatch: a Monaco already on the window is used as-is.
Object.assign(window, { monaco })

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

/** A graphical diff with nothing in it, so the viewer renders its "no changes" line and no canvas. */
const EMPTY_GRAPHICAL_DIFF: GraphicalDiffResult = {
  flows: [],
  changedIndexes: [],
  variableDiff: [],
  nodeDiffMaps: { original: new Map(), current: new Map() },
  edgeDiffMaps: [],
  isLadder: true,
}

const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort(),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort(),
  device: stubPort(),
  orchestrator: stubPort(),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort<VersionControlPort>({ computeGraphicalDiff: () => EMPTY_GRAPHICAL_DIFF }),
  navigation: stubPort(),
  library: stubPort(),
  capabilities: EDITOR_CAPABILITIES,
}

const wrapper = ({ children }: { children: ReactNode }) => <PlatformProvider ports={ports}>{children}</PlatformProvider>

function renderDiff(filePath = 'pous/programs/main.st') {
  return render(<FileDiffView filePath={filePath} original='before' current='after' isDark={false} />, { wrapper })
}

/** Mounting is asynchronous: the library awaits its loader before it asks for a widget. */
async function mounted(count: number) {
  await waitFor(() => expect(monaco.diffEditors.length).toBe(count))
}

const lastEditor = () => monaco.diffEditors[monaco.diffEditors.length - 1]

const count = (event: string) => events.filter((entry) => entry === event).length

beforeEach(() => {
  events.length = 0
  monaco.models.clear()
  monaco.diffEditors.length = 0
  themesApplied.length = 0
})

/**
 * `setTheme` is global to every Monaco on the page: a diff mounting with a built-in
 * theme restyled the POU editor behind it and left its ST highlighting dead until the
 * user toggled dark mode by hand.
 */
describe('the theme it drives', () => {
  it('never applies a built-in theme, which would restyle every other editor', async () => {
    renderDiff()
    await mounted(1)

    expect(themesApplied).not.toContain('vs')
    expect(themesApplied).not.toContain('vs-dark')
  })

  it("applies the app's own theme", async () => {
    renderDiff()
    await mounted(1)

    expect(themesApplied).toContain('openplc-light')
  })
})

describe('tearing the diff down', () => {
  it('releases the models from the widget before disposing them', async () => {
    const { unmount } = renderDiff()
    await mounted(1)

    unmount()

    // Reversing these lines is what throws: models must be released before disposed.
    expect(events.slice(0, 3)).toEqual(['setModel:null', 'dispose:original', 'dispose:modified'])
  })

  it('leaves the library nothing to dispose itself', async () => {
    const { unmount } = renderDiff()
    await mounted(1)

    unmount()

    // `keepCurrentOriginalModel`/`keepCurrentModifiedModel` stop the library disposing these itself.
    expect(count('dispose:original')).toBe(1)
    expect(count('dispose:modified')).toBe(1)
    expect(count('dispose:widget')).toBe(1)
  })

  it('still disposes the models when the widget went first', async () => {
    const { unmount } = renderDiff()
    await mounted(1)
    // React's parent-vs-child unmount order is not guaranteed; teardown must not depend on it.
    lastEditor().disposed = true

    expect(() => unmount()).not.toThrow()
    expect(events.slice(0, 2)).toEqual(['dispose:original', 'dispose:modified'])
  })

  it('disposes nothing when there was never an editor', async () => {
    // A graphical file never mounts Monaco at all.
    const { unmount } = renderDiff('pous/main.ld')
    await screen.findByText('No graphical changes detected')

    unmount()

    expect(events).toEqual([])
    expect(monaco.diffEditors).toEqual([])
  })
})

describe('useDiffEditorTeardown', () => {
  function editorWith(models: ModelPair, options: { disposed?: boolean } = {}) {
    const editor = new FakeDiffEditor({})
    editor.models = models
    editor.disposed = options.disposed ?? false
    return editor
  }

  const modelPair = (): ModelPair => ({
    original: monaco.editor.createModel('a', 'st', monaco.Uri.parse('inmemory://hook/original')),
    modified: monaco.editor.createModel('b', 'st', monaco.Uri.parse('inmemory://hook/modified')),
  })

  it('releases the models from the widget, then disposes them', () => {
    const { result, unmount } = renderHook(() => useDiffEditorTeardown())
    // The ref is typed for Monaco's own editor; the fake answers the three calls it makes.
    Object.assign(result.current, { current: editorWith(modelPair()) })

    unmount()

    expect(events).toEqual(['setModel:null', 'dispose:original', 'dispose:modified'])
  })

  it('still disposes the models when the widget is already gone', () => {
    const { result, unmount } = renderHook(() => useDiffEditorTeardown())
    Object.assign(result.current, { current: editorWith(modelPair(), { disposed: true }) })

    expect(() => unmount()).not.toThrow()
    expect(events).toEqual(['dispose:original', 'dispose:modified'])
  })

  it('does nothing when no editor ever mounted', () => {
    const { unmount } = renderHook(() => useDiffEditorTeardown())

    unmount()

    expect(events).toEqual([])
  })
})

describe('keeping instances apart', () => {
  it('gives each view its own model URI', async () => {
    renderDiff()
    renderDiff()
    await mounted(2)

    const [first, second] = monaco.diffEditors.map((editor) => editor.getModel())

    // Without distinct URIs every diff in the app would share one model pair.
    expect(first?.original.uri.toString()).not.toBe(second?.original.uri.toString())
    expect(first?.original.uri.toString()).not.toBe(first?.modified.uri.toString())
    expect(monaco.models.size).toBe(4)
  })

  it('builds a URI Monaco can parse', () => {
    const { result } = renderHook(() => useDiffModelPaths())

    const path = result.current.original

    // React's own id is punctuated (`:r0:`); a colon in the authority reads as a port.
    expect(path.startsWith('inmemory://')).toBe(true)
    expect(path.slice('inmemory://'.length)).not.toContain(':')
    expect(() => new URL(path)).not.toThrow()
  })

  it('keeps the same model when the file changes, so content syncs instead of resurrecting', async () => {
    const { rerender } = renderDiff('a.st')
    await mounted(1)
    const before = lastEditor().getModel()

    rerender(<FileDiffView filePath='b.st' original='x' current='y' isDark={false} />)

    // A new path would hand back a cached model with stale text; same path, new content, syncs instead.
    await waitFor(() => expect(lastEditor().getModel()?.modified.getValue()).toBe('y'))
    expect(lastEditor().getModel()?.original).toBe(before?.original)
    expect(lastEditor().getModel()?.original.getValue()).toBe('x')
    expect(monaco.models.size).toBe(2)
  })
})

describe('what it renders', () => {
  it('sends a graphical POU to the graphical viewer', async () => {
    renderDiff('pous/main.fbd')

    expect(await screen.findByText('No graphical changes detected')).not.toBeNull()
    expect(monaco.diffEditors).toEqual([])
  })

  it('sends everything else to Monaco, read-only', async () => {
    renderDiff('devices/configuration.json')
    await mounted(1)

    expect(lastEditor().options).toMatchObject({ readOnly: true })
    expect(lastEditor().getModel()?.modified.language).toBe('json')
  })

  it('names the language by the file extension', () => {
    expect(getLanguageFromPath('devices/configuration.json')).toBe('json')
    expect(getLanguageFromPath('pous/programs/main.st')).toBe('st')
    expect(getLanguageFromPath('pous/programs/helper.py')).toBe('python')
    expect(getLanguageFromPath('README')).toBe('plaintext')
  })
})
