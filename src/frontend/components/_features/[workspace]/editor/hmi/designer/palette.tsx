/**
 * The designer's left panel: widgets by palette group, the project's widget blocks apart, to drag onto the canvas or
 * add with a double click; the PLC variables to drop on a widget; and the screen's layers. One search filters each.
 */
import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { cn } from '@root/frontend/utils/cn'
import type { HmiPlcVariable, HmiWidgetCatalog, HmiWidgetInfo } from '@root/middleware/shared/ports/hmi-preview-types'
import { hmiWidgetAvailable } from '@root/middleware/shared/utils/hmi/data-sources'
import {
  filterHmiVariableTree,
  type HmiVariableNode,
  hmiVariableTree,
} from '@root/middleware/shared/utils/hmi/plc-variables'
import { type ReactNode, useMemo } from 'react'

/** Drag data types of the designer. */
export const WIDGET_MIME = 'application/x-openplc-hmi-widget'
export const VARIABLE_MIME = 'application/x-openplc-hmi-variable'

const PROJECT_GROUP = 'Project widgets'

export type SidePanelTab = 'widgets' | 'variables' | 'layers'

const TAB_LABELS: Record<SidePanelTab, string> = { widgets: 'Widgets', variables: 'Variables', layers: 'Layers' }

const icon = (tab: SidePanelTab, active: boolean): ReactNode => {
  const stroke = active ? 'stroke-brand' : 'stroke-neutral-700 dark:stroke-neutral-400'
  if (tab === 'widgets')
    return (
      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' strokeWidth='2' className={stroke} aria-hidden='true'>
        <rect x='3' y='3' width='7' height='7' rx='1.5' />
        <rect x='14' y='3' width='7' height='7' rx='1.5' />
        <rect x='3' y='14' width='7' height='7' rx='1.5' />
        <rect x='14' y='14' width='7' height='7' rx='1.5' />
      </svg>
    )
  if (tab === 'variables')
    return (
      <svg
        width='16'
        height='16'
        viewBox='0 0 24 24'
        fill='none'
        strokeWidth='2'
        strokeLinecap='round'
        className={stroke}
        aria-hidden='true'
      >
        <path d='M7 4c-2 2-3 5-3 8s1 6 3 8M17 4c2 2 3 5 3 8s-1 6-3 8M9 9l6 6M15 9l-6 6' />
      </svg>
    )
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      strokeWidth='2'
      strokeLinejoin='round'
      className={stroke}
      aria-hidden='true'
    >
      <path d='m12 3 9 5-9 5-9-5z' />
      <path d='m3 13 9 5 9-5' />
    </svg>
  )
}

/** The panel's frame: the icon tabs, the search field and the active tab's content. */
export function SidePanel(props: {
  tab: SidePanelTab
  onTab: (tab: SidePanelTab) => void
  filter: string
  onFilter: (text: string) => void
  children: ReactNode
}) {
  return (
    <div className='flex h-full min-h-0 flex-col' data-testid='hmi-palette'>
      <div className='flex flex-col gap-2 border-b border-neutral-100 p-2 dark:border-neutral-850'>
        <div
          role='tablist'
          aria-label='Designer panels'
          className='flex gap-0.5 rounded-lg bg-neutral-100 p-[3px] dark:bg-neutral-900'
        >
          {(['widgets', 'variables', 'layers'] as const).map((t) => (
            <button
              key={t}
              role='tab'
              type='button'
              aria-selected={props.tab === t}
              aria-label={TAB_LABELS[t]}
              title={TAB_LABELS[t]}
              data-testid={`hmi-palette-tab-${t}`}
              onClick={() => props.onTab(t)}
              className={cn(
                'flex h-7 flex-1 items-center justify-center rounded-md',
                props.tab === t && 'bg-white shadow-sm dark:bg-neutral-800',
              )}
            >
              {icon(t, props.tab === t)}
            </button>
          ))}
        </div>
        {props.tab !== 'layers' && (
          <label className='relative block'>
            <span className='sr-only'>Search {TAB_LABELS[props.tab].toLowerCase()}</span>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              strokeWidth='2'
              strokeLinecap='round'
              className='absolute left-2.5 top-2 stroke-neutral-600'
              aria-hidden='true'
            >
              <circle cx='11' cy='11' r='7' />
              <path d='m20 20-3.5-3.5' />
            </svg>
            <input
              className='h-[30px] w-full rounded-md border border-neutral-300 bg-white pl-8 pr-2 font-caption text-xs text-neutral-1000 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              placeholder={`Search ${TAB_LABELS[props.tab].toLowerCase()}`}
              value={props.filter}
              onChange={(e) => props.onFilter(e.target.value)}
              data-testid='hmi-palette-search'
            />
          </label>
        )}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto p-2'>{props.children}</div>
    </div>
  )
}

const GroupTitle = ({ children }: { children: ReactNode }) => (
  <h4 className='mb-1.5 mt-1 font-caption text-[11px] font-semibold uppercase tracking-wider text-neutral-850 dark:text-neutral-400'>
    {children}
  </h4>
)

/** Tile labels in words where the type name reads poorly; other tiles show the name without its Hmi prefix. */
const TILE_LABELS: Readonly<Record<string, string>> = {
  HMIVERTICALSTACK: 'Vertical stack',
  HMIHORIZONTALSTACK: 'Horizontal stack',
}

/** The label of a widget's palette tile. */
const tileLabel = (name: string): string => TILE_LABELS[name.toUpperCase()] ?? name.replace(/^Hmi/i, '')

function groups(
  catalog: HmiWidgetCatalog,
  projectWidgets: ReadonlySet<string>,
  filter: string,
  capabilities: object,
): Array<[string, HmiWidgetInfo[]]> {
  const byGroup = new Map<string, HmiWidgetInfo[]>()
  for (const info of catalog.widgets.values()) {
    if (!hmiWidgetAvailable(info, capabilities)) continue
    const group = projectWidgets.has(info.name.toUpperCase()) ? PROJECT_GROUP : info.palette
    const wanted = filter.toUpperCase()
    const matches = info.name.toUpperCase().includes(wanted) || tileLabel(info.name).toUpperCase().includes(wanted)
    if (group === undefined || !matches) continue
    byGroup.set(group, [...(byGroup.get(group) ?? []), info])
  }
  return [...byGroup.entries()].sort(([a], [b]) => (a === PROJECT_GROUP ? 1 : b === PROJECT_GROUP ? -1 : 0))
}

const STROKE = 'stroke-neutral-700 dark:stroke-neutral-400'

/** Drawn tiles for the widgets the core draws nothing for on their own: the containers and the pipe. */
const DRAWN_TILES: Record<string, ReactNode> = {
  HMIVERTICALSTACK: (
    <svg width='56' height='38' viewBox='0 0 56 38' fill='none' strokeWidth='1.5' aria-hidden='true'>
      <rect x='1' y='1' width='54' height='36' rx='4' className={STROKE} strokeDasharray='3 2' />
      <rect x='6' y='6' width='12' height='26' rx='2' className='fill-brand-light stroke-brand' />
      <rect x='22' y='6' width='12' height='26' rx='2' className='fill-brand-light stroke-brand' />
      <rect x='38' y='6' width='12' height='26' rx='2' className='fill-brand-light stroke-brand' />
    </svg>
  ),
  HMIHORIZONTALSTACK: (
    <svg width='56' height='38' viewBox='0 0 56 38' fill='none' strokeWidth='1.5' aria-hidden='true'>
      <rect x='1' y='1' width='54' height='36' rx='4' className={STROKE} strokeDasharray='3 2' />
      <rect x='6' y='6' width='44' height='7' rx='2' className='fill-brand-light stroke-brand' />
      <rect x='6' y='16' width='44' height='7' rx='2' className='fill-brand-light stroke-brand' />
      <rect x='6' y='26' width='44' height='6' rx='2' className='fill-brand-light stroke-brand' />
    </svg>
  ),
  HMIDIAGRAM: (
    <svg width='56' height='38' viewBox='0 0 56 38' fill='none' strokeWidth='1.5' aria-hidden='true'>
      <rect x='1' y='1' width='54' height='36' rx='4' className={STROKE} strokeDasharray='3 2' />
      <rect x='7' y='8' width='12' height='16' rx='3' className='fill-brand-light stroke-brand' />
      <circle cx='42' cy='27' r='5' className='fill-brand-light stroke-brand' />
      <path d='M19 16h12v11h6' className='stroke-brand' strokeLinejoin='round' />
    </svg>
  ),
  HMIPIPE: (
    <svg width='56' height='38' viewBox='0 0 56 38' fill='none' strokeWidth='3' aria-hidden='true'>
      <path d='M6 10h22v18h22' className='stroke-brand' strokeLinejoin='round' strokeLinecap='round' />
    </svg>
  ),
}

/** The widgets as cards with the core-drawn thumbnail of each. */
export function WidgetPalette(props: {
  catalog: HmiWidgetCatalog
  projectWidgets: ReadonlySet<string>
  thumbnails: ReadonlyMap<string, string>
  filter: string
  /** The target's capabilities: widgets that need one it lacks are left out. */
  capabilities: object
  onAdd: (type: string) => void
  disabled: boolean
}) {
  const grouped = useMemo(
    () => groups(props.catalog, props.projectWidgets, props.filter, props.capabilities),
    [props.catalog, props.projectWidgets, props.filter, props.capabilities],
  )
  return (
    <div className='flex flex-col gap-3'>
      {grouped.map(([group, widgets]) => (
        <div key={group}>
          <GroupTitle>{group}</GroupTitle>
          <div className='grid grid-cols-2 gap-1.5'>
            {widgets.map((w) => {
              const label = tileLabel(w.name)
              const thumbnail = props.thumbnails.get(w.name.toUpperCase())
              return (
                <div
                  key={w.name}
                  role='button'
                  tabIndex={0}
                  draggable={!props.disabled}
                  title={`Drag onto the canvas, or double-click to add ${label}`}
                  data-testid={`hmi-palette-${w.name}`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(WIDGET_MIME, w.name)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDoubleClick={() => !props.disabled && props.onAdd(w.name)}
                  onKeyDown={(e) => e.key === 'Enter' && !props.disabled && props.onAdd(w.name)}
                  className='flex cursor-grab flex-col gap-1 rounded-md border border-neutral-200 bg-white p-1 hover:border-brand hover:bg-neutral-50 dark:border-neutral-850 dark:bg-neutral-950'
                >
                  <div className='flex h-12 items-center justify-center overflow-hidden rounded bg-neutral-50 dark:bg-neutral-900'>
                    {thumbnail ? (
                      <img src={thumbnail} alt='' className='max-h-11 max-w-full object-contain' draggable={false} />
                    ) : DRAWN_TILES[w.name.toUpperCase()] ? (
                      DRAWN_TILES[w.name.toUpperCase()]
                    ) : (
                      <span className='font-caption text-[11px] text-neutral-700'>{label}</span>
                    )}
                  </div>
                  <span className='truncate text-center font-caption text-[11px] text-neutral-900 dark:text-neutral-300'>
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The PLC variables as a tree by their paths: instances, programs and Global Variable Lists open and close with the
 * project tree's arrow; a leaf is dropped on a widget. While searching, every matching branch shows open.
 */
export function VariableList(props: {
  variables: readonly HmiPlcVariable[]
  filter: string
  disabled: boolean
  /** Branch keys the user closed. */
  collapsed: readonly string[]
  onToggle: (key: string) => void
}) {
  const tree = useMemo(() => hmiVariableTree(props.variables), [props.variables])
  const searching = props.filter !== ''
  const shown = searching ? filterHmiVariableTree(tree, props.filter) : tree
  if (shown.length === 0)
    return (
      <p className='px-1 font-caption text-xs text-neutral-700'>No program or global variable of an elementary type.</p>
    )
  const render = (nodes: readonly HmiVariableNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: 4 + depth * 12 }
      const v = node.variable
      if (v)
        return (
          <div
            key={node.key}
            draggable={!props.disabled}
            title={`Drop on a widget to show ${v.path}`}
            data-testid={`hmi-variable-${v.path}`}
            onDragStart={(e) => {
              e.dataTransfer.setData(VARIABLE_MIME, v.path)
              e.dataTransfer.effectAllowed = 'link'
            }}
            style={indent}
            className='flex cursor-grab items-center gap-2 rounded-md py-1.5 pr-1.5 font-caption text-xs text-neutral-1000 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'
          >
            <span className='w-4 shrink-0' aria-hidden='true' />
            <span className='min-w-0 flex-1 truncate'>{node.label}</span>
            <span className='shrink-0 rounded bg-neutral-100 px-1 text-[10px] font-semibold text-neutral-850 dark:bg-neutral-900 dark:text-neutral-400'>
              {v.type}
            </span>
            <span className='w-10 shrink-0 truncate text-right text-neutral-700'>{v.initialValue ?? ''}</span>
          </div>
        )
      const open = searching || !props.collapsed.includes(node.key)
      const source = node.source
      return (
        <div key={node.key}>
          <button
            type='button'
            aria-expanded={open}
            data-testid={`hmi-variable-node-${node.key}`}
            onClick={() => props.onToggle(node.key)}
            draggable={source !== undefined && !props.disabled}
            title={source ? `Drop on a data widget to show ${source.path}` : undefined}
            onDragStart={(e) => {
              if (!source) return
              e.dataTransfer.setData(VARIABLE_MIME, source.path)
              e.dataTransfer.effectAllowed = 'link'
            }}
            style={indent}
            className='flex w-full items-center gap-2 rounded-md py-1 pr-1.5 text-left font-caption text-xs text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'
          >
            <ArrowIcon
              direction='right'
              className={cn('h-4 w-4 shrink-0 stroke-brand-light transition-all', open && 'rotate-270 stroke-brand')}
            />
            <span className='min-w-0 flex-1 truncate font-medium'>{node.label}</span>
          </button>
          {open && render(node.children, depth + 1)}
        </div>
      )
    })
  return (
    <div className='flex flex-col' data-testid='hmi-variable-tree'>
      {render(shown, 0)}
    </div>
  )
}
