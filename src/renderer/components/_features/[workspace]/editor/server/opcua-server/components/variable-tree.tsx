import { cn } from '@root/utils'
import { useCallback, useState } from 'react'

import type { VariableTreeNode } from '../hooks/use-project-variables'

interface VariableTreeProps {
  nodes: VariableTreeNode[]
  selectedIds: Set<string>
  onSelect: (node: VariableTreeNode) => void
  filter?: string
}

// Icons for different node types (using text abbreviations)
const NodeIcon = ({ type }: { type: VariableTreeNode['type'] }) => {
  switch (type) {
    case 'program':
      return (
        <span className='flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-[9px] font-bold text-blue-700 dark:bg-blue-900 dark:text-blue-300'>
          P
        </span>
      )
    case 'function_block':
      return (
        <span className='flex h-4 w-4 items-center justify-center rounded bg-purple-100 text-[9px] font-bold text-purple-700 dark:bg-purple-900 dark:text-purple-300'>
          FB
        </span>
      )
    case 'global':
      return (
        <span className='flex h-4 w-4 items-center justify-center rounded bg-green-100 text-[9px] font-bold text-green-700 dark:bg-green-900 dark:text-green-300'>
          G
        </span>
      )
    case 'structure':
      return (
        <span className='flex h-4 w-4 items-center justify-center rounded bg-amber-100 text-[9px] font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300'>
          S
        </span>
      )
    case 'array':
      return (
        <span className='flex h-4 w-4 items-center justify-center rounded bg-cyan-100 text-[9px] font-bold text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'>
          []
        </span>
      )
    case 'variable':
      return (
        <span className='flex h-4 w-4 items-center justify-center rounded bg-neutral-200 text-[9px] font-bold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'>
          V
        </span>
      )
    default:
      return null
  }
}

// Expand/collapse icon
const ExpandIcon = ({ expanded, onClick }: { expanded: boolean; onClick: (e: React.MouseEvent) => void }) => (
  <button
    type='button'
    onClick={onClick}
    className='flex h-4 w-4 items-center justify-center text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
  >
    <span className='text-xs'>{expanded ? '▼' : '▶'}</span>
  </button>
)

// Checkbox for selection
const Checkbox = ({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
}) => (
  <button
    type='button'
    onClick={(e) => {
      e.stopPropagation()
      onChange()
    }}
    className={cn(
      'flex h-4 w-4 items-center justify-center rounded border',
      checked
        ? 'border-brand bg-brand text-white'
        : indeterminate
          ? 'bg-brand/50 border-brand text-white'
          : 'border-neutral-400 bg-white dark:border-neutral-600 dark:bg-neutral-800',
    )}
  >
    {checked && <span className='text-xs'>✓</span>}
    {!checked && indeterminate && <span className='text-xs'>−</span>}
  </button>
)

interface TreeNodeRowProps {
  node: VariableTreeNode
  depth: number
  selectedIds: Set<string>
  expandedIds: Set<string>
  onToggleExpand: (nodeId: string) => void
  onSelect: (node: VariableTreeNode) => void
  filter?: string
}

const TreeNodeRow = ({ node, depth, selectedIds, expandedIds, onToggleExpand, onSelect, filter }: TreeNodeRowProps) => {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedIds.has(node.id)

  // Check if any children are selected (for indeterminate state)
  const hasSelectedChildren = hasChildren && node.children!.some((child) => checkAnySelected(child, selectedIds))

  // Filter match
  const matchesFilter = !filter || node.name.toLowerCase().includes(filter.toLowerCase())
  const hasMatchingChildren =
    !filter || (hasChildren && node.children!.some((child) => checkFilterMatch(child, filter)))

  // Don't render if doesn't match filter and no children match
  if (!matchesFilter && !hasMatchingChildren) {
    return null
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800',
          isSelected && 'bg-brand/10',
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {/* Expand/collapse button */}
        {hasChildren ? (
          <ExpandIcon
            expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.id)
            }}
          />
        ) : (
          <div className='w-4' />
        )}

        {/* Selection checkbox (only for selectable nodes) */}
        {node.isSelectable ? (
          <Checkbox
            checked={isSelected}
            indeterminate={!isSelected && hasSelectedChildren}
            onChange={() => onSelect(node)}
          />
        ) : (
          <div className='w-4' />
        )}

        {/* Node icon */}
        <NodeIcon type={node.type} />

        {/* Node name */}
        <span
          className={cn(
            'font-caption text-xs font-medium',
            node.isSelectable ? 'text-neutral-950 dark:text-white' : 'text-neutral-700 dark:text-neutral-300',
          )}
        >
          {node.name}
        </span>

        {/* Variable type */}
        {node.variableType && (
          <span className='font-caption text-xs text-neutral-500 dark:text-neutral-400'>({node.variableType})</span>
        )}
      </div>

      {/* Render children if expanded */}
      {hasChildren && isExpanded && (
        <>
          {node.children!.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              filter={filter}
            />
          ))}
        </>
      )}
    </>
  )
}

// Helper to check if any node or its children are selected
const checkAnySelected = (node: VariableTreeNode, selectedIds: Set<string>): boolean => {
  if (selectedIds.has(node.id)) return true
  if (node.children) {
    return node.children.some((child) => checkAnySelected(child, selectedIds))
  }
  return false
}

// Helper to check if node or any children match filter
const checkFilterMatch = (node: VariableTreeNode, filter: string): boolean => {
  if (node.name.toLowerCase().includes(filter.toLowerCase())) return true
  if (node.children) {
    return node.children.some((child) => checkFilterMatch(child, filter))
  }
  return false
}

export const VariableTree = ({ nodes, selectedIds, onSelect, filter }: VariableTreeProps) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Auto-expand top-level nodes
    return new Set(nodes.map((n) => n.id))
  })

  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  if (nodes.length === 0) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>
          No program variables found. Create a program with variables first.
        </p>
      </div>
    )
  }

  return (
    <div className='flex flex-col overflow-y-auto'>
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          selectedIds={selectedIds}
          expandedIds={expandedIds}
          onToggleExpand={handleToggleExpand}
          onSelect={onSelect}
          filter={filter}
        />
      ))}
    </div>
  )
}
