import { ArrowIcon } from '@root/renderer/assets'
import { DebugTreeNode } from '@root/types/debugger'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type TreeNodeProps = ComponentPropsWithoutRef<'div'> & {
  node: DebugTreeNode
  onToggleExpand: (compositeKey: string) => void
  onViewToggle?: (compositeKey: string) => void
  isViewing?: boolean
  level?: number
}

const TreeNode = ({ node, onToggleExpand, onViewToggle, isViewing, level = 0, ...rest }: TreeNodeProps) => {
  const indentWidth = level * 16

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
        {node.isComplex ? (
          <button
            onClick={handleToggleExpand}
            className='flex h-4 w-4 flex-shrink-0 items-center justify-center'
            aria-label={node.isExpanded ? 'Collapse' : 'Expand'}
          >
            <ArrowIcon
              direction='right'
              className={cn('h-4 w-4 stroke-brand-light transition-all', node.isExpanded && 'rotate-270 stroke-brand')}
            />
          </button>
        ) : (
          <div className='h-4 w-4 flex-shrink-0' />
        )}

        <div className='grid min-w-0 flex-1 grid-cols-[1fr_auto_auto] items-center gap-2'>
          <div className='flex min-w-0 items-center gap-2'>
            {onViewToggle && !node.isComplex && (
              <button onClick={handleViewToggle} className='flex-shrink-0' aria-label='Toggle graph visibility'>
                <svg
                  width='16'
                  height='16'
                  viewBox='0 0 16 16'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  className='cursor-pointer'
                >
                  <path
                    d='M8 3C4.5 3 1.73 5.61 1 9c.73 3.39 3.5 6 7 6s6.27-2.61 7-6c-.73-3.39-3.5-6-7-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5z'
                    fill={isViewing ? '#0066FF' : '#B4D0FE'}
                  />
                </svg>
              </button>
            )}
            <p className='truncate text-neutral-1000 dark:text-white'>{node.name}</p>
          </div>
          <p className='uppercase text-neutral-400 dark:text-neutral-700'>{node.type}</p>
          <p className='text-neutral-1000 dark:text-white'>
            {node.isComplex && !node.isExpanded
              ? '...'
              : node.isComplex
                ? ''
                : node.debugIndex !== undefined
                  ? '0'
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
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export { TreeNode }
