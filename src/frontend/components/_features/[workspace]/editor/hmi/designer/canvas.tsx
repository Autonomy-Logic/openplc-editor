/**
 * The device the screen is designed on: the running preview, and over it the hover, selection and drop marks. In
 * design mode the pointer selects and moves elements, drops widgets and variables, and resizes with the handles; in a
 * diagram it places symbols on the grid, draws pipes from port to port and edits their bends. In run mode it operates
 * the screen.
 */
import { cn } from '@root/frontend/utils/cn'
import type { HmiPointerKind, HmiWidgetCatalog } from '@root/middleware/shared/ports/hmi-preview-types'
import {
  type CanvasElement,
  type DropTarget,
  dropTarget,
  elementAt,
  widgetIsA,
} from '@root/middleware/shared/utils/hmi/designer/designer-canvas'
import {
  bendsOf,
  type CanvasPort,
  type DesignRecords,
  type DiagramFrame,
  diagramOf,
  gridOf,
  insertBend,
  numberProp,
  type Point,
  portAt,
  snap,
  toCanvas,
  toDesign,
} from '@root/middleware/shared/utils/hmi/designer/designer-diagram'
import type { DesignerModel } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import type { HmiDevicePreset } from '@root/middleware/shared/utils/hmi/device-presets'
import { type RefObject, useRef, useState } from 'react'

import { VARIABLE_MIME, WIDGET_MIME } from './palette'

export type CanvasMode = 'design' | 'run'

export interface CanvasActions {
  select: (names: string[]) => void
  /** Adds a widget; `at` places it in a diagram, in design units. */
  add: (type: string, target: DropTarget, at?: Point) => void
  move: (name: string, target: DropTarget) => void
  bindMain: (element: string, variable: string) => void
  /** Resizes live while dragging; commit is false until the pointer is released. */
  resize: (element: string, size: { width?: number; height?: number }, commit: boolean) => void
  /** Places a diagram symbol, in design units; live while dragging, committed on release. */
  place: (element: string, at: Point, commit: boolean) => void
  /** Adds a pipe between two ports of a diagram's symbols. */
  connect: (diagram: string, from: CanvasPort, to: CanvasPort) => void
  /** Sets a pipe's bends, in design units; live while dragging, committed on release. */
  bends: (pipe: string, bends: Point[], commit: boolean) => void
  pointer: (kind: HmiPointerKind, x: number, y: number) => void
  /** An edit was tried while the screen is in preview mode. */
  blocked: () => void
}

const DRAG_THRESHOLD = 4
/** Screen pixels within which a port or a bend is under the pointer. */
const HANDLE_RADIUS = 7
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
  | {
      kind: 'place'
      name: string
      frame: DiagramFrame
      grid: number
      startX: number
      startY: number
      origin: Point
      at: Point
      moved: boolean
    }
  | { kind: 'wire'; diagram: string; from: CanvasPort; to: Point }
  | { kind: 'bend'; pipe: string; index: number; frame: DiagramFrame; grid: number; bends: Point[] }

export function DesignerCanvas(props: {
  canvas: RefObject<HTMLCanvasElement>
  device: HmiDevicePreset
  /** Screen pixels per logical unit. */
  zoom: number
  mode: CanvasMode
  model: DesignerModel | null
  catalog: HmiWidgetCatalog
  elements: readonly CanvasElement[]
  records: DesignRecords
  selection: readonly string[]
  locked: boolean
  actions: CanvasActions
}) {
  const overlay = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const { device, zoom, elements, model, catalog, records } = props
  const width = device.width * zoom
  const height = device.height * zoom
  const handle = HANDLE_RADIUS / zoom

  const toLu = (clientX: number, clientY: number): Point => {
    const rect = overlay.current?.getBoundingClientRect()
    return { x: (clientX - (rect?.left ?? 0)) / zoom, y: (clientY - (rect?.top ?? 0)) / zoom }
  }
  const boxOf = (name: string) => elements.find((e) => same(e.name, name))?.box
  const style = (name: string) => {
    const box = boxOf(name)
    return box ? { left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom } : null
  }
  const elementOf = (name: string) => model?.elements.find((e) => same(e.name, name))
  const isPipe = (name: string): boolean => {
    const type = elementOf(name)?.type
    return type !== undefined && widgetIsA(catalog, type, 'HmiPipe')
  }
  const diagramFrame = (name: string) => {
    const diagram = model ? diagramOf(model, catalog, name) : null
    const frame = diagram ? records.frames.get(diagram.name.toUpperCase()) : undefined
    return diagram && frame ? { diagram, frame } : null
  }
  const selectedPipe = (() => {
    const name = props.mode === 'design' ? props.selection[0] : undefined
    const pipe = name ? elementOf(name) : undefined
    if (!model || !pipe || !widgetIsA(catalog, pipe.type, 'HmiPipe')) return null
    const placed = diagramFrame(pipe.name)
    return placed ? { pipe, ...placed, bends: bendsOf(pipe) } : null
  })()
  const portsOf = (element: string) => records.ports.filter((p) => same(p.element, element))
  const bendAt = (p: Point): number =>
    selectedPipe
      ? selectedPipe.bends.findIndex((b) => {
          const c = toCanvas(selectedPipe.frame, b)
          return Math.hypot(c.x - p.x, c.y - p.y) <= handle
        })
      : -1

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toLu(e.clientX, e.clientY)
    if (props.mode === 'run') {
      e.currentTarget.setPointerCapture(e.pointerId)
      props.actions.pointer('down', p.x, p.y)
      return
    }
    if (!props.locked && model) {
      const port = portAt(records.ports, p, handle, (q) => diagramFrame(q.element) !== null)
      const placed = port ? diagramFrame(port.element) : null
      if (port && placed) {
        e.currentTarget.setPointerCapture(e.pointerId)
        setGesture({ kind: 'wire', diagram: placed.diagram.name, from: port, to: p })
        return
      }
      const bend = bendAt(p)
      if (selectedPipe && bend >= 0) {
        e.currentTarget.setPointerCapture(e.pointerId)
        setGesture({
          kind: 'bend',
          pipe: selectedPipe.pipe.name,
          index: bend,
          frame: selectedPipe.frame,
          grid: gridOf(catalog, selectedPipe.diagram),
          bends: selectedPipe.bends,
        })
        return
      }
    }
    const name = elementAt(elements, p.x, p.y)
    props.actions.select(name ? [name] : [])
    if (!name || props.locked) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const placed = isPipe(name) ? null : diagramFrame(name)
    const element = elementOf(name)
    if (placed && element) {
      const origin = { x: numberProp(catalog, element, 'X', 0), y: numberProp(catalog, element, 'Y', 0) }
      setGesture({
        kind: 'place',
        name,
        frame: placed.frame,
        grid: gridOf(catalog, placed.diagram),
        startX: p.x,
        startY: p.y,
        origin,
        at: origin,
        moved: false,
      })
      return
    }
    setGesture({ kind: 'move', name, startX: p.x, startY: p.y, moved: false })
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
    switch (gesture.kind) {
      case 'resize': {
        const w = gesture.edge === 'bottom' ? undefined : Math.max(1, Math.round(gesture.width + p.x - gesture.startX))
        const h = gesture.edge === 'right' ? undefined : Math.max(1, Math.round(gesture.height + p.y - gesture.startY))
        props.actions.resize(gesture.name, { width: w, height: h }, false)
        return
      }
      case 'place': {
        const moved = gesture.moved || Math.hypot(p.x - gesture.startX, p.y - gesture.startY) * zoom > DRAG_THRESHOLD
        if (!moved) return
        const at = {
          x: snap(gesture.origin.x + (p.x - gesture.startX) / gesture.frame.scale, gesture.grid),
          y: snap(gesture.origin.y + (p.y - gesture.startY) / gesture.frame.scale, gesture.grid),
        }
        if (at.x !== gesture.at.x || at.y !== gesture.at.y) props.actions.place(gesture.name, at, false)
        setGesture({ ...gesture, at, moved })
        return
      }
      case 'wire':
        setGesture({ ...gesture, to: p })
        return
      case 'bend': {
        const d = toDesign(gesture.frame, p)
        const bends = gesture.bends.map((b, i) =>
          i === gesture.index ? { x: snap(d.x, gesture.grid), y: snap(d.y, gesture.grid) } : b,
        )
        const moved = bends[gesture.index]
        const before = gesture.bends[gesture.index]
        if (moved.x === before.x && moved.y === before.y) return
        props.actions.bends(gesture.pipe, bends, false)
        setGesture({ ...gesture, bends })
        return
      }
      case 'move': {
        const moved = gesture.moved || Math.hypot(p.x - gesture.startX, p.y - gesture.startY) * zoom > DRAG_THRESHOLD
        if (moved && model) setDrop(dropTarget(model, catalog, elements, p.x, p.y, gesture.name))
        if (moved !== gesture.moved) setGesture({ ...gesture, moved })
        return
      }
      default: {
        const unhandled: never = gesture
        return unhandled
      }
    }
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
    } else if (gesture?.kind === 'place' && gesture.moved) {
      props.actions.place(gesture.name, gesture.at, true)
    } else if (gesture?.kind === 'bend') {
      props.actions.bends(gesture.pipe, gesture.bends, true)
    } else if (gesture?.kind === 'wire') {
      const target = portAt(
        records.ports,
        p,
        handle,
        (q) => !same(q.element, gesture.from.element) && diagramFrame(q.element)?.diagram.name === gesture.diagram,
      )
      if (target) props.actions.connect(gesture.diagram, gesture.from, target)
    }
    setGesture(null)
    setDrop(null)
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (props.mode !== 'design' || props.locked || !selectedPipe) return
    const p = toLu(e.clientX, e.clientY)
    const bend = bendAt(p)
    if (bend >= 0) {
      props.actions.bends(
        selectedPipe.pipe.name,
        selectedPipe.bends.filter((_, i) => i !== bend),
        true,
      )
      return
    }
    const route = (records.routes.get(selectedPipe.pipe.name.toUpperCase()) ?? []).map((q) =>
      toDesign(selectedPipe.frame, q),
    )
    const d = toDesign(selectedPipe.frame, p)
    const grid = gridOf(catalog, selectedPipe.diagram)
    props.actions.bends(
      selectedPipe.pipe.name,
      insertBend(selectedPipe.bends, route, { x: snap(d.x, grid), y: snap(d.y, grid) }),
      true,
    )
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
    if (props.mode === 'run') {
      props.actions.blocked()
      return
    }
    if (props.locked || !model) return
    const types = e.dataTransfer.types
    if (!types.includes(WIDGET_MIME) && !types.includes(VARIABLE_MIME)) return
    e.preventDefault()
    const p = toLu(e.clientX, e.clientY)
    if (types.includes(WIDGET_MIME)) setDrop(dropTarget(model, catalog, elements, p.x, p.y))
    else setHover(elementAt(elements, p.x, p.y))
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!model || props.mode === 'run') return
    e.preventDefault()
    const p = toLu(e.clientX, e.clientY)
    const widget = e.dataTransfer.getData(WIDGET_MIME)
    const variable = e.dataTransfer.getData(VARIABLE_MIME)
    if (widget) {
      const target = dropTarget(model, catalog, elements, p.x, p.y)
      const container = target.parent ? elementOf(target.parent) : undefined
      const frame = container ? records.frames.get(container.name.toUpperCase()) : undefined
      if (container && frame && widgetIsA(catalog, container.type, 'HmiDiagram')) {
        const d = toDesign(frame, p)
        const grid = gridOf(catalog, container)
        props.actions.add(widget, { parent: container.name, before: null }, { x: snap(d.x, grid), y: snap(d.y, grid) })
      } else props.actions.add(widget, target)
    } else if (variable) {
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
  const shownPorts =
    props.mode !== 'design' || props.locked
      ? []
      : gesture?.kind === 'wire'
        ? records.ports.filter((q) => diagramFrame(q.element)?.diagram.name === gesture.diagram)
        : [hover, selected].flatMap((name) => (name && !isPipe(name) && diagramFrame(name) ? portsOf(name) : []))
  const wireTarget =
    gesture?.kind === 'wire'
      ? portAt(records.ports, gesture.to, handle, (q) => !same(q.element, gesture.from.element))
      : null
  return (
    <div
      className='relative shrink-0 rounded-lg shadow-[0_6px_24px_rgba(1,30,75,0.14)]'
      style={{ width, height }}
      data-testid='hmi-canvas'
    >
      <canvas
        ref={props.canvas}
        className='absolute inset-0 h-full w-full rounded-lg'
        style={{ imageRendering: 'auto' }}
      />
      <div
        ref={overlay}
        className={cn('absolute inset-0', props.mode === 'design' ? 'cursor-default' : 'cursor-pointer')}
        data-testid='hmi-canvas-overlay'
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
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
            <span className='absolute -top-[21px] left-[-2px] whitespace-nowrap rounded-t bg-brand px-1.5 py-0.5 font-caption text-[11px] font-semibold text-white'>
              {selected}
            </span>
            {!props.locked && !selectedPipe && (
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
        {shownPorts.map((q) => (
          <div
            key={`${q.element}:${q.port}`}
            className={cn(
              'pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand',
              wireTarget && same(wireTarget.element, q.element) && wireTarget.port === q.port ? 'bg-brand' : 'bg-white',
            )}
            style={{ left: q.x * zoom, top: q.y * zoom }}
            data-testid={`hmi-port-${q.element}-${q.port}`}
          />
        ))}
        {selectedPipe?.bends.map((b, i) => {
          const c = toCanvas(selectedPipe.frame, gesture?.kind === 'bend' ? (gesture.bends[i] ?? b) : b)
          return (
            <div
              key={i}
              className='pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-brand bg-white'
              style={{ left: c.x * zoom, top: c.y * zoom }}
              data-testid={`hmi-bend-${i}`}
            />
          )
        })}
        {gesture?.kind === 'wire' && (
          <svg className='pointer-events-none absolute inset-0' width={width} height={height}>
            <line
              x1={gesture.from.x * zoom}
              y1={gesture.from.y * zoom}
              x2={(wireTarget ?? gesture.to).x * zoom}
              y2={(wireTarget ?? gesture.to).y * zoom}
              className='stroke-brand'
              strokeWidth={2}
              strokeDasharray='4 3'
            />
          </svg>
        )}
      </div>
    </div>
  )
}
