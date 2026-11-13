/**
 * The widgets a screen can use, by palette group with the project's widget blocks apart, and the PLC variables to wire
 * them to. Widgets are dragged onto the canvas or added with a double click; variables are dropped on a widget.
 */
import { cn } from '@root/frontend/utils/cn'
import type { HmiPlcVariable, HmiWidgetCatalog, HmiWidgetInfo } from '@root/middleware/shared/ports/hmi-preview-types'
import { useMemo, useState } from 'react'

import { FIELD_CLASS } from './parts'

/** Drag data types of the designer. */
export const WIDGET_MIME = 'application/x-openplc-hmi-widget'
export const VARIABLE_MIME = 'application/x-openplc-hmi-variable'

const PROJECT_GROUP = 'Project widgets'

function groups(
  catalog: HmiWidgetCatalog,
  projectWidgets: ReadonlySet<string>,
  filter: string,
): Array<[string, HmiWidgetInfo[]]> {
  const byGroup = new Map<string, HmiWidgetInfo[]>()
  for (const info of catalog.widgets.values()) {
    const group = projectWidgets.has(info.name.toUpperCase()) ? PROJECT_GROUP : info.palette
    if (group === undefined || !info.name.toUpperCase().includes(filter.toUpperCase())) continue
    byGroup.set(group, [...(byGroup.get(group) ?? []), info])
  }
  return [...byGroup.entries()].sort(([a], [b]) => (a === PROJECT_GROUP ? 1 : b === PROJECT_GROUP ? -1 : 0))
}

export function Palette(props: {
  catalog: HmiWidgetCatalog
  projectWidgets: ReadonlySet<string>
  variables: readonly HmiPlcVariable[]
  thumbnails: ReadonlyMap<string, string>
  onAdd: (type: string) => void
  disabled: boolean
}) {
  const [tab, setTab] = useState<'widgets' | 'variables'>('widgets')
  const [filter, setFilter] = useState('')
  const grouped = useMemo(
    () => groups(props.catalog, props.projectWidgets, filter),
    [props.catalog, props.projectWidgets, filter],
  )
  const variables = props.variables.filter((v) => v.path.toUpperCase().includes(filter.toUpperCase()))
  return (
    <div className='flex h-full min-h-0 flex-col' data-testid='hmi-palette'>
      <div role='tablist' className='flex gap-1 border-b border-neutral-200 p-2 dark:border-neutral-850'>
        {(['widgets', 'variables'] as const).map((t) => (
          <button
            key={t}
            role='tab'
            type='button'
            aria-selected={tab === t}
            data-testid={`hmi-palette-tab-${t}`}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 rounded-md py-1 font-caption text-xs capitalize text-neutral-700 dark:text-neutral-300',
              tab === t
                ? 'bg-neutral-100 font-medium dark:bg-neutral-900'
                : 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className='p-2'>
        <input
          className={FIELD_CLASS}
          placeholder={tab === 'widgets' ? 'Search widgets' : 'Search variables'}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid='hmi-palette-search'
        />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-2'>
        {tab === 'widgets'
          ? grouped.map(([group, widgets]) => (
              <div key={group} className='mb-3'>
                <h4 className='mb-1 font-caption text-[11px] font-semibold uppercase tracking-wide text-neutral-500'>
                  {group}
                </h4>
                <div className='grid grid-cols-2 gap-1.5'>
                  {widgets.map((w) => (
                    <div
                      key={w.name}
                      role='button'
                      tabIndex={0}
                      draggable={!props.disabled}
                      title={`Drag onto the canvas, or double-click to add ${w.name}`}
                      data-testid={`hmi-palette-${w.name}`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(WIDGET_MIME, w.name)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onDoubleClick={() => !props.disabled && props.onAdd(w.name)}
                      onKeyDown={(e) => e.key === 'Enter' && !props.disabled && props.onAdd(w.name)}
                      className='flex cursor-grab flex-col items-center gap-1 rounded-md border border-neutral-200 bg-white p-1.5 hover:border-brand dark:border-neutral-850 dark:bg-neutral-950'
                    >
                      <div className='flex h-12 w-full items-center justify-center overflow-hidden rounded bg-neutral-50 dark:bg-neutral-900'>
                        {props.thumbnails.get(w.name.toUpperCase()) ? (
                          <img
                            src={props.thumbnails.get(w.name.toUpperCase())}
                            alt=''
                            className='max-h-12 max-w-full object-contain'
                            draggable={false}
                          />
                        ) : (
                          <span className='font-caption text-[10px] text-neutral-400'>
                            {w.name.replace(/^Hmi/i, '')}
                          </span>
                        )}
                      </div>
                      <span className='w-full truncate text-center font-caption text-[11px] text-neutral-700 dark:text-neutral-300'>
                        {w.name.replace(/^Hmi/i, '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          : variables.map((v) => (
              <div
                key={v.path}
                draggable={!props.disabled}
                title='Drop on a widget to show this variable'
                data-testid={`hmi-variable-${v.path}`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(VARIABLE_MIME, v.path)
                  e.dataTransfer.effectAllowed = 'link'
                }}
                className='flex cursor-grab items-center justify-between gap-2 rounded px-2 py-1 font-caption text-xs text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'
              >
                <span className='truncate'>{v.path}</span>
                <span className='shrink-0 text-[10px] text-neutral-500'>{v.type}</span>
              </div>
            ))}
        {tab === 'variables' && variables.length === 0 && (
          <p className='px-2 font-caption text-xs text-neutral-500'>
            No program or global variable of an elementary type.
          </p>
        )}
      </div>
    </div>
  )
}
