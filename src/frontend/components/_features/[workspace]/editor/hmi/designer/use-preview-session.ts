/**
 * The running preview of a screen or widget block: builds it, keeps the last good module while a build runs, drives
 * frames (also while a build runs), paints changed rows, keeps element bounds, applies live property edits and adds new
 * elements without a build.
 */
import { useOpenPLCStore } from '@root/frontend/store'
import type { HmiPreviewSession } from '@root/middleware/shared/ports/hmi-preview-port'
import type {
  HmiBuildStep,
  HmiDiagnostic,
  HmiPointerKind,
  HmiPreviewBounds,
  HmiPreviewBuild,
  HmiPreviewElementId,
  HmiPreviewFrame,
  HmiPreviewRequest,
  HmiPreviewSetter,
  HmiPreviewSurface,
  HmiWidgetCatalog,
} from '@root/middleware/shared/ports/hmi-preview-types'
import { useHmiPreview } from '@root/middleware/shared/providers'
import { liveValue } from '@root/middleware/shared/utils/hmi/designer/designer-canvas'
import { liveDeclaration, planLiveSync } from '@root/middleware/shared/utils/hmi/designer/designer-live'
import type { DesignerModel } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import type { HmiDevicePreset } from '@root/middleware/shared/utils/hmi/device-presets'
import { formatHmiPreviewTimings } from '@root/middleware/shared/utils/hmi/preview-timings'
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

type Built = Extract<HmiPreviewBuild, { ok: true }>

export type PreviewStatus = 'building' | 'ready' | 'failed' | 'stopped' | 'unavailable'

export interface PreviewState {
  status: PreviewStatus
  errors: HmiDiagnostic[]
  /** How long the last build took, in ms. */
  buildMs: number | null
  bounds: HmiPreviewBounds[]
  page: number
  /** The step a build is on; null when no build runs. */
  step: HmiBuildStep | null
  /** The running build is one the screen waits for: the module does not show the source's last edit. */
  waiting: boolean
}

export interface PreviewControls extends PreviewState {
  /** The last module that started, with its pages, setters and element ids, live elements included. */
  built: Built | null
  /**
   * Builds and starts the preview from `request`. `stale` says the module no longer shows the screen (the widget blocks
   * or settings changed); otherwise the build is waited for only when the module does not show the source.
   */
  rebuild: (stale?: boolean) => void
  pointer: (kind: HmiPointerKind, x: number, y: number) => void
  key: (code: number) => void
  /** Applies an edit of a literal property live; false when it needs a build. */
  setLive: (screen: string, element: string, property: string, value: string) => boolean
  /** Keeps an element's name in step with a rename, until the build that compiles it. */
  renameLive: (screen: string, from: string, to: string) => void
  /** Whether the running module shows the screen's source as it reads now, so its build only catches up. */
  showsSource: () => boolean
}

interface Options {
  request: HmiPreviewRequest | null
  /** The screen shown, by name; the widget-block preview screen for a widget block. */
  screen: string
  device: HmiDevicePreset
  design: boolean
  framePeriodMs: number
  canvas: RefObject<HTMLCanvasElement>
  /**
   * The shown screen as its source reads now, and the widget catalogue. Elements it adds, removes or moves are added,
   * removed or moved in the running module before their build when the module can show them as that build will; a
   * build already running is then dropped, since it lacks them.
   */
  model?: DesignerModel | null
  /** The shown screen's source, which `model` was parsed from. */
  source?: string
  catalog?: HmiWidgetCatalog
}

/** A screen as parsed, with its source. */
interface ScreenText {
  model: DesignerModel
  source: string
}

/** An element of the shown screen in the running module: its id, its widget type (upper case) and its state. */
interface LiveElement {
  /** Its name as written. */
  name: string
  id: number
  type: string
  /** Made by the module from the factory table, not compiled. */
  created: boolean
  attached: boolean
  /** Its declaration when it was taken off (`liveDeclaration`). */
  declaration?: string
}

/** A live property edit, applied again to a module whose build started before it. */
interface LiveEdit {
  seq: number
  screen: string
  element: string
  property: string
  value: string
}

const sameBounds = (a: readonly HmiPreviewBounds[], b: readonly HmiPreviewBounds[]): boolean =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.id === b[i].id && x.x === b[i].x && x.y === b[i].y && x.width === b[i].width && x.height === b[i].height,
  )

const upper = (name: string): string => name.toUpperCase()

const liveIdsOf = (live: ReadonlyMap<string, LiveElement>, screen: string): HmiPreviewElementId[] =>
  [...live.values()].map((e) => ({ id: e.id, screen, element: e.name }))

/** The shown screen's elements as a freshly started module holds them: compiled and attached. */
const compiledElements = (built: Built, screen: string): Map<string, LiveElement> =>
  new Map(
    built.elementIds
      .filter((e) => upper(e.screen) === upper(screen))
      .map((e) => [upper(e.element), { name: e.element, id: e.id, type: '', created: false, attached: true }]),
  )

export function usePreviewSession({
  request,
  screen,
  device,
  design,
  framePeriodMs,
  canvas,
  model = null,
  source = '',
  catalog,
}: Options): PreviewControls {
  const port = useHmiPreview()
  const addLog = useOpenPLCStore((s) => s.consoleActions.addLog)
  const session = useRef<HmiPreviewSession | null>(null)
  const requestRef = useRef(request)
  const builtRef = useRef<Built | null>(null)
  /** Page the preview showed in its last frame; only that page's screen exists, so only it takes live edits. */
  const pageRef = useRef(0)
  const generation = useRef(0)
  const frameBusy = useRef(false)
  /** Another frame is wanted as soon as the one running ends. */
  const frameAgain = useRef(false)
  const tickRef = useRef<(() => void) | null>(null)
  /** The last frame whole, as the canvas shows it. */
  const imageRef = useRef<ImageData | null>(null)
  const liveRef = useRef<ReadonlyMap<string, LiveElement>>(new Map())
  const screenText = useMemo((): ScreenText | null => (model ? { model, source } : null), [model, source])
  const modelRef = useRef(screenText)
  modelRef.current = screenText
  /** The screen as the running module shows it, and as its build compiled it; null when unknown. */
  const shownRef = useRef<ScreenText | null>(null)
  const builtModelRef = useRef<ScreenText | null>(null)
  /** A structural change is on its way to the module; the next waits for it. */
  const changing = useRef(false)
  const renamed = useRef<{ from: string; to: string } | null>(null)
  const syncRef = useRef<() => void>(() => undefined)
  const editSeq = useRef(0)
  const editsRef = useRef<LiveEdit[]>([])
  const [built, setBuilt] = useState<Built | null>(null)
  const [liveIds, setLiveIds] = useState<HmiPreviewElementId[]>([])
  const [state, setState] = useState<PreviewState>({
    status: port ? 'building' : 'unavailable',
    errors: [],
    buildMs: null,
    bounds: [],
    page: 0,
    step: null,
    waiting: false,
  })
  requestRef.current = request

  const surface = useMemo(
    (): HmiPreviewSurface => ({
      width: device.width * device.density,
      height: device.height * device.density,
      scale: device.density,
    }),
    [device.width, device.height, device.density],
  )

  /** Copies a frame's changed rows into the image and onto the canvas; a canvas of another size gets it whole. */
  const paint = useCallback(
    (frame: HmiPreviewFrame) => {
      let image = imageRef.current
      if (!image || image.width !== surface.width || image.height !== surface.height) {
        image = new ImageData(surface.width, surface.height)
        imageRef.current = image
      }
      if (frame.pixels && frame.pixels.width === surface.width)
        image.data.set(frame.pixels.rgba, frame.pixels.y0 * surface.width * 4)
      const target = canvas.current
      const context = target?.getContext('2d')
      if (!target || !context) return
      if (target.width !== surface.width || target.height !== surface.height) {
        target.width = surface.width
        target.height = surface.height
        context.putImageData(image, 0, 0)
      } else if (frame.pixels) {
        const { width, rows, y0, rgba } = frame.pixels
        context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, rows), 0, y0)
      }
    },
    [canvas, surface],
  )

  const setLiveElements = useCallback(
    (live: ReadonlyMap<string, LiveElement>) => {
      liveRef.current = live
      setLiveIds(liveIdsOf(live, screen))
    },
    [screen],
  )

  /** The setter of a property: a live element's factory setter on the shown screen, else the build's. */
  const setterOf = useCallback(
    (current: Built, screenName: string, element: string, property: string): HmiPreviewSetter | undefined => {
      const live = upper(screenName) === upper(screen) ? liveRef.current.get(upper(element)) : undefined
      if (live?.created) {
        const setter = current.factory.types[live.type]?.setters[upper(property)]
        const page = current.pages[screen]
        return setter && page !== undefined ? { ...setter, screen: page, element: live.id } : undefined
      }
      const wanted = upper(`${screenName}.${element}.${property}`)
      return Object.entries(current.setters).find(([k]) => upper(k) === wanted)?.[1]
    },
    [screen],
  )

  /** Applies one live edit to the running module; false when it has no setter for it. */
  const applyEdit = useCallback(
    (current: Built, running: HmiPreviewSession, edit: Omit<LiveEdit, 'seq'>): boolean => {
      const setter = setterOf(current, edit.screen, edit.element, edit.property)
      const live = liveValue(edit.value)
      if (!setter || !live || setter.screen !== pageRef.current) return false
      if (setter.kind === 'num' && 'number' in live) {
        void running.setNumber(setter.screen, setter.index, live.number, setter.element).catch(() => undefined)
        return true
      }
      if (setter.kind === 'str' && 'text' in live) {
        void running.setText(setter.screen, setter.index, live.text, setter.element).catch(() => undefined)
        return true
      }
      return false
    },
    [setterOf],
  )

  useEffect(() => {
    if (!port) return
    const opened = port.openSession()
    session.current = opened
    const unsubscribe = opened.onStop((reason) =>
      setState((s) => ({ ...s, status: 'stopped', errors: [{ file: 'HMI', message: reason }] })),
    )
    return () => {
      unsubscribe()
      opened.close()
      session.current = null
    }
  }, [port])

  const rebuild = useCallback(
    (stale = false) => {
      const current = requestRef.current
      if (!port || !current) return
      const waiting =
        builtRef.current !== null && (stale || shownRef.current === null || shownRef.current !== modelRef.current)
      const id = ++generation.current
      const startedSeq = editSeq.current
      const startedModel = modelRef.current
      const started = performance.now()
      const onStep = (step: HmiBuildStep) => {
        if (id === generation.current) setState((s) => ({ ...s, step }))
      }
      setState((s) => ({ ...s, status: 'building', waiting }))
      void port.build(current, onStep).then(async (result) => {
        if (id !== generation.current) return
        if (!result.ok) {
          setState((s) => ({
            ...s,
            status: builtRef.current ? 'ready' : 'failed',
            errors: result.errors,
            step: null,
            waiting: false,
          }))
          return
        }
        const page = result.pages[screen] ?? 0
        onStep('start')
        const running = session.current
        let first: HmiPreviewFrame
        let startMs = 0
        let firstFrameMs = 0
        try {
          if (!running) throw new Error('The preview was closed')
          const loadStart = performance.now()
          await running.load(result.wasm, { width: device.width, height: device.height, page, design })
          startMs = performance.now() - loadStart
          if (id !== generation.current) return
          builtRef.current = result
          pageRef.current = page
          liveRef.current = compiledElements(result, screen)
          builtModelRef.current = startedModel
          shownRef.current = startedModel
          changing.current = false
          editsRef.current = editsRef.current.filter((e) => e.seq > startedSeq)
          for (const edit of editsRef.current) applyEdit(result, running, edit)
          const frameStart = performance.now()
          first = await running.frame(Math.round(performance.now() - started), surface)
          firstFrameMs = performance.now() - frameStart
        } catch (error) {
          if (id !== generation.current) return
          const message = error instanceof Error ? error.message : String(error)
          setState((s) => ({ ...s, status: 'failed', errors: [{ file: 'HMI', message }], step: null, waiting: false }))
          return
        }
        if (id !== generation.current) return
        paint(first)
        pageRef.current = first.page
        setBuilt(result)
        setLiveIds([])
        setState((s) => ({
          ...s,
          status: 'ready',
          errors: [],
          buildMs: Math.round(performance.now() - started),
          bounds: first.bounds,
          page: first.page,
          step: null,
          waiting: false,
        }))
        addLog({
          level: 'debug',
          message: formatHmiPreviewTimings(result.timings, result.stats, { startMs, firstFrameMs }),
        })
      })
    },
    [port, screen, device.width, device.height, design, surface, paint, applyEdit, addLog],
  )

  const ready = request !== null
  useEffect(() => {
    if (ready) rebuild(true)
  }, [rebuild, ready])

  const running = built !== null && state.status !== 'stopped'
  useEffect(() => {
    if (!running) return
    const started = performance.now()
    const tick = () => {
      const running = session.current
      if (!running) return
      if (frameBusy.current) {
        frameAgain.current = true
        return
      }
      frameBusy.current = true
      running
        .frame(Math.round(performance.now() - started), surface)
        .then((frame) => {
          paint(frame)
          const current = builtRef.current
          if (frame.page !== pageRef.current && current) {
            setLiveElements(compiledElements(current, screen))
            shownRef.current = builtModelRef.current
          }
          pageRef.current = frame.page
          if (current && frame.page === current.pages[screen]) syncRef.current()
          setState((s) =>
            sameBounds(s.bounds, frame.bounds) && s.page === frame.page
              ? s
              : { ...s, bounds: frame.bounds, page: frame.page },
          )
        })
        .catch(() => undefined)
        .finally(() => {
          frameBusy.current = false
          if (frameAgain.current) {
            frameAgain.current = false
            tick()
          }
        })
    }
    tickRef.current = tick
    const timer = setInterval(tick, framePeriodMs)
    return () => {
      clearInterval(timer)
      if (tickRef.current === tick) tickRef.current = null
    }
  }, [running, built, surface, framePeriodMs, paint, setLiveElements, screen])

  const pointer = useCallback((kind: HmiPointerKind, x: number, y: number) => {
    void session.current?.pointer(kind, x, y).catch(() => undefined)
  }, [])
  const key = useCallback((code: number) => {
    void session.current?.key(code).catch(() => undefined)
  }, [])

  const setLive = useCallback(
    (screenName: string, element: string, property: string, value: string): boolean => {
      const current = builtRef.current
      const running = session.current
      if (!current || !running) return false
      const edit = { screen: screenName, element, property, value }
      if (!applyEdit(current, running, edit)) return false
      editsRef.current.push({ ...edit, seq: ++editSeq.current })
      return true
    },
    [applyEdit],
  )

  /** Brings the running module's structure in step with the source, when it can show the change exactly. */
  const syncLive = useCallback(() => {
    const current = builtRef.current
    const running = session.current
    const shown = shownRef.current
    const next = modelRef.current
    if (!current || !running || !shown || !next || !catalog || changing.current || shown === next) return
    if (current.pages[screen] !== pageRef.current) return
    const rename = renamed.current
    if (rename) {
      renamed.current = null
      const has = (name: string) => next.model.elements.some((e) => upper(e.name) === upper(name))
      const entry = liveRef.current.get(upper(rename.from))
      if (has(rename.to) && !has(rename.from)) {
        if (entry) {
          const live = new Map(liveRef.current)
          live.delete(upper(rename.from))
          live.set(upper(rename.to), { ...entry, name: rename.to })
          setLiveElements(live)
        }
        shownRef.current = next
        return
      }
    }
    const entryOf = (name: string) => liveRef.current.get(upper(name))
    const plan = planLiveSync({
      shown: shown.model,
      shownSource: shown.source,
      next: next.model,
      nextSource: next.source,
      catalog,
      factory: current.factory,
      module: {
        attached: (name) => (entryOf(name)?.attached ? entryOf(name)?.id : undefined),
        detached: (name) => {
          const entry = entryOf(name)
          return entry && !entry.attached ? { id: entry.id, declaration: entry.declaration ?? '' } : undefined
        },
        created: (name) => entryOf(name)?.created ?? false,
      },
    })
    if (!plan) return
    const values = plan.values.map((v) => ({ screen, element: v.element, property: v.property, value: v.value }))
    const settable = (edit: Omit<LiveEdit, 'seq'>) => {
      const setter = setterOf(current, edit.screen, edit.element, edit.property)
      const live = liveValue(edit.value)
      return setter !== undefined && live !== null && ('number' in live ? setter.kind === 'num' : setter.kind === 'str')
    }
    if (!values.every(settable)) return
    shownRef.current = next
    setState((s) => (s.waiting ? { ...s, waiting: false } : s))
    const setValues = () => {
      for (const edit of values)
        if (applyEdit(current, running, edit)) editsRef.current.push({ ...edit, seq: ++editSeq.current })
    }
    if (plan.detach.length === 0 && plan.elements.length === 0) {
      setValues()
      if (values.length > 0) tickRef.current?.()
      return
    }
    generation.current++
    changing.current = true
    void running
      .change(plan.detach, plan.elements)
      .then((ids) => {
        if (builtRef.current !== current) return
        changing.current = false
        if (!ids) {
          shownRef.current = null
          return
        }
        const live = new Map(liveRef.current)
        for (const name of plan.detached) {
          const entry = live.get(upper(name))
          const declared = shown.model.elements.find((e) => upper(e.name) === upper(name))
          const declaration = declared ? liveDeclaration(shown.source, declared) : ''
          if (entry) live.set(upper(name), { ...entry, attached: false, declaration })
        }
        plan.names.forEach((name, i) => {
          const type = next.model.elements.find((e) => upper(e.name) === upper(name))?.type ?? ''
          const created = plan.elements[i].element === undefined
          const before = live.get(upper(name))
          live.set(upper(name), {
            name,
            id: ids[i],
            type: created ? upper(type) : (before?.type ?? ''),
            created: created || (before?.created ?? false),
            attached: true,
          })
        })
        setLiveElements(live)
        setValues()
        tickRef.current?.()
        syncRef.current()
      })
      .catch(() => {
        changing.current = false
        shownRef.current = null
      })
  }, [catalog, screen, setLiveElements, setterOf, applyEdit])
  syncRef.current = syncLive

  useLayoutEffect(() => {
    syncLive()
  }, [screenText, built, syncLive])

  const renameLive = useCallback(
    (screenName: string, from: string, to: string) => {
      if (upper(screenName) === upper(screen)) renamed.current = { from, to }
    },
    [screen],
  )

  const withLive = useMemo(
    () =>
      built && liveIds.length > 0
        ? {
            ...built,
            elementIds: [...built.elementIds.filter((e) => upper(e.screen) !== upper(screen)), ...liveIds],
          }
        : built,
    [built, liveIds, screen],
  )

  const showsSource = useCallback(() => shownRef.current !== null && shownRef.current === modelRef.current, [])

  return { ...state, built: withLive, rebuild, pointer, key, setLive, renameLive, showsSource }
}
