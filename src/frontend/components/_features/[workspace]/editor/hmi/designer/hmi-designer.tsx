/**
 * The HMI designer: a screen's tab with widgets, variables and layers on the left, the running screen on a device
 * preset with the selection's properties pinned beside it, or its code; and a widget block's tab with its code beside
 * its preview. Every edit goes through the designer's text patches and the store's history, so undo covers both views.
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
import { type InspectorActions, PropertiesCard } from './inspector'
import { Outline } from './outline'
import { SidePanel, type SidePanelTab, VariableList, WidgetPalette } from './palette'
import { CanvasControls, DesignerSelect, PreviewNotice } from './parts'
import { usePreviewSession } from './use-preview-session'

const EMPTY_CATALOG: HmiWidgetCatalog = { widgets: new Map(), colors: [] }
const REBUILD_DELAY_MS = 300
const NOTICE_MS = 3000
/** Canvas room the fit zoom leaves for the properties card and the device picker. */
const FIT_RESERVE = { width: 340, height: 64 }
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
      const room = { width: area.clientWidth - FIT_RESERVE.width, height: area.clientHeight - FIT_RESERVE.height - 24 }
      if (room.width <= 0 || room.height <= 0) return
      setFit(Math.max(0.1, Math.min(room.width / width, room.height / height)))
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
  const [panel, setPanel] = useState<SidePanelTab>('widgets')
  const [filter, setFilter] = useState('')
  const [reveal, setReveal] = useState<{ line: number; key: number } | undefined>(undefined)
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
  const builtSource = useRef(source)
  useEffect(() => {
    if (entry.view !== 'design' || !parsed.ok || builtSource.current === source) return
    builtSource.current = source
    scheduleRebuild()
  }, [entry.view, parsed.ok, source, scheduleRebuild])
  const builtLibrary = useRef({ widgets: request.widgets, settings: request.settings })
  useEffect(() => {
    if (builtLibrary.current.widgets === request.widgets && builtLibrary.current.settings === request.settings) return
    builtLibrary.current = { widgets: request.widgets, settings: request.settings }
    scheduleRebuild()
  }, [request.widgets, request.settings, scheduleRebuild])

  const [notice, setNotice] = useState(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showNotice = useCallback(() => {
    setNotice(true)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(false), NOTICE_MS)
  }, [])
  useEffect(() => () => void (noticeTimer.current && clearTimeout(noticeTimer.current)), [])
  const setPreviewMode = useCallback(
    (on: boolean) => {
      setMode(on ? 'run' : 'design')
      if (on) showNotice()
      else {
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        setNotice(false)
      }
    },
    [showNotice],
  )

  const apply = useCallback(
    (result: DesignerEdit, options: { rebuild: boolean; merge?: string } = { rebuild: true }): boolean => {
      if (!result.ok) {
        toast({ title: 'Not changed', description: result.message, variant: 'fail' })
        return false
      }
      if (!options.rebuild) builtSource.current = result.source
      actions.applySource(kind, name, result.source, options.merge ? { key: options.merge, at: Date.now() } : undefined)
      return true
    },
    [actions, name],
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
    blocked: showNotice,
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
    if (mode === 'run') {
      if (e.key === 'Escape') setPreviewMode(false)
      else if (e.key.length === 1) preview.key(e.key.charCodeAt(0))
      else if (e.key === 'Enter') preview.key(13)
      else if (e.key === 'Backspace') preview.key(8)
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

  const showInCode = (element: string) => {
    const target = model?.elements.find((e) => same(e.name, element))
    if (target) setReveal({ line: source.slice(0, target.lines.start).split('\n').length, key: Date.now() })
    actions.setView(kind, name, 'code')
  }
  const zoomTo = (next: number | null) => actions.setZoom(kind, name, next)

  return (
    <div className='flex h-full w-full flex-col gap-2 overflow-hidden' data-testid='hmi-designer' onKeyDown={onKeyDown}>
      <div className='flex h-8 shrink-0 items-center justify-between'>
        <h2 className='truncate font-display text-xl font-bold text-neutral-1000 dark:text-white'>{name}</h2>
        <ViewModeToggle
          display={entry.view === 'design' ? 'table' : 'code'}
          onDisplayChange={(d) => actions.setView(kind, name, d === 'table' ? 'design' : 'code')}
          containerLabel='Screen view'
          tableLabel='Designer'
          codeLabel='Code'
          tableIcon='layout'
        />
      </div>
      {entry.view === 'code' ? (
        <div className='min-h-0 flex-1'>
          <HmiCodeEditor name={name} kind={kind} reveal={reveal} />
        </div>
      ) : (
        <div className='flex min-h-0 flex-1 gap-2'>
          <aside
            className='flex w-60 shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-850 dark:bg-neutral-950'
            onPointerDownCapture={mode === 'run' ? showNotice : undefined}
          >
            <SidePanel
              tab={panel}
              onTab={(t) => {
                setPanel(t)
                setFilter('')
              }}
              filter={filter}
              onFilter={setFilter}
            >
              {panel === 'widgets' && (
                <WidgetPalette
                  catalog={catalog}
                  projectWidgets={new Set(request.widgets.map((w) => w.name.toUpperCase()))}
                  thumbnails={thumbnails}
                  filter={filter}
                  onAdd={addFromPalette}
                  disabled={locked || mode === 'run'}
                />
              )}
              {panel === 'variables' && (
                <VariableList variables={request.plcVariables} filter={filter} disabled={locked || mode === 'run'} />
              )}
              {panel === 'layers' && model && (
                <Outline model={model} selection={entry.selection} onSelect={(n) => select([n])} onShift={shift} />
              )}
            </SidePanel>
          </aside>
          <div
            className='relative min-w-0 flex-1 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 bg-[radial-gradient(#b1b9c8_1px,transparent_1px)] [background-size:14px_14px] dark:border-neutral-850 dark:bg-neutral-900 dark:bg-[radial-gradient(#2e3038_1px,transparent_1px)]'
            data-testid='hmi-canvas-area'
            data-preview={`${preview.status} ${preview.buildMs ?? ''}`.trim()}
          >
            <div ref={area} className='absolute inset-0 overflow-auto'>
              <div className='flex min-h-full min-w-fit flex-col items-start gap-2 py-3 pl-14 pr-[280px]'>
                <div className='w-48' onPointerDownCapture={mode === 'run' ? showNotice : undefined}>
                  <DesignerSelect
                    value={device.id}
                    testId='hmi-device'
                    options={HMI_DEVICE_PRESETS.map((d) => ({
                      value: d.id,
                      label: `${d.label} · ${d.width} × ${d.height}`,
                    }))}
                    onChange={(id) => actions.setDevice(kind, name, id)}
                  />
                </div>
                <div className='pt-4'>
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
              </div>
            </div>
            {model && selected && mode === 'design' && (
              <PropertiesCard
                key={selected.name}
                model={model}
                element={selected}
                catalog={catalog}
                variables={request.plcVariables}
                screens={screens}
                actions={inspectorActions}
                locked={locked}
                onShowInCode={showInCode}
              />
            )}
            <CanvasControls
              zoom={zoom}
              onZoomIn={() => zoomTo(ZOOM_STEPS.find((z) => z > zoom + 0.01) ?? ZOOM_STEPS.at(-1) ?? 3)}
              onZoomOut={() => zoomTo([...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.01) ?? ZOOM_STEPS[0])}
              onFit={() => zoomTo(null)}
              preview={mode === 'run'}
              onPreview={() => setPreviewMode(mode !== 'run')}
            />
            <PreviewNotice visible={mode === 'run' && notice} />
          </div>
        </div>
      )}
      {!parsed.ok && entry.view === 'design' && (
        <p
          className='rounded-md bg-amber-50 px-3 py-1 font-caption text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300'
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
    <div className='flex h-full w-full flex-col gap-2 overflow-hidden' data-testid='hmi-widget-editor'>
      <div className='flex h-8 shrink-0 items-center justify-between gap-2'>
        <h2 className='truncate font-display text-xl font-bold text-neutral-1000 dark:text-white'>{name}</h2>
        <button
          type='button'
          title='Preview (Ctrl/Cmd+Enter)'
          data-testid='hmi-preview-button'
          onClick={preview.rebuild}
          className='flex h-7 items-center gap-2 rounded-md bg-brand px-2.5 font-caption text-xs font-semibold text-white hover:bg-brand-medium-dark'
        >
          <svg width='11' height='11' viewBox='0 0 24 24' className='fill-white' aria-hidden='true'>
            <path d='M7 4v16l13-8z' />
          </svg>
          Preview
          <span className='font-medium opacity-80'>⌘↵</span>
        </button>
      </div>
      <div className='flex min-h-0 flex-1 gap-2'>
        <div className='min-w-0 flex-1'>
          <HmiCodeEditor name={name} kind='widget' onPreview={preview.rebuild} />
        </div>
        <div
          className='flex w-[380px] shrink-0 items-start justify-center overflow-auto rounded-lg border border-neutral-200 bg-neutral-100 bg-[radial-gradient(#b1b9c8_1px,transparent_1px)] p-6 [background-size:14px_14px] dark:border-neutral-850 dark:bg-neutral-900 dark:bg-[radial-gradient(#2e3038_1px,transparent_1px)]'
          data-testid='hmi-canvas-area'
          data-preview={`${preview.status} ${preview.buildMs ?? ''}`.trim()}
        >
          <canvas
            ref={canvas}
            data-testid='hmi-widget-canvas'
            className='rounded-lg shadow-[0_6px_24px_rgba(1,30,75,0.14)]'
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
        </div>
      </div>
      <Diagnostics errors={preview.errors} />
    </div>
  )
}
