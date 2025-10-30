import ViewIcon from '@root/renderer/assets/icons/interface/View'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'
import { TreeNode } from '@root/renderer/components/_atoms/debug-tree-node'
import { DebugTreeNode } from '@root/types/debugger'
import { useCallback, useState } from 'react'

type Variable = {
  name: string
  type: string
  value?: string
  compositeKey: string
}

type VariablePanelProps = {
  variables?: Variable[]
  variableTree?: Map<string, DebugTreeNode>
  graphList?: string[]
  setGraphList: React.Dispatch<React.SetStateAction<string[]>>
  debugVariableValues?: Map<string, string>
}

const VariablesPanel = ({
  variables,
  variableTree,
  setGraphList,
  graphList,
  debugVariableValues,
}: VariablePanelProps) => {
  const [expandedNodes, setExpandedNodes] = useState<Map<string, boolean>>(new Map())

  const getValue = (compositeKey: string): string | undefined => {
    return debugVariableValues?.get(compositeKey)
  }

  const toggleGraphVisibility = (variableName: string) => {
    setGraphList((prevGraphList) => {
      if (prevGraphList.includes(variableName)) {
        return prevGraphList.filter((name) => name !== variableName)
      } else {
        return [...prevGraphList, variableName]
      }
    })
  }

  const handleToggleExpand = (compositeKey: string) => {
    setExpandedNodes((prev) => {
      const newMap = new Map(prev)
      newMap.set(compositeKey, !newMap.get(compositeKey))
      return newMap
    })
  }

  const updateNodeExpansion = (node: DebugTreeNode): DebugTreeNode => {
    const isExpanded = expandedNodes.get(node.compositeKey) ?? false
    return {
      ...node,
      isExpanded,
      children: node.children?.map(updateNodeExpansion),
    }
  }

  const isViewingPredicate = useCallback(
    (compositeKey: string) => {
      return graphList?.includes(compositeKey) ?? false
    },
    [graphList],
  )

  const renderTreeView = () => {
    if (!variableTree || variableTree.size === 0) return null

    const rootNodes = Array.from(variableTree.values()).map(updateNodeExpansion)

    return (
      <div className='flex h-full flex-col overflow-auto whitespace-nowrap'>
        {rootNodes.map((node) => (
          <TreeNode
            key={node.compositeKey}
            node={node}
            onToggleExpand={handleToggleExpand}
            onViewToggle={toggleGraphVisibility}
            isViewing={isViewingPredicate}
            getValue={getValue}
          />
        ))}
      </div>
    )
  }

  const renderFlatView = () => {
    if (!variables || variables.length === 0) return null

    return (
      <div className='flex h-full flex-col gap-2 overflow-auto whitespace-nowrap'>
        {variables.map((variable) => (
          <div key={variable.compositeKey} className='grid h-auto w-full grid-cols-[1fr_auto_auto] items-center gap-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <ViewIcon
                type='button'
                className='flex-shrink-0 cursor-pointer'
                stroke={graphList?.includes(variable.compositeKey) ? '#7C3AED' : '#B4D0FE'}
                onClick={() => toggleGraphVisibility(variable.compositeKey)}
              />
              <p className='truncate text-neutral-1000 dark:text-white'>{variable.name}</p>
            </div>
            <p className='uppercase text-neutral-400 dark:text-neutral-700'>{variable.type}</p>
            <p className='text-neutral-1000 dark:text-white'>{variable.value || '0'}</p>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className='flex h-full w-full min-w-52 flex-col gap-2 overflow-hidden rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
      <div className='flex h-7 w-[90px] select-none items-center gap-1 rounded-lg bg-neutral-100 p-1 text-cp-sm dark:bg-brand-dark'>
        <ZapIcon className='h-4 w-4' />
        <p>Variables</p>
      </div>
      {variableTree && variableTree.size > 0 ? renderTreeView() : renderFlatView()}
    </div>
  )
}

export { VariablesPanel }
