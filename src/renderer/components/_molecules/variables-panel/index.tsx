import { ArrowIcon } from '@root/renderer/assets'
import ViewIcon from '@root/renderer/assets/icons/interface/View'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'
import { cn } from '@root/utils'
import { useState } from 'react'

type DebugVariableNode = {
  name: string
  fullPath: string
  type: string
  index: number
  pouName: string
  isBlock: boolean
  children: DebugVariableNode[]
  parentPath?: string
  value?: string
}

type VariablePanelProps = {
  variableHierarchy: Map<string, DebugVariableNode[]>
  debugVariableValues: Map<string, string>
  graphList?: string[]
  setGraphList: React.Dispatch<React.SetStateAction<string[]>>
  onExpandedChange?: (expanded: Set<string>) => void
}

const VariableTreeNode = ({
  node,
  level = 0,
  graphList,
  toggleGraphVisibility,
  expandedNodes,
  toggleExpand,
}: {
  node: DebugVariableNode
  level?: number
  graphList?: string[]
  toggleGraphVisibility: (variableName: string) => void
  expandedNodes: Set<string>
  toggleExpand: (path: string) => void
}) => {
  const isExpanded = expandedNodes.has(node.fullPath)
  const hasChildren = node.isBlock && node.children.length > 0
  const paddingLeft = level * 20 + 8

  return (
    <div>
      <div
        className='grid h-auto w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2'
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        {hasChildren ? (
          <button onClick={() => toggleExpand(node.fullPath)} className='flex h-4 w-4 items-center justify-center'>
            <ArrowIcon
              direction='right'
              className={cn('h-3 w-3 stroke-brand-light transition-all', isExpanded && 'rotate-270 stroke-brand')}
            />
          </button>
        ) : (
          <div className='h-4 w-4' />
        )}

        <div className='flex min-w-0 items-center gap-2'>
          {!hasChildren && (
            <ViewIcon
              type='button'
              className='flex-shrink-0 cursor-pointer'
              stroke={graphList?.includes(node.name) ? '' : '#B4D0FE'}
              onClick={() => toggleGraphVisibility(node.name)}
            />
          )}
          <p className='truncate text-neutral-1000 dark:text-white'>{node.name}</p>
        </div>

        <p className='uppercase text-neutral-400 dark:text-neutral-700'>{node.type}</p>
        <p className='text-neutral-1000 dark:text-white'>{node.value || (hasChildren ? '' : '-')}</p>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <VariableTreeNode
              key={child.fullPath}
              node={child}
              level={level + 1}
              graphList={graphList}
              toggleGraphVisibility={toggleGraphVisibility}
              expandedNodes={expandedNodes}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const VariablesPanel = ({
  variableHierarchy,
  debugVariableValues,
  setGraphList,
  graphList,
  onExpandedChange,
}: VariablePanelProps) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const toggleGraphVisibility = (variableName: string) => {
    setGraphList((prevGraphList) => {
      if (prevGraphList.includes(variableName)) {
        return prevGraphList.filter((name) => name !== variableName)
      } else {
        return [...prevGraphList, variableName]
      }
    })
  }

  const toggleExpand = (path: string) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(path)) {
        newSet.delete(path)
      } else {
        newSet.add(path)
      }
      if (onExpandedChange) {
        onExpandedChange(newSet)
      }
      return newSet
    })
  }

  const allNodes: DebugVariableNode[] = []
  variableHierarchy.forEach((nodes) => {
    const addValuesToNodes = (nodes: DebugVariableNode[], pouName: string): DebugVariableNode[] => {
      return nodes.map((node) => {
        const compositeKey = `${pouName}:${node.name}`
        const value = debugVariableValues.get(compositeKey)

        return {
          ...node,
          value: value,
          children: node.children.length > 0 ? addValuesToNodes(node.children, pouName) : [],
        }
      })
    }

    allNodes.push(...addValuesToNodes(nodes, nodes[0]?.pouName || ''))
  })

  return (
    <div className='flex h-full w-full min-w-52 flex-col gap-2 overflow-hidden rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
      <div className='flex h-7 w-[90px] select-none items-center gap-1 rounded-lg bg-neutral-100 p-1 text-cp-sm dark:bg-brand-dark'>
        <ZapIcon className='h-4 w-4' />
        <p>Variables</p>
      </div>
      <div className='flex h-full flex-col gap-2 overflow-auto whitespace-nowrap'>
        {allNodes.map((node) => (
          <VariableTreeNode
            key={node.fullPath}
            node={node}
            graphList={graphList}
            toggleGraphVisibility={toggleGraphVisibility}
            expandedNodes={expandedNodes}
            toggleExpand={toggleExpand}
          />
        ))}
      </div>
    </div>
  )
}

export { VariablesPanel }
