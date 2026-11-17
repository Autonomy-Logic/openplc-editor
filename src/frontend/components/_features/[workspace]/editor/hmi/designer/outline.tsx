/**
 * The screen's elements as a tree, in the order they are declared, which is the order they are laid out in; containers
 * collapse and expand with the project tree's arrow.
 */
import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { cn } from '@root/frontend/utils/cn'
import type { DesignerElement, DesignerModel } from '@root/middleware/shared/utils/hmi/designer/designer-model'

const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

function childrenOf(model: DesignerModel, parent: string | null): DesignerElement[] {
  return model.elements.filter((e) =>
    parent === null
      ? e.parent === null || !model.elements.some((p) => same(p.name, e.parent ?? ''))
      : e.parent !== null && same(e.parent, parent),
  )
}

export function Outline(props: {
  model: DesignerModel
  selection: readonly string[]
  onSelect: (name: string) => void
  /** Moves an element one place up (-1) or down (1) among its siblings. */
  onShift: (name: string, step: -1 | 1) => void
  /** Whether an element of this type holds others, and so gets an arrow. */
  isContainer: (type: string) => boolean
  /** Containers whose children are hidden, by upper-case name. */
  collapsed: readonly string[]
  onToggle: (name: string) => void
}) {
  const render = (parent: string | null, depth: number) =>
    childrenOf(props.model, parent).map((e) => {
      const selected = props.selection.some((s) => same(s, e.name))
      const container = props.isContainer(e.type)
      const open = !props.collapsed.includes(e.name.toUpperCase())
      return (
        <li key={e.name}>
          <div
            role='treeitem'
            aria-selected={selected}
            tabIndex={0}
            data-testid={`hmi-outline-${e.name}`}
            onClick={() => props.onSelect(e.name)}
            onKeyDown={(event) => {
              if (event.altKey && event.key === 'ArrowUp') props.onShift(e.name, -1)
              if (event.altKey && event.key === 'ArrowDown') props.onShift(e.name, 1)
            }}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 font-caption text-xs text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900',
              selected && 'bg-neutral-100 font-medium text-neutral-1000 dark:bg-neutral-900 dark:text-white',
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
            title={e.locked ? `Edited in the code view: ${e.locked}` : e.type}
          >
            {container ? (
              <button
                type='button'
                aria-label={open ? `Collapse ${e.name}` : `Expand ${e.name}`}
                aria-expanded={open}
                data-testid={`hmi-outline-toggle-${e.name}`}
                className='-ml-1 shrink-0'
                onClick={(event) => {
                  event.stopPropagation()
                  props.onToggle(e.name)
                }}
              >
                <ArrowIcon
                  direction='right'
                  className={cn('h-4 w-4 stroke-brand-light transition-all', open && 'rotate-270 stroke-brand')}
                />
              </button>
            ) : (
              <span className='-ml-1 w-4 shrink-0' aria-hidden='true' />
            )}
            <span className='truncate'>{e.name}</span>
            <span className='ml-auto shrink-0 text-[10px] text-neutral-500'>{e.type.replace(/^Hmi/i, '')}</span>
          </div>
          {open && <ul>{render(e.name, depth + 1)}</ul>}
        </li>
      )
    })
  return (
    <ul role='tree' aria-label='Elements' className='flex flex-col py-1' data-testid='hmi-outline'>
      {render(null, 0)}
    </ul>
  )
}
