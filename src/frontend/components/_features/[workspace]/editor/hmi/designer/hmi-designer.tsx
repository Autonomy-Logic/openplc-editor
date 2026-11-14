/**
 * The HMI designer: a screen's tab with the palette, the canvas on a device preset, the outline and the inspector, or
 * its code; and a widget block's tab with its code beside its preview. Every edit goes through the designer's text
 * patches and the store's history, so the code view and the designer edit one file and undo covers both.
 */
import { ViewModeToggle } from '@root/frontend/components/_atoms/view-mode-toggle'
import { useOpenPLCStore } from '@root/frontend/store'
import { hmiDesignerEntry } from '@root/frontend/store/slices/hmi-designer'
import { toast } from '@root/frontend/utils/toast'
import type {
  HmiCatalogResult,
  HmiDiagnostic,
  HmiPreviewRequest,
  HmiThumbnail,
  HmiWidgetCatalog,
} from '@root/middleware/shared/ports/hmi-preview-types'
import { useHmiPreview } from '@root/middleware/shared/providers'
import {
  canvasElements,
  type DropTarget,
  isContainerType,
} from '@root/middleware/shared/utils/hmi/designer/designer-canvas'
import {
  copyElements,
  type DesignerClipboard,
  parseDesignerClipboard,
  pasteElements,
} from '@root/middleware/shared/utils/hmi/designer/designer-clipboard'
import {
  designRecords,
  formatPath,
  pipeProps,
  withTheirPipes,
} from '@root/middleware/shared/utils/hmi/designer/designer-diagram'
import {
  addElement,
  deleteElements,
  type DesignerEdit,
  moveElement,
  removeProperty,
  renameElement,
  setBinding,
  setEvent,
  setProperties,
  setProperty,
  stString,
} from '@root/middleware/shared/utils/hmi/designer/designer-edits'
import { type DesignerModel, parseDesignerBlock } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { HMI_DEVICE_PRESETS, hmiDevicePreset } from '@root/middleware/shared/utils/hmi/device-presets'
import { hmiPlcVariables } from '@root/middleware/shared/utils/hmi/plc-variables'
import { defaultHmiSettings } from '@root/middleware/shared/utils/hmi/settings'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { HmiCodeEditor } from '../code-editor'
import { type CanvasActions, type CanvasMode, DesignerCanvas } from './canvas'
import { Inspector, type InspectorActions } from './inspector'
import { Outline } from './outline'
import { Palette } from './palette'
import { DesignerSelect, ToolButton } from './parts'
import { usePreviewSession } from './use-preview-session'

const EMPTY_CATALOG: HmiWidgetCatalog = { widgets: new Map(), colors: [] }
const REBUILD_DELAY_MS = 300
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

/** In-app copy of the last copied elements, for when the system clipboard cannot be read. */
let lastCopied: DesignerClipboard | null = null

/** Elements on the system clipboard; null when it holds anything else or cannot be read. */
async function readClipboard(): Promise<DesignerClipboard | null> {
  try {
    const text = await navigator.clipboard?.readText()
    return text ? parseDesignerClipboard(JSON.parse(text)) : null
  } catch {
    return null
  }
}

/** What every preview request carries: the project's HMI and what screens may refer to. */
function useProjectRequest(): Omit<HmiPreviewRequest, 'widgetPreview'> {
  const hmi = useOpenPLCStore((s) => s.project.data.hmi)
  const pous = useOpenPLCStore((s) => s.project.data.pous)
  const dataTypes = useOpenPLCStore((s) => s.project.data.dataTypes)
  const configurations = useOpenPLCStore((s) => s.project.data.configurations)
  const plcVariables = useMemo(() => hmiPlcVariables({ pous, configurations }), [pous, configurations])
  const projectNames = useMemo(() => [...pous.map((p) => p.name), ...dataTypes.map((d) => d.name)], [pous, dataTypes])
  return useMemo(
    () => ({
      screens: hmi?.screens ?? [],
      widgets: hmi?.widgets ?? [],
      settings: hmi?.settings ?? defaultHmiSettings(),
      plcVariables,
      projectNames,
    }),
    [hmi, plcVariables, projectNames],
  )
}

/** The project's widget catalogue; the last good one stays while widget blocks do not compile. */
function useCatalog(widgets: HmiPreviewRequest['widgets']): HmiCatalogResult {
  const port = useHmiPreview()
  const [result, setResult] = useState<HmiCatalogResult>({ catalog: EMPTY_CATALOG, errors: [] })
  useEffect(() => {
    if (!port) return
    let live = true
    void port.catalog(widgets).then((next) => {
      if (!live) return
      setResult((previous) =>
        next.errors.length > 0 && previous.catalog.widgets.size > next.catalog.widgets.size
          ? { catalog: previous.catalog, errors: next.errors }
          : next,
      )
    })
    return () => {
      live = false
    }
  }, [port, widgets])
  return result
}

const THUMBNAIL_SCALE = 2
const THUMBNAIL_DELAY_MS = 800

function thumbnailUrl(thumbnail: HmiThumbnail): string {
  const canvas = document.createElement('canvas')
  canvas.width = thumbnail.width
  canvas.height = thumbnail.height
  canvas.getContext('2d')?.putImageData(new ImageData(thumbnail.rgba, thumbnail.width, thumbnail.height), 0, 0)
  return canvas.toDataURL()
}

/** The palette's thumbnails as image URLs by upper-case widget name, redrawn a moment after the widget blocks change. */
function useThumbnails(request: HmiPreviewRequest): ReadonlyMap<string, string> {
  const port = useHmiPreview()
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(new Map())
  const { widgets, settings, projectNames } = request
  useEffect(() => {
    if (!port) return
    let live = true
    const timer = setTimeout(() => {
      void port.thumbnails({ widgets, settings, projectNames }, THUMBNAIL_SCALE).then((result) => {
        if (live && result.thumbnails.length > 0)
          setThumbnails(new Map(result.thumbnails.map((t) => [t.widget.toUpperCase(), thumbnailUrl(t)])))
      })
    }, THUMBNAIL_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [port, widgets, settings, projectNames])
  return thumbnails
}

/**
 * Zoom that fits a device into the area around the canvas, and the ref that names that area. A hidden or unmounted
 * area keeps the last zoom.
 */
function useFitZoom(width: number, height: number): [number, (element: HTMLDivElement | null) => void] {
  const [fit, setFit] = useState(1)
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!area) return
    const measure = () => {
      const pad = 48
      if (area.clientWidth <= pad || area.clientHeight <= pad) return
      setFit(Math.max(0.1, Math.min((area.clientWidth - pad) / width, (area.clientHeight - pad) / height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [area, width, height])
  return [fit, setArea]
}

function Diagnostics(props: { errors: readonly HmiDiagnostic[] }) {
  if (props.errors.length === 0) return null
  return (
    <ul
      className='max-h-28 overflow-y-auto border-t border-red-200 bg-red-50 px-3 py-1 dark:border-red-900 dark:bg-red-950'
      data-testid='hmi-errors'
    >
      {props.errors.map((e, i) => (
        <li key={i} className='font-caption text-xs text-red-700 dark:text-red-300'>
          {e.file}
          {e.line !== undefined ? `:${e.line}` : ''}: {e.message}
        </li>
      ))}
    </ul>
  )
}

function statusText(status: string, buildMs: number | null): string {
  if (status === 'building') return 'Building preview…'
  if (status === 'ready') return buildMs === null ? 'Preview ready' : `Preview ready (${(buildMs / 1000).toFixed(1)} s)`
  if (status === 'failed') return 'The preview did not build'
  if (status === 'stopped') return 'The preview stopped'
  return 'Preview unavailable'
}

export function HmiScreenDesigner({ name }: { name: string }) {
  const kind = 'screen'
  const source = useOpenPLCStore((s) => s.project.data.hmi?.screens.find((f) => same(f.name, name))?.source ?? '')
  const entry = useOpenPLCStore((s) => hmiDesignerEntry(s, kind, name))
  const actions = useOpenPLCStore((s) => s.hmiDesignerActions)
  const debugging = useOpenPLCStore((s) => s.workspace.isDebuggerVisible)
  const request = useProjectRequest()
  const { catalog, errors: catalogErrors } = useCatalog(request.widgets)
  const thumbnails = useThumbnails(request)
  const isWidget = useCallback((type: string) => catalog.widgets.has(type.toUpperCase()), [catalog])

  const parsed = useMemo(() => parseDesignerBlock(source, isWidget), [source, isWidget])
  const fallback = useMemo(
    () => (!parsed.ok && entry.lastValidSource ? parseDesignerBlock(entry.lastValidSource, isWidget) : null),
    [parsed.ok, entry.lastValidSource, isWidget],
  )
  const model: DesignerModel | null = parsed.ok ? parsed.model : fallback?.ok ? fallback.model : null
  useEffect(() => {
    if (parsed.ok && entry.lastValidSource !== source) actions.setLastValidSource(kind, name, source)
  }, [parsed.ok, source, entry.lastValidSource, actions, name])
  const locked = !parsed.ok || debugging

  const device = hmiDevicePreset(entry.device)
  const [mode, setMode] = useState<CanvasMode>('design')
  const canvas = useRef<HTMLCanvasElement>(null)
  const [fit, area] = useFitZoom(device.width, device.height)
  const zoom = entry.zoom ?? fit
  const preview = usePreviewSession({
    request,
    screen: name,
    device,
    design: mode === 'design',
    framePeriodMs: request.settings.framePeriodMs,
    canvas,
  })
  const elements = useMemo(
    () => (model && preview.built ? canvasElements(preview.bounds, preview.built.elementIds, name, model) : []),
    [model, preview.built, preview.bounds, name],
  )
  const records = useMemo(
    () => designRecords(preview.bounds, preview.built?.elementIds ?? [], name),
    [preview.built, preview.bounds, name],
  )

  const rebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRebuild = useCallback(() => {
    if (rebuildTimer.current) clearTimeout(rebuildTimer.current)
    rebuildTimer.current = setTimeout(preview.rebuild, REBUILD_DELAY_MS)
  }, [preview.rebuild])
  useEffect(() => () => void (rebuildTimer.current && clearTimeout(rebuildTimer.current)), [])

  const apply = useCallback(
    (result: DesignerEdit, options: { rebuild: boolean; merge?: string } = { rebuild: true }): boolean => {
      if (!result.ok) {
        toast({ title: 'Not changed', description: result.message, variant: 'fail' })
        return false
      }
      actions.applySource(kind, name, result.source, options.merge ? { key: options.merge, at: Date.now() } : undefined)
      if (options.rebuild) scheduleRebuild()
      return true
    },
    [actions, name, scheduleRebuild],
  )

  const select = useCallback((names: string[]) => actions.select(kind, name, names), [actions, name])
  const selected = model?.elements.find((e) => entry.selection.some((s) => same(s, e.name))) ?? null

  const inspectorActions: InspectorActions = {
    setProperty: (element, property, value) => {
      if (!model) return
      if (value === null) {
        apply(removeProperty(source, model, element, property))
        return
      }
      const live = preview.setLive(name, element, property, value)
      apply(setProperty(source, model, element, property, value), { rebuild: !live, merge: `${element}.${property}` })
    },
    bind: (element, property, variable) => model && apply(setBinding(source, model, element, property, variable)),
    setEvent: (element, event, code) => model && apply(setEvent(source, model, element, event, code)),
    rename: (element, newName) => {
      if (!model || newName === element) return
      const refers = (type: string, property: string) =>
        catalog.widgets
          .get(type.toUpperCase())
          ?.properties.some((p) => same(p.name, property) && p.kind === 'elementRef') ?? false
      if (apply(renameElement(source, model, element, newName, { refersToElement: refers }))) select([newName])
    },
    remove: (element) => {
      if (model && apply(deleteElements(source, model, withTheirPipes(model, catalog, [element])))) select([])
    },
  }

  const setLiveAndCommit = (element: string, entries: Array<[string, string]>, commit: boolean) => {
    if (!model) return
    const live = entries.map(([property, value]) => preview.setLive(name, element, property, value)).every(Boolean)
    if (commit) apply(setProperties(source, model, element, entries, isWidget), { rebuild: !live })
  }

  const canvasActions: CanvasActions = {
    select,
    add: (type, target: DropTarget, at) => {
      if (!model) return
      const props: Array<[string, string]> = at
        ? [
            ['X', String(at.x)],
            ['Y', String(at.y)],
          ]
        : []
      const result = addElement(source, model, { type, parent: target.parent, before: target.before, props })
      if (apply(result) && result.ok && result.name) select([result.name])
    },
    move: (element, target) => model && apply(moveElement(source, model, element, target.parent, target.before)),
    bindMain: (element, variable) => {
      const type = model?.elements.find((e) => same(e.name, element))?.type
      const main = type ? catalog.widgets.get(type.toUpperCase())?.main : undefined
      if (!model || !main) {
        toast({ title: 'Not wired', description: `${element} has no input a variable can show`, variant: 'warn' })
        return
      }
      apply(setBinding(source, model, element, main.name, variable))
    },
    resize: (element, size, commit) => {
      if (!model) return
      const entries: Array<[string, string]> = []
      if (size.width !== undefined) entries.push(['PrefWidth', String(size.width)])
      if (size.height !== undefined) entries.push(['PrefHeight', String(size.height)])
      setLiveAndCommit(element, entries, commit)
    },
    place: (element, at, commit) =>
      setLiveAndCommit(
        element,
        [
          ['X', String(at.x)],
          ['Y', String(at.y)],
        ],
        commit,
      ),
    connect: (diagram, from, to) => {
      if (!model) return
      const result = addElement(source, model, { type: 'HmiPipe', parent: diagram, props: pipeProps(from, to) })
      if (apply(result) && result.ok && result.name) select([result.name])
    },
    bends: (pipe, bends, commit) => {
      if (!model) return
      const path = stString(formatPath(bends))
      const live = preview.setLive(name, pipe, 'Path', path)
      if (!commit) return
      if (bends.length === 0) apply(removeProperty(source, model, pipe, 'Path'), { rebuild: !live })
      else apply(setProperty(source, model, pipe, 'Path', path), { rebuild: !live })
    },
    pointer: preview.pointer,
  }

  const addFromPalette = (type: string) => {
    if (!model) return
    const parent = selected && isContainerType(catalog, selected.type) ? selected.name : (selected?.parent ?? null)
    canvasActions.add(type, { parent, before: null })
  }

  const shift = (element: string, step: -1 | 1) => {
    if (!model) return
    const target = model.elements.find((e) => same(e.name, element))
    if (!target) return
    const siblings = model.elements.filter(
      (e) => (e.parent ?? '').toUpperCase() === (target.parent ?? '').toUpperCase(),
    )
    const index = siblings.findIndex((e) => same(e.name, element))
    const before = step < 0 ? siblings[index - 1]?.name : siblings[index + 2]?.name
    if (step < 0 && index === 0) return
    if (step > 0 && index === siblings.length - 1) return
    apply(moveElement(source, model, element, target.parent, before ?? null))
  }

  const copy = async (): Promise<DesignerClipboard | null> => {
    if (!model || entry.selection.length === 0) return null
    const clip = copyElements(model, entry.selection)
    if (!clip) return null
    lastCopied = clip
    await navigator.clipboard?.writeText(JSON.stringify(clip)).catch(() => undefined)
    return clip
  }
  const paste = async () => {
    if (!model) return
    const clip = (await readClipboard()) ?? lastCopied
    if (!clip) return
    const parent = selected && isContainerType(catalog, selected.type) ? selected.name : (selected?.parent ?? null)
    const result = pasteElements(source, model, clip, parent, null)
    if (apply(result) && result.ok && result.names) select(result.names.slice(0, 1))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    const command = e.metaKey || e.ctrlKey
    if (command && e.key === 'Enter') {
      e.preventDefault()
      preview.rebuild()
      return
    }
    if (mode === 'run') {
      if (e.key.length === 1) preview.key(e.key.charCodeAt(0))
      else if (e.key === 'Enter') preview.key(13)
      else if (e.key === 'Backspace') preview.key(8)
      else if (e.key === 'Escape') preview.key(27)
      return
    }
    if (locked || !model) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && entry.selection.length > 0) {
      e.preventDefault()
      if (apply(deleteElements(source, model, withTheirPipes(model, catalog, entry.selection)))) select([])
    } else if (command && e.key.toLowerCase() === 'c') {
      void copy()
    } else if (command && e.key.toLowerCase() === 'x') {
      void copy().then(
        (clip) =>
          clip && apply(deleteElements(source, model, withTheirPipes(model, catalog, entry.selection))) && select([]),
      )
    } else if (command && e.key.toLowerCase() === 'v') {
      void paste()
    }
  }

  const screens = request.screens.map((s) => s.name)
  const errors = [
    ...(parsed.ok ? [] : parsed.errors.map((e) => ({ file: name, line: e.line, message: e.message }))),
    ...catalogErrors,
    ...preview.errors,
  ]

  return (
    <div className='flex h-full w-full flex-col overflow-hidden' data-testid='hmi-designer' onKeyDown={onKeyDown}>
      <div className='flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-2 dark:border-neutral-850'>
        <ViewModeToggle
          display={entry.view === 'design' ? 'table' : 'code'}
          onDisplayChange={(d) => actions.setView(kind, name, d === 'table' ? 'design' : 'code')}
          containerLabel='Screen view'
          tableLabel='Designer'
          codeLabel='Code'
        />
        <div className='w-40'>
          <DesignerSelect
            value={device.id}
            testId='hmi-device'
            options={HMI_DEVICE_PRESETS.map((d) => ({ value: d.id, label: `${d.label} (${d.width}×${d.height})` }))}
            onChange={(id) => actions.setDevice(kind, name, id)}
          />
        </div>
        <ToolButton
          label='Zoom out'
          onClick={() =>
            actions.setZoom(kind, name, [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.01) ?? ZOOM_STEPS[0])
          }
        >
          −
        </ToolButton>
        <span
          className='w-12 text-center font-caption text-xs text-neutral-600 dark:text-neutral-400'
          data-testid='hmi-zoom'
        >
          {Math.round(zoom * 100)}%
        </span>
        <ToolButton
          label='Zoom in'
          onClick={() => actions.setZoom(kind, name, ZOOM_STEPS.find((z) => z > zoom + 0.01) ?? ZOOM_STEPS.at(-1) ?? 3)}
        >
          +
        </ToolButton>
        <ToolButton label='Fit' active={entry.zoom === null} onClick={() => actions.setZoom(kind, name, null)}>
          Fit
        </ToolButton>
        <div className='mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-850' />
        <ToolButton
          label='Design'
          testId='hmi-mode-design'
          active={mode === 'design'}
          onClick={() => setMode('design')}
        >
          Design
        </ToolButton>
        <ToolButton label='Try it' testId='hmi-mode-run' active={mode === 'run'} onClick={() => setMode('run')}>
          Try
        </ToolButton>
        <div className='flex-1' />
        <span className='truncate font-caption text-xs text-neutral-600 dark:text-neutral-400' data-testid='hmi-status'>
          {statusText(preview.status, preview.buildMs)}
        </span>
        <ToolButton label='Preview (Ctrl/Cmd+Enter)' testId='hmi-preview-button' onClick={preview.rebuild}>
          Preview
        </ToolButton>
      </div>
      {entry.view === 'code' ? (
        <div className='min-h-0 flex-1'>
          <HmiCodeEditor name={name} kind={kind} onPreview={preview.rebuild} />
        </div>
      ) : (
        <div className='flex min-h-0 flex-1'>
          <aside className='w-56 shrink-0 border-r border-neutral-200 dark:border-neutral-850'>
            <Palette
              catalog={catalog}
              projectWidgets={new Set(request.widgets.map((w) => w.name.toUpperCase()))}
              variables={request.plcVariables}
              thumbnails={thumbnails}
              onAdd={addFromPalette}
              disabled={locked}
            />
          </aside>
          <div
            ref={area}
            className='flex min-w-0 flex-1 items-center justify-center overflow-auto bg-neutral-100 dark:bg-neutral-900'
          >
            <DesignerCanvas
              canvas={canvas}
              records={records}
              device={device}
              zoom={zoom}
              mode={mode}
              model={model}
              catalog={catalog}
              elements={elements}
              selection={entry.selection}
              locked={locked}
              actions={canvasActions}
            />
          </div>
          <aside className='flex w-72 shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-850'>
            <div className='max-h-[40%] min-h-[80px] overflow-y-auto border-b border-neutral-200 dark:border-neutral-850'>
              {model && (
                <Outline model={model} selection={entry.selection} onSelect={(n) => select([n])} onShift={shift} />
              )}
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto'>
              {model && (
                <Inspector
                  model={model}
                  element={selected}
                  catalog={catalog}
                  variables={request.plcVariables}
                  screens={screens}
                  actions={inspectorActions}
                  locked={locked}
                />
              )}
            </div>
          </aside>
        </div>
      )}
      {!parsed.ok && entry.view === 'design' && (
        <p
          className='border-t border-amber-200 bg-amber-50 px-3 py-1 font-caption text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
          data-testid='hmi-locked-notice'
        >
          The code does not parse: the designer shows the last version that did, and visual edits wait until the code is
          fixed.
        </p>
      )}
      <Diagnostics errors={errors} />
    </div>
  )
}

export function HmiWidgetEditor({ name }: { name: string }) {
  const request = useProjectRequest()
  const widgetRequest = useMemo(() => ({ ...request, widgetPreview: name }), [request, name])
  const device = useMemo(() => ({ id: 'widget', label: 'Widget', width: 320, height: 240, density: 2 }), [])
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = usePreviewSession({
    request: widgetRequest,
    screen: '',
    device,
    design: false,
    framePeriodMs: request.settings.framePeriodMs,
    canvas,
  })
  return (
    <div className='flex h-full w-full flex-col overflow-hidden' data-testid='hmi-widget-editor'>
      <div className='flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-2 dark:border-neutral-850'>
        <span className='font-caption text-xs font-medium text-neutral-850 dark:text-neutral-200'>
          Widget block {name}
        </span>
        <div className='flex-1' />
        <span className='font-caption text-xs text-neutral-600 dark:text-neutral-400' data-testid='hmi-status'>
          {statusText(preview.status, preview.buildMs)}
        </span>
        <ToolButton label='Preview (Ctrl/Cmd+Enter)' testId='hmi-preview-button' onClick={preview.rebuild}>
          Preview
        </ToolButton>
      </div>
      <div className='flex min-h-0 flex-1'>
        <div className='min-w-0 flex-1'>
          <HmiCodeEditor name={name} kind='widget' onPreview={preview.rebuild} />
        </div>
        <aside className='flex w-[360px] shrink-0 flex-col items-center gap-2 border-l border-neutral-200 bg-neutral-100 p-4 dark:border-neutral-850 dark:bg-neutral-900'>
          <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
            At natural size, and stretched, with a test value
          </p>
          <canvas
            ref={canvas}
            data-testid='hmi-widget-canvas'
            className='shadow-md'
            style={{ width: device.width, height: device.height }}
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              preview.pointer('down', e.clientX - r.left, e.clientY - r.top)
            }}
            onPointerUp={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              preview.pointer('up', e.clientX - r.left, e.clientY - r.top)
            }}
          />
        </aside>
      </div>
      <Diagnostics errors={preview.errors} />
    </div>
  )
}
