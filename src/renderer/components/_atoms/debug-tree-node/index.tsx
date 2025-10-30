import { ArrowIcon } from '@root/renderer/assets'
import ViewIcon from '@root/renderer/assets/icons/interface/View'
import { DebugTreeNode } from '@root/types/debugger'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type TreeNodeProps = ComponentPropsWithoutRef<'div'> & {
  node: DebugTreeNode
  onToggleExpand: (compositeKey: string) => void
  onViewToggle?: (compositeKey: string) => void
  isViewing?: boolean
  getValue?: (compositeKey: string) => string | undefined
  level?: number
}

const TreeNode = ({ node, onToggleExpand, onViewToggle, isViewing, getValue, level = 0, ...rest }: TreeNodeProps) => {
  const indentWidth = level * 16

  if (level === 0) {
    console.log('[TreeNode] Rendering root node:', {
      compositeKey: node.compositeKey,
      name: node.name,
      type: node.type,
      isComplex: node.isComplex,
      childrenCount: node.children?.length ?? 0,
    })
  }

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.isComplex) {
      onToggleExpand(node.compositeKey)
    }
  }

  const handleViewToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onViewToggle && !node.isComplex) {
      onViewToggle(node.compositeKey)
    }
  }

  return (
    <div {...rest}>
      <div
        className='flex h-auto w-full items-center gap-2 py-1 hover:bg-slate-50 dark:hover:bg-neutral-900'
        style={{ paddingLeft: `${indentWidth}px` }}
      >
        <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
          {node.isComplex ? (
            <button
              onClick={handleToggleExpand}
              className='flex h-4 w-4 items-center justify-center'
              aria-label={node.isExpanded ? 'Collapse' : 'Expand'}
            >
              <ArrowIcon
                direction='right'
                className={cn(
                  'h-4 w-4 stroke-brand-light transition-all',
                  node.isExpanded && 'rotate-270 stroke-brand',
                )}
              />
            </button>
          ) : onViewToggle ? (
            <button
              onClick={handleViewToggle}
              className='flex h-4 w-4 items-center justify-center'
              aria-label='Toggle graph visibility'
            >
              <ViewIcon className='h-4 w-4 cursor-pointer' stroke={isViewing ? '#7C3AED' : '#B4D0FE'} />
            </button>
          ) : null}
        </div>

        <div className='grid min-w-0 flex-1 grid-cols-[1fr_auto_auto] items-center gap-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <p className='truncate text-neutral-1000 dark:text-white'>{node.name}</p>
          </div>
          <p className='uppercase text-neutral-400 dark:text-neutral-700'>{node.type}</p>
          <p className='text-neutral-1000 dark:text-white'>
            {node.isComplex && !node.isExpanded
              ? '...'
              : node.isComplex
                ? ''
                : getValue
                  ? getValue(node.compositeKey) ?? '-'
                  : '-'}
          </p>
        </div>
      </div>

      {node.isComplex && node.isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.compositeKey}
              node={child}
              onToggleExpand={onToggleExpand}
              onViewToggle={onViewToggle}
              isViewing={isViewing}
              getValue={getValue}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export { TreeNode }
