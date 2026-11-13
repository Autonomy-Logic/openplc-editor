/**
 * The device the screen is designed on: the running preview, and over it the hover, selection and drop marks. In
 * design mode the pointer selects and moves elements, drops widgets and variables, and resizes with the handles; in
 * run mode it operates the screen.
 */
import { cn } from '@root/frontend/utils/cn'
import type { HmiPointerKind, HmiWidgetCatalog } from '@root/middleware/shared/ports/hmi-preview-types'
import {
  type CanvasElement,
  type DropTarget,
  dropTarget,
  elementAt,
} from '@root/middleware/shared/utils/hmi/designer/designer-canvas'
import type { DesignerModel } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import type { HmiDevicePreset } from '@root/middleware/shared/utils/hmi/device-presets'
import { type RefObject, useRef, useState } from 'react'

import { VARIABLE_MIME, WIDGET_MIME } from './palette'

export type CanvasMode = 'design' | 'run'

export interface CanvasActions {
  select: (names: string[]) => void
  add: (type: string, target: DropTarget) => void
  move: (name: string, target: DropTarget) => void
  bindMain: (element: string, variable: string) => void
  /** Resizes live while dragging; commit is false until the pointer is released. */
  resize: (element: string, size: { width?: number; height?: number }, commit: boolean) => void
  pointer: (kind: HmiPointerKind, x: number, y: number) => void
}

const DRAG_THRESHOLD = 4
const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

type Gesture =
  | { kind: 'move'; name: string; startX: number; startY: number; moved: boolean }
  | {
      kind: 'resize'
      name: string
      edge: 'right' | 'bottom' | 'corner'
      startX: number
      startY: number
      width: number
      height: number
    }

export function DesignerCanvas(props: {
  canvas: RefObject<HTMLCanvasElement>
  device: HmiDevicePreset
  /** Screen pixels per logical unit. */
  zoom: number
  mode: CanvasMode
  model: DesignerModel | null
  catalog: HmiWidgetCatalog
  elements: readonly CanvasElement[]
  selection: readonly string[]
  locked: boolean
  actions: CanvasActions
}) {
  const overlay = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const { device, zoom, elements, model } = props
  const width = device.width * zoom
  const height = device.height * zoom

  const toLu = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = overlay.current?.getBoundingClientRect()
    return { x: (clientX - (rect?.left ?? 0)) / zoom, y: (clientY - (rect?.top ?? 0)) / zoom }
  }
  const boxOf = (name: string) => elements.find((e) => same(e.name, name))?.box
  const style = (name: string) => {
    const box = boxOf(name)
    return box ? { left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom } : null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toLu(e.clientX, e.clientY)
    if (props.mode === 'run') {
      e.currentTarget.setPointerCapture(e.pointerId)
      props.actions.pointer('down', p.x, p.y)
      return
    }
    const name = elementAt(elements, p.x, p.y)
    props.actions.select(name ? [name] : [])
    if (name && !props.locked) {
      e.currentTarget.setPointerCapture(e.pointerId)
      setGesture({ kind: 'move', name, startX: p.x, startY: p.y, moved: false })
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toLu(e.clientX, e.clientY)
    if (props.mode === 'run') {
      props.actions.pointer('move', p.x, p.y)
      return
    }
    if (!gesture) {
      setHover(elementAt(elements, p.x, p.y))
      return
    }
    if (gesture.kind === 'resize') {
      const w = gesture.edge === 'bottom' ? undefined : Math.max(1, Math.round(gesture.width + p.x - gesture.startX))
      const h = gesture.edge === 'right' ? undefined : Math.max(1, Math.round(gesture.height + p.y - gesture.startY))
      props.actions.resize(gesture.name, { width: w, height: h }, false)
      return
    }
    const moved = gesture.moved || Math.hypot(p.x - gesture.startX, p.y - gesture.startY) * zoom > DRAG_THRESHOLD
    if (moved && model) setDrop(dropTarget(model, props.catalog, elements, p.x, p.y, gesture.name))
    if (moved !== gesture.moved) setGesture({ ...gesture, moved })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toLu(e.clientX, e.clientY)
    if (props.mode === 'run') {
      props.actions.pointer('up', p.x, p.y)
      return
    }
    if (gesture?.kind === 'resize') {
      const w = gesture.edge === 'bottom' ? undefined : Math.max(1, Math.round(gesture.width + p.x - gesture.startX))
      const h = gesture.edge === 'right' ? undefined : Math.max(1, Math.round(gesture.height + p.y - gesture.startY))
      props.actions.resize(gesture.name, { width: w, height: h }, true)
    } else if (gesture?.kind === 'move' && gesture.moved && drop) {
      props.actions.move(gesture.name, drop)
    }
    setGesture(null)
    setDrop(null)
  }

  const startResize = (edge: 'right' | 'bottom' | 'corner') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const name = props.selection[0]
    const box = name ? boxOf(name) : undefined
    if (!name || !box || props.locked) return
    overlay.current?.setPointerCapture(e.pointerId)
    const p = toLu(e.clientX, e.clientY)
    setGesture({ kind: 'resize', name, edge, startX: p.x, startY: p.y, width: box.width, height: box.height })
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (props.mode !== 'design' || props.locked || !model) return
    const types = e.dataTransfer.types
    if (!types.includes(WIDGET_MIME) && !types.includes(VARIABLE_MIME)) return
    e.preventDefault()
    const p = toLu(e.clientX, e.clientY)
    if (types.includes(WIDGET_MIME)) setDrop(dropTarget(model, props.catalog, elements, p.x, p.y))
    else setHover(elementAt(elements, p.x, p.y))
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!model) return
    e.preventDefault()
    const p = toLu(e.clientX, e.clientY)
    const widget = e.dataTransfer.getData(WIDGET_MIME)
    const variable = e.dataTransfer.getData(VARIABLE_MIME)
    if (widget) props.actions.add(widget, dropTarget(model, props.catalog, elements, p.x, p.y))
    else if (variable) {
      const target = elementAt(elements, p.x, p.y)
      if (target) props.actions.bindMain(target, variable)
    }
    setDrop(null)
    setHover(null)
  }

  const selected = props.mode === 'design' ? props.selection[0] : undefined
  const selectedStyle = selected ? style(selected) : null
  const dropStyle = drop?.parent ? style(drop.parent) : null
  const beforeStyle = drop?.before ? style(drop.before) : null
  return (
    <div className='relative shrink-0 shadow-md' style={{ width, height }} data-testid='hmi-canvas'>
      <canvas ref={props.canvas} className='absolute inset-0 h-full w-full' style={{ imageRendering: 'auto' }} />
      <div
        ref={overlay}
        className={cn('absolute inset-0', props.mode === 'design' ? 'cursor-default' : 'cursor-pointer')}
        data-testid='hmi-canvas-overlay'
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDragOver={onDragOver}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
      >
        {props.mode === 'design' && hover && hover !== selected && style(hover) && (
          <div
            className='border-brand/70 pointer-events-none absolute border border-dashed'
            style={style(hover) ?? undefined}
          />
        )}
        {dropStyle && (
          <div className='border-brand/60 bg-brand/5 pointer-events-none absolute border-2' style={dropStyle} />
        )}
        {beforeStyle && (
          <div
            className='pointer-events-none absolute bg-brand'
            style={{
              left: beforeStyle.left,
              top: beforeStyle.top - 2,
              width: Math.max(beforeStyle.width, 4),
              height: 3,
            }}
          />
        )}
        {selectedStyle && (
          <div
            className='pointer-events-none absolute border-2 border-brand'
            style={selectedStyle}
            data-testid={`hmi-selected-${selected}`}
          >
            {!props.locked && (
              <>
                <div
                  className='pointer-events-auto absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-ew-resize rounded-sm border border-brand bg-white'
                  data-testid='hmi-grow-right'
                  onPointerDown={startResize('right')}
                />
                <div
                  className='pointer-events-auto absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 cursor-ns-resize rounded-sm border border-brand bg-white'
                  data-testid='hmi-grow-bottom'
                  onPointerDown={startResize('bottom')}
                />
                <div
                  className='pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-brand bg-white'
                  data-testid='hmi-grow-corner'
                  onPointerDown={startResize('corner')}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
