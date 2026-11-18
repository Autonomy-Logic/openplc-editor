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
import { planLiveElements } from '@root/middleware/shared/utils/hmi/designer/designer-live'
import type { DesignerModel } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import type { HmiDevicePreset } from '@root/middleware/shared/utils/hmi/device-presets'
import { formatHmiPreviewTimings } from '@root/middleware/shared/utils/hmi/preview-timings'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
}

export interface PreviewControls extends PreviewState {
  /** The last module that started, with its pages, setters and element ids, live elements included. */
  built: Built | null
  /** Builds and starts the preview from `request`. */
  rebuild: () => void
  pointer: (kind: HmiPointerKind, x: number, y: number) => void
  key: (code: number) => void
  /** Applies an edit of a literal property live; false when it needs a build. */
  setLive: (screen: string, element: string, property: string, value: string) => boolean
  /**
   * Shows elements an edit added to the shown screen before its build, as that build will draw them (`model` is the
   * screen after the edit); false when the running module cannot, and only the build shows them. A build already
   * running is then dropped, since it lacks them.
   */
  addLive: (screen: string, model: DesignerModel, added: readonly string[], catalog: HmiWidgetCatalog) => boolean
  /** Keeps a live element's name in step with a rename, until the build that compiles it. */
  renameLive: (screen: string, from: string, to: string) => void
}

interface Options {
  request: HmiPreviewRequest | null
  /** The screen shown, by name; the widget-block preview screen for a widget block. */
  screen: string
  device: HmiDevicePreset
  design: boolean
  framePeriodMs: number
  canvas: RefObject<HTMLCanvasElement>
  /** Elements the shown screen declares; a live element it no longer declares (undone, deleted) is taken off. */
  declared?: readonly string[]
}

/** An element added without a build: its id in the running module and its widget type, upper case. */
interface LiveElement {
  id: number
  type: string
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
  [...live.entries()].map(([element, e]) => ({ id: e.id, screen, element }))

export function usePreviewSession({
  request,
  screen,
  device,
  design,
  framePeriodMs,
  canvas,
  declared,
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
      if (live) {
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

  const rebuild = useCallback(() => {
    const current = requestRef.current
    if (!port || !current) return
    const id = ++generation.current
    const startedSeq = editSeq.current
    const started = performance.now()
    const onStep = (step: HmiBuildStep) => {
      if (id === generation.current) setState((s) => ({ ...s, step }))
    }
    setState((s) => ({ ...s, status: 'building' }))
    void port.build(current, onStep).then(async (result) => {
      if (id !== generation.current) return
      if (!result.ok) {
        setState((s) => ({ ...s, status: builtRef.current ? 'ready' : 'failed', errors: result.errors, step: null }))
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
        liveRef.current = new Map()
        editsRef.current = editsRef.current.filter((e) => e.seq > startedSeq)
        for (const edit of editsRef.current) applyEdit(result, running, edit)
        const frameStart = performance.now()
        first = await running.frame(Math.round(performance.now() - started), surface)
        firstFrameMs = performance.now() - frameStart
      } catch (error) {
        if (id !== generation.current) return
        const message = error instanceof Error ? error.message : String(error)
        setState((s) => ({ ...s, status: 'failed', errors: [{ file: 'HMI', message }], step: null }))
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
      }))
      addLog({
        level: 'debug',
        message: formatHmiPreviewTimings(result.timings, result.stats, { startMs, firstFrameMs }),
      })
    })
  }, [port, screen, device.width, device.height, design, surface, paint, applyEdit, addLog])

  const ready = request !== null
  useEffect(() => {
    if (ready) rebuild()
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
          if (frame.page !== pageRef.current && liveRef.current.size > 0) setLiveElements(new Map())
          pageRef.current = frame.page
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
  }, [running, built, surface, framePeriodMs, paint, setLiveElements])

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

  const addLive = useCallback(
    (screenName: string, model: DesignerModel, added: readonly string[], catalog: HmiWidgetCatalog): boolean => {
      const current = builtRef.current
      const running = session.current
      if (!current || !running || upper(screenName) !== upper(screen)) return false
      if (current.pages[screen] !== pageRef.current) return false
      const compiled = new Map(
        current.elementIds.filter((e) => upper(e.screen) === upper(screen)).map((e) => [upper(e.element), e.id]),
      )
      const idOf = (name: string): number | undefined =>
        liveRef.current.get(upper(name))?.id ?? compiled.get(upper(name))
      const plan = planLiveElements({ model, added, catalog, factory: current.factory, idOf })
      if (!plan) return false
      generation.current++
      void running
        .add(plan.elements)
        .then((ids) => {
          if (!ids || builtRef.current !== current) return
          const live = new Map(liveRef.current)
          plan.names.forEach((name, i) => {
            const type = model.elements.find((e) => upper(e.name) === upper(name))?.type ?? ''
            live.set(upper(name), { id: ids[i], type: upper(type) })
          })
          setLiveElements(live)
          tickRef.current?.()
        })
        .catch(() => undefined)
      return true
    },
    [screen, setLiveElements],
  )

  const renameLive = useCallback(
    (screenName: string, from: string, to: string) => {
      const entry = liveRef.current.get(upper(from))
      if (!entry || upper(screenName) !== upper(screen)) return
      const live = new Map(liveRef.current)
      live.delete(upper(from))
      live.set(upper(to), entry)
      setLiveElements(live)
    },
    [screen, setLiveElements],
  )

  useEffect(() => {
    const running = session.current
    if (!declared || !running || liveRef.current.size === 0) return
    const names = new Set(declared.map(upper))
    const gone = [...liveRef.current.entries()].filter(([name]) => !names.has(name))
    if (gone.length === 0) return
    setLiveElements(new Map([...liveRef.current.entries()].filter(([name]) => names.has(name))))
    void running
      .remove(gone.map(([, e]) => e.id))
      .then(() => tickRef.current?.())
      .catch(() => undefined)
  }, [declared, setLiveElements])

  const withLive = useMemo(
    () => (built && liveIds.length > 0 ? { ...built, elementIds: [...built.elementIds, ...liveIds] } : built),
    [built, liveIds],
  )

  return { ...state, built: withLive, rebuild, pointer, key, setLive, addLive, renameLive }
}
