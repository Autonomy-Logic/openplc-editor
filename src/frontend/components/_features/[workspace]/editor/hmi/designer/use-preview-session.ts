/**
 * The running preview of a screen or widget block: builds on opening and on request, keeps the last good module on
 * screen while a build runs, drives frames at the project's frame period, paints the rows that changed and keeps the
 * element bounds, and applies live property edits through the module's setters.
 */
import type { HmiPreviewSession } from '@root/middleware/shared/ports/hmi-preview-port'
import type {
  HmiDiagnostic,
  HmiPointerKind,
  HmiPreviewBounds,
  HmiPreviewBuild,
  HmiPreviewRequest,
} from '@root/middleware/shared/ports/hmi-preview-types'
import { useHmiPreview } from '@root/middleware/shared/providers'
import { liveValue } from '@root/middleware/shared/utils/hmi/designer/designer-canvas'
import type { HmiDevicePreset } from '@root/middleware/shared/utils/hmi/device-presets'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

type Built = Extract<HmiPreviewBuild, { ok: true }>

export type PreviewStatus = 'building' | 'ready' | 'failed' | 'stopped' | 'unavailable'

export interface PreviewState {
  status: PreviewStatus
  errors: HmiDiagnostic[]
  /** How long the last build took, in ms. */
  buildMs: number | null
  bounds: HmiPreviewBounds[]
  page: number
}

export interface PreviewControls extends PreviewState {
  /** The last module that started, with its pages, setters and element ids. */
  built: Built | null
  /** Builds and starts the preview from `request`. */
  rebuild: () => void
  pointer: (kind: HmiPointerKind, x: number, y: number) => void
  key: (code: number) => void
  /** Applies an edit of a literal property live; false when it needs a build. */
  setLive: (screen: string, element: string, property: string, value: string) => boolean
}

interface Options {
  request: HmiPreviewRequest | null
  /** The screen shown, by name; the widget-block preview screen for a widget block. */
  screen: string
  device: HmiDevicePreset
  design: boolean
  framePeriodMs: number
  canvas: RefObject<HTMLCanvasElement>
}

const sameBounds = (a: readonly HmiPreviewBounds[], b: readonly HmiPreviewBounds[]): boolean =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.id === b[i].id && x.x === b[i].x && x.y === b[i].y && x.width === b[i].width && x.height === b[i].height,
  )

export function usePreviewSession({
  request,
  screen,
  device,
  design,
  framePeriodMs,
  canvas,
}: Options): PreviewControls {
  const port = useHmiPreview()
  const session = useRef<HmiPreviewSession | null>(null)
  const requestRef = useRef(request)
  const builtRef = useRef<Built | null>(null)
  const generation = useRef(0)
  const frameBusy = useRef(false)
  const [built, setBuilt] = useState<Built | null>(null)
  const [state, setState] = useState<PreviewState>({
    status: port ? 'building' : 'unavailable',
    errors: [],
    buildMs: null,
    bounds: [],
    page: 0,
  })
  requestRef.current = request

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
    const started = performance.now()
    setState((s) => ({ ...s, status: 'building' }))
    void port.build(current).then(async (result) => {
      if (id !== generation.current) return
      if (!result.ok) {
        setState((s) => ({ ...s, status: builtRef.current ? 'ready' : 'failed', errors: result.errors }))
        return
      }
      const page = result.pages[screen] ?? 0
      try {
        await session.current?.load(result.wasm, { width: device.width, height: device.height, page, design })
      } catch (error) {
        if (id !== generation.current) return
        const message = error instanceof Error ? error.message : String(error)
        setState((s) => ({ ...s, status: 'failed', errors: [{ file: 'HMI', message }] }))
        return
      }
      if (id !== generation.current) return
      builtRef.current = result
      setBuilt(result)
      setState((s) => ({ ...s, status: 'ready', errors: [], buildMs: Math.round(performance.now() - started), page }))
    })
  }, [port, screen, device.width, device.height, design])

  useEffect(() => {
    rebuild()
  }, [rebuild])

  useEffect(() => {
    if (state.status !== 'ready') return
    const surface = {
      width: device.width * device.density,
      height: device.height * device.density,
      scale: device.density,
    }
    const target = canvas.current
    if (target && (target.width !== surface.width || target.height !== surface.height)) {
      target.width = surface.width
      target.height = surface.height
    }
    const started = performance.now()
    const tick = () => {
      const running = session.current
      if (!running || frameBusy.current) return
      frameBusy.current = true
      running
        .frame(Math.round(performance.now() - started), surface)
        .then((frame) => {
          const context = canvas.current?.getContext('2d')
          if (frame.pixels && context) {
            const { width, rows, y0, rgba } = frame.pixels
            context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, rows), 0, y0)
          }
          setState((s) =>
            sameBounds(s.bounds, frame.bounds) && s.page === frame.page
              ? s
              : { ...s, bounds: frame.bounds, page: frame.page },
          )
        })
        .catch(() => undefined)
        .finally(() => {
          frameBusy.current = false
        })
    }
    tick()
    const timer = setInterval(tick, framePeriodMs)
    return () => clearInterval(timer)
  }, [state.status, built, device.width, device.height, device.density, framePeriodMs, canvas])

  const pointer = useCallback((kind: HmiPointerKind, x: number, y: number) => {
    void session.current?.pointer(kind, x, y).catch(() => undefined)
  }, [])
  const key = useCallback((code: number) => {
    void session.current?.key(code).catch(() => undefined)
  }, [])

  const setLive = useCallback((screenName: string, element: string, property: string, value: string): boolean => {
    const current = builtRef.current
    const running = session.current
    if (!current || !running) return false
    const wanted = `${screenName}.${element}.${property}`.toUpperCase()
    const entry = Object.entries(current.setters).find(([k]) => k.toUpperCase() === wanted)
    const live = liveValue(value)
    if (!entry || !live) return false
    const [, setter] = entry
    if (setter.kind === 'num' && 'number' in live) {
      void running.setNumber(setter.screen, setter.index, live.number).catch(() => undefined)
      return true
    }
    if (setter.kind === 'str' && 'text' in live) {
      void running.setText(setter.screen, setter.index, live.text).catch(() => undefined)
      return true
    }
    return false
  }, [])

  return { ...state, built, rebuild, pointer, key, setLive }
}
