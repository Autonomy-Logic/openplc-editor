/**
 * @jest-environment jsdom
 */
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import type { HmiPreviewPort, HmiPreviewSession } from '@root/middleware/shared/ports/hmi-preview-port'
import type {
  HmiLiveDetach,
  HmiLiveElement,
  HmiPreviewBuild,
  HmiPreviewFrame,
  HmiWidgetCatalog,
  HmiWidgetInfo,
  HmiWidgetProperty,
} from '@root/middleware/shared/ports/hmi-preview-types'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import { type DesignerModel, parseDesignerBlock } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { defaultHmiSettings } from '@root/middleware/shared/utils/hmi/settings'
import { act, renderHook } from '@testing-library/react'

import { usePreviewSession } from '../use-preview-session'

type Built = Extract<HmiPreviewBuild, { ok: true }>

/** jsdom has no ImageData; the hook only stores pixels in it. */
class TestImageData {
  readonly data: Uint8ClampedArray
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}
if (typeof globalThis.ImageData === 'undefined') Reflect.set(globalThis, 'ImageData', TestImageData)

const property = (name: string, kind: HmiWidgetProperty['kind'], declaredBy: string): HmiWidgetProperty => ({
  name,
  type: kind === 'string' ? 'STRING' : 'DINT',
  kind,
  group: 'display',
  declaredBy,
})
const widget = (name: string, base: string, own: HmiWidgetProperty[] = []): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties: [property('Parent', 'elementRef', 'HmiElement'), ...own],
  outputs: [],
  events: [],
})
const WIDGETS = [
  widget('HmiHorizontalStack', 'HmiStack'),
  widget('HmiLabel', 'HmiElement', [property('Text', 'string', 'HmiLabel')]),
]
const catalog: HmiWidgetCatalog = { widgets: new Map(WIDGETS.map((w) => [w.name.toUpperCase(), w])), colors: [] }
const isWidget = (type: string) => catalog.widgets.has(type.toUpperCase())

const screenSource = (lines: string[], theme = '') =>
  `${theme}FUNCTION_BLOCK Main EXTENDS HmiScreen\n  VAR\n${lines.join('\n')}\n  END_VAR\nEND_FUNCTION_BLOCK\n`
const BODY = '    Body : HmiHorizontalStack;'
const A = "    A : HmiLabel := (Parent := 'Body', Text := 'Alpha');"
const B = "    B : HmiLabel := (Parent := 'Body', Text := 'Bravo');"
const parsedModels = new Map<string, DesignerModel>()
/** The model of a source, the same object for the same text, as the designer memoises it. */
const parse = (source: string): DesignerModel => {
  const known = parsedModels.get(source)
  if (known) return known
  const parsed = parseDesignerBlock(source, isWidget)
  if (!parsed.ok) throw new Error('the screen does not parse')
  parsedModels.set(source, parsed.model)
  return parsed.model
}

const built = (elements: string[]): Built => ({
  ok: true,
  wasm: new Uint8Array([0]),
  pages: { Main: 0 },
  setters: { 'Main.A.Text': { screen: 0, index: 0, kind: 'str' } },
  elementIds: elements.map((element, i) => ({ id: i + 1, screen: 'Main', element })),
  factory: {
    types: {
      HMILABEL: { type: 1, setters: { TEXT: { index: 0, kind: 'str' } } },
      HMIHORIZONTALSTACK: { type: 0, setters: {} },
    },
  },
  warnings: [],
  stats: { units: 1, cached: 1 },
})

/** A promise the test settles. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}

/** A preview whose builds, loads and changes the test settles, recording what reaches the session. */
function fakePreview() {
  const builds: Array<ReturnType<typeof deferred<HmiPreviewBuild>>> = []
  const loads: Array<ReturnType<typeof deferred<undefined>>> = []
  const changes: Array<{ detach: readonly HmiLiveDetach[]; elements: readonly HmiLiveElement[] }> = []
  const texts: Array<[number, number, string, number | undefined]> = []
  let page = 0
  let nextId = 100
  const session: HmiPreviewSession = {
    load: () => {
      const load = deferred<undefined>()
      loads.push(load)
      return load.promise
    },
    frame: (): Promise<HmiPreviewFrame> => Promise.resolve({ page, status: 0, pixels: null, bounds: [] }),
    show: () => Promise.resolve(),
    resize: () => Promise.resolve(),
    pointer: () => Promise.resolve(),
    key: () => Promise.resolve(),
    setNumber: () => Promise.resolve(true),
    setText: (screen, setter, value, element) => {
      texts.push([screen, setter, value, element])
      return Promise.resolve(true)
    },
    change: (detach, elements) => {
      changes.push({ detach, elements })
      return Promise.resolve(elements.map((e) => e.element ?? nextId++))
    },
    onStop: () => () => undefined,
    close: () => undefined,
  }
  const port: HmiPreviewPort = {
    build: () => {
      const build = deferred<HmiPreviewBuild>()
      builds.push(build)
      return build.promise
    },
    catalog: () => Promise.reject(new Error('not used')),
    thumbnails: () => Promise.reject(new Error('not used')),
    codeContext: () => Promise.reject(new Error('not used')),
    openSession: () => session,
    holdToolchain: () => Promise.resolve(),
  }
  return { port, builds, loads, changes, texts, setPage: (p: number) => (page = p) }
}

const request = {
  screens: [],
  widgets: [],
  settings: defaultHmiSettings(),
  plcVariables: [],
  projectNames: [],
  libraries: [],
}
const device = { id: 'd', label: 'D', width: 16, height: 8, density: 1 }
const canvas = { current: null }
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

function setup() {
  const preview = fakePreview()
  const store = createTestStore()
  const ports = createTestPorts({ capabilities: EDITOR_CAPABILITIES, hmiPreview: preview.port })
  const hook = renderHook(
    ({ source }: { source: string }) =>
      usePreviewSession({
        request,
        screen: 'Main',
        device,
        design: true,
        framePeriodMs: 20,
        canvas,
        model: parse(source),
        source,
        catalog,
      }),
    { wrapper: createStoreWrapper(store, ports), initialProps: { source: screenSource([BODY, A]) } },
  )
  return { ...preview, hook }
}

/** Settles the newest build with `result` and its load. */
async function land(preview: ReturnType<typeof setup>, result: Built) {
  await act(async () => {
    preview.builds[preview.builds.length - 1].resolve(result)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    preview.loads[preview.loads.length - 1].resolve(undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await flush()
}

describe('usePreviewSession', () => {
  it('holds a change made while a module loads and plans it against that module once it runs', async () => {
    const preview = setup()
    await land(preview, built(['Body', 'A']))
    expect(preview.hook.result.current.status).toBe('ready')

    preview.hook.rerender({ source: screenSource([BODY, A, B]) })
    await flush()
    expect(preview.changes).toHaveLength(1)
    expect(preview.changes[0].elements[0].element).toBeUndefined()

    act(() => preview.hook.result.current.rebuild())
    await act(async () => {
      preview.builds[preview.builds.length - 1].resolve(built(['Body', 'A', 'B']))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    preview.hook.rerender({ source: screenSource([BODY, A]) })
    await flush()
    expect(preview.changes).toHaveLength(1)

    await act(async () => {
      preview.loads[preview.loads.length - 1].resolve(undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await flush()
    expect(preview.changes).toHaveLength(2)
    expect(preview.changes[1].detach).toEqual([{ element: 3, parent: 1, parentKind: 'stack' }])
    expect(preview.hook.result.current.showsSource()).toBe(true)
  })

  it('keeps an edit that waits for its build waiting when an element is renamed meanwhile', async () => {
    const preview = setup()
    await land(preview, built(['Body', 'A']))
    const theme = "{attribute 'hmi_theme' := 'Dark'}\n"
    preview.hook.rerender({ source: screenSource([BODY, A], theme) })
    await flush()
    expect(preview.hook.result.current.showsSource()).toBe(false)
    preview.hook.rerender({ source: screenSource([BODY, A.replace('A :', 'Renamed :')], theme) })
    await flush()
    expect(preview.hook.result.current.showsSource()).toBe(false)
    act(() => preview.hook.result.current.rebuild())
    expect(preview.hook.result.current.waiting).toBe(true)
  })

  it('applies a value edit made while a build runs again to the module that build starts', async () => {
    const preview = setup()
    await land(preview, built(['Body', 'A']))
    act(() => preview.hook.result.current.rebuild())
    expect(preview.hook.result.current.setLive('Main', 'A', 'Text', "'Live'")).toBe(true)
    expect(preview.texts).toEqual([[0, 0, 'Live', undefined]])
    await land(preview, built(['Body', 'A']))
    expect(preview.texts).toEqual([
      [0, 0, 'Live', undefined],
      [0, 0, 'Live', undefined],
    ])
  })

  it('reports a build whose toolchain call failed, keeping the module that runs', async () => {
    const preview = setup()
    await land(preview, built(['Body', 'A']))
    act(() => preview.hook.result.current.rebuild())
    expect(preview.hook.result.current.status).toBe('building')
    await act(async () => {
      preview.builds[preview.builds.length - 1].reject(new Error('the compiler went away'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(preview.hook.result.current.status).toBe('ready')
    expect(preview.hook.result.current.errors).toEqual([{ file: 'HMI', message: 'the compiler went away' }])
  })

  it('shows the live changes again when the screen is shown again after another page', async () => {
    const preview = setup()
    await land(preview, built(['Body', 'A']))
    preview.hook.rerender({ source: screenSource([BODY, A, B]) })
    await flush()
    expect(preview.changes).toHaveLength(1)
    preview.setPage(1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)))
    expect(preview.hook.result.current.page).toBe(1)
    preview.setPage(0)
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)))
    expect(preview.changes).toHaveLength(2)
    expect(preview.changes[1].elements).toMatchObject([{ type: 1, texts: [{ value: 'Bravo' }] }])
  })
})
