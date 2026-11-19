/**
 * The running preview of a screen or widget block: builds it, keeps the last good module while a build runs, drives
 * frames (also while a build runs), paints changed rows, keeps element bounds, applies live property edits and follows
 * structural edits without a build.
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
  HmiPreviewSurface,
  HmiWidgetCatalog,
} from '@root/middleware/shared/ports/hmi-preview-types'
import { useHmiPreview } from '@root/middleware/shared/providers'
import { liveValue } from '@root/middleware/shared/utils/hmi/designer/designer-canvas'
import { planLiveSync } from '@root/middleware/shared/utils/hmi/designer/designer-live'
import {
  compiledEntries,
  entriesAfter,
  liveElementIds,
  type LiveEntries,
  liveModuleOf,
  liveSetter,
} from '@root/middleware/shared/utils/hmi/designer/designer-live-module'
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
  /** Whether the running module shows the screen's source as it reads now, so its build only catches up. */
  showsSource: () => boolean
}

export interface PreviewSessionOptions {
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

/** Copies a frame's changed rows into `image` and onto the canvas; a canvas of another size gets the image whole. */
function paintFrame(
  frame: HmiPreviewFrame,
  image: ImageData,
  target: HTMLCanvasElement | null,
  surface: HmiPreviewSurface,
): void {
  if (frame.pixels && frame.pixels.width === surface.width)
    image.data.set(frame.pixels.rgba, frame.pixels.y0 * surface.width * 4)
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
}

/** Applies one live edit to the running module; false when it has no setter for it on the page shown. */
function applyEdit(
  entries: LiveEntries,
  current: Built,
  running: HmiPreviewSession,
  page: number,
  edit: Omit<LiveEdit, 'seq'>,
): boolean {
  const setter = liveSetter(entries, current, edit.screen, edit.element, edit.property)
  const live = liveValue(edit.value)
  if (!setter || !live || setter.screen !== page) return false
  if (setter.kind === 'num' && 'number' in live) {
    void running.setNumber(setter.screen, setter.index, live.number, setter.element).catch(() => undefined)
    return true
  }
  if (setter.kind === 'str' && 'text' in live) {
    void running.setText(setter.screen, setter.index, live.text, setter.element).catch(() => undefined)
    return true
  }
  return false
}

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
}: PreviewSessionOptions): PreviewControls {
  const port = useHmiPreview()
  const addLog = useOpenPLCStore((s) => s.consoleActions.addLog)
  const session = useRef<HmiPreviewSession | null>(null)
  const requestRef = useRef(request)
  const builtRef = useRef<Built | null>(null)
  const pageRef = useRef(0)
  const generation = useRef(0)
  const frameBusy = useRef(false)
  const frameAgain = useRef(false)
  const tickRef = useRef<(() => void) | null>(null)
  const imageRef = useRef<ImageData | null>(null)
  const liveRef = useRef<LiveEntries>(new Map())
  const screenText = useMemo((): ScreenText | null => (model ? { model, source } : null), [model, source])
  const modelRef = useRef(screenText)
  modelRef.current = screenText
  const shownRef = useRef<ScreenText | null>(null)
  const builtModelRef = useRef<ScreenText | null>(null)
  const changing = useRef(false)
  const loading = useRef(0)
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

  const paint = useCallback(
    (frame: HmiPreviewFrame) => {
      let image = imageRef.current
      if (!image || image.width !== surface.width || image.height !== surface.height) {
        image = new ImageData(surface.width, surface.height)
        imageRef.current = image
      }
      paintFrame(frame, image, canvas.current, surface)
    },
    [canvas, surface],
  )

  const setLiveElements = useCallback(
    (live: LiveEntries) => {
      liveRef.current = live
      setLiveIds(liveElementIds(live, screen))
    },
    [screen],
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
      const failed = (error: unknown) => {
        if (id !== generation.current) return
        const message = error instanceof Error ? error.message : String(error)
        setState((s) => ({
          ...s,
          status: builtRef.current ? 'ready' : 'failed',
          errors: [{ file: 'HMI', message }],
          step: null,
          waiting: false,
        }))
      }
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
        loading.current++
        try {
          if (!running) throw new Error('The preview was closed')
          const loadStart = performance.now()
          await running.load(result.wasm, { width: device.width, height: device.height, page, design })
          startMs = performance.now() - loadStart
          builtRef.current = result
          pageRef.current = page
          liveRef.current = compiledEntries(result.elementIds, screen)
          builtModelRef.current = startedModel
          shownRef.current = startedModel
          changing.current = false
          editsRef.current = editsRef.current.filter((e) => e.seq > startedSeq)
          for (const edit of editsRef.current) applyEdit(liveRef.current, result, running, page, edit)
          const frameStart = performance.now()
          first = await running.frame(Math.round(performance.now() - started), surface)
          firstFrameMs = performance.now() - frameStart
        } catch (error) {
          loading.current--
          if (id !== generation.current) return
          const message = error instanceof Error ? error.message : String(error)
          setState((s) => ({ ...s, status: 'failed', errors: [{ file: 'HMI', message }], step: null, waiting: false }))
          return
        }
        loading.current--
        paint(first)
        pageRef.current = first.page
        setBuilt(result)
        setLiveIds([])
        const latest = id === generation.current
        setState((s) => ({
          ...s,
          status: latest ? 'ready' : s.status,
          errors: latest ? [] : s.errors,
          buildMs: latest ? Math.round(performance.now() - started) : s.buildMs,
          bounds: first.bounds,
          page: first.page,
          step: latest ? null : s.step,
          waiting: latest ? false : s.waiting,
        }))
        if (latest)
          addLog({
            level: 'debug',
            message: formatHmiPreviewTimings(result.timings, result.stats, { startMs, firstFrameMs }),
          })
        syncRef.current()
      }, failed)
    },
    [port, screen, device.width, device.height, design, surface, paint, addLog],
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
      const opened = session.current
      if (!opened) return
      if (frameBusy.current) {
        frameAgain.current = true
        return
      }
      frameBusy.current = true
      opened
        .frame(Math.round(performance.now() - started), surface)
        .then((frame) => {
          paint(frame)
          const current = builtRef.current
          if (frame.page !== pageRef.current && current) {
            setLiveElements(compiledEntries(current.elementIds, screen))
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

  const setLive = useCallback((screenName: string, element: string, property: string, value: string): boolean => {
    const current = builtRef.current
    const previewSession = session.current
    if (!current || !previewSession) return false
    const edit = { screen: screenName, element, property, value }
    if (!applyEdit(liveRef.current, current, previewSession, pageRef.current, edit)) return false
    editsRef.current.push({ ...edit, seq: ++editSeq.current })
    return true
  }, [])

  const syncLive = useCallback(() => {
    const current = builtRef.current
    const previewSession = session.current
    const shown = shownRef.current
    const next = modelRef.current
    if (!current || !previewSession || !shown || !next || !catalog || shown === next) return
    if (changing.current || loading.current > 0 || current.pages[screen] !== pageRef.current) return
    const plan = planLiveSync({
      shown: shown.model,
      shownSource: shown.source,
      next: next.model,
      nextSource: next.source,
      catalog,
      factory: current.factory,
      module: liveModuleOf(liveRef.current),
    })
    if (!plan) return
    const values = plan.values.map((v) => ({ screen, element: v.element, property: v.property, value: v.value }))
    const settable = (edit: Omit<LiveEdit, 'seq'>) => {
      const setter = liveSetter(liveRef.current, current, edit.screen, edit.element, edit.property)
      const live = liveValue(edit.value)
      return setter !== undefined && live !== null && ('number' in live ? setter.kind === 'num' : setter.kind === 'str')
    }
    if (!values.every(settable)) return
    shownRef.current = next
    setState((s) => (s.waiting ? { ...s, waiting: false } : s))
    const setValues = () => {
      for (const edit of values)
        if (applyEdit(liveRef.current, current, previewSession, pageRef.current, edit))
          editsRef.current.push({ ...edit, seq: ++editSeq.current })
    }
    if (plan.detach.length === 0 && plan.elements.length === 0) {
      setValues()
      if (values.length > 0) tickRef.current?.()
      return
    }
    generation.current++
    changing.current = true
    void previewSession
      .change(plan.detach, plan.elements)
      .then((ids) => {
        if (builtRef.current !== current) return
        changing.current = false
        if (!ids) {
          shownRef.current = null
          return
        }
        setLiveElements(entriesAfter(liveRef.current, plan, ids, shown, next.model))
        setValues()
        tickRef.current?.()
        syncRef.current()
      })
      .catch(() => {
        changing.current = false
        shownRef.current = null
      })
  }, [catalog, screen, setLiveElements])
  syncRef.current = syncLive

  useLayoutEffect(() => {
    syncLive()
  }, [screenText, built, syncLive])

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

  return { ...state, built: withLive, rebuild, pointer, key, setLive, showsSource }
}
