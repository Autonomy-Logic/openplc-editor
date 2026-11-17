/** The screen's elements as a tree, in the order they are declared, which is the order they are laid out in. */
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
}) {
  const render = (parent: string | null, depth: number) =>
    childrenOf(props.model, parent).map((e) => {
      const selected = props.selection.some((s) => same(s, e.name))
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
              selected && 'bg-brand-light/30 dark:bg-brand/30 font-medium',
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
            title={e.locked ? `Edited in the code view: ${e.locked}` : e.type}
          >
            <span className='truncate'>{e.name}</span>
            <span className='ml-auto shrink-0 text-[10px] text-neutral-500'>{e.type.replace(/^Hmi/i, '')}</span>
          </div>
          <ul>{render(e.name, depth + 1)}</ul>
        </li>
      )
    })
  return (
    <ul role='tree' aria-label='Elements' className='flex flex-col py-1' data-testid='hmi-outline'>
      {render(null, 0)}
    </ul>
  )
}
