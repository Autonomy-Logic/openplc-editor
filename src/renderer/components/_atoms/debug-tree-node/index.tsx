import { ArrowIcon } from '@root/renderer/assets'
import ViewIcon from '@root/renderer/assets/icons/interface/View'
import { DebugTreeNode } from '@root/types/debugger'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type TreeNodeProps = ComponentPropsWithoutRef<'div'> & {
  node: DebugTreeNode
  onToggleExpand: (compositeKey: string) => void
  onViewToggle?: (compositeKey: string) => void
  isViewing?: (compositeKey: string) => boolean
  getValue?: (compositeKey: string) => string | undefined
  isForced?: (compositeKey: string) => boolean
  getForcedValue?: (compositeKey: string) => boolean | undefined
  canForce?: (node: DebugTreeNode) => boolean
  onRowClick?: (node: DebugTreeNode, position: { x: number; y: number }) => void
  level?: number
}

const TreeNode = ({
  node,
  onToggleExpand,
  onViewToggle,
  isViewing,
  getValue,
  isForced,
  getForcedValue,
  canForce,
  onRowClick,
  level = 0,
  ...rest
}: TreeNodeProps) => {
  const indentWidth = level * 16
  const isCurrentNodeViewing = isViewing ? isViewing(node.compositeKey) : false
  const isCurrentNodeForced = isForced ? isForced(node.compositeKey) : false
  const forcedValue = getForcedValue ? getForcedValue(node.compositeKey) : undefined
  const canForceNode = canForce ? canForce(node) : false

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

  const handleRowBodyClick = (e: React.MouseEvent) => {
    if (canForceNode && onRowClick) {
      onRowClick(node, { x: e.clientX, y: e.clientY })
    }
  }

  const textColor = isCurrentNodeForced ? (forcedValue ? '#80C000' : '#4080FF') : undefined

  return (
    <div {...rest}>
      <div className='flex h-auto w-full items-center gap-2'>
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
              <ViewIcon className='h-4 w-4 cursor-pointer' stroke={isCurrentNodeViewing ? '#7C3AED' : '#B4D0FE'} />
            </button>
          ) : null}
        </div>

        <div
          className={cn(
            'grid min-w-0 flex-1 grid-cols-[1fr_auto_auto] items-center gap-2 py-1',
            canForceNode && 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-850',
          )}
          style={{ paddingLeft: `${indentWidth}px` }}
          onClick={handleRowBodyClick}
        >
          <div className='flex min-w-0 items-center gap-2'>
            <p
              className='truncate text-neutral-1000 dark:text-white'
              style={{
                color: textColor,
                fontWeight: isCurrentNodeForced ? 600 : undefined,
              }}
            >
              {node.name}
            </p>
          </div>
          <p className='uppercase text-neutral-400 dark:text-neutral-700'>{node.type}</p>
          <p
            className='text-neutral-1000 dark:text-white'
            style={{
              color: textColor,
              fontWeight: isCurrentNodeForced ? 600 : undefined,
            }}
          >
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
              isForced={isForced}
              getForcedValue={getForcedValue}
              canForce={canForce}
              onRowClick={onRowClick}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export { TreeNode }
