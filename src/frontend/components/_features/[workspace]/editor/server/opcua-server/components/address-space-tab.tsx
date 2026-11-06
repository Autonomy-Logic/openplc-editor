import { useOpenPLCStore } from '@root/frontend/store'
import { findInstanceName } from '@root/frontend/utils/debug-variable-finder'
import { isComplexTreeNode as isComplexType } from '@root/frontend/utils/opcua/node-defaults'
import { isGlobalScopePou } from '@root/frontend/utils/opcua/resolve-indices'
import { countTopLevelEntries, indexTree, treeIdForNode } from '@root/frontend/utils/opcua/tree-index'
import type { VariableTreeNode } from '@root/frontend/utils/opcua/types'
import type { OpcUaNodeConfig, OpcUaServerConfig } from '@root/middleware/shared/ports/types'
import { useCallback, useMemo, useState } from 'react'

import { useIsEditingLocked } from '../../../../../../../hooks/use-editing-lock'
import { InputWithRef } from '../../../../../../_atoms/input'
import { EditingLockBoundary } from '../../../../../../_molecules/editing-lock-boundary'
import { findTreeNodeById, getSelectableDescendantIds, useProjectVariables } from '../hooks/use-project-variables'
import { SelectedVariablesList } from './selected-variables-list'
import { VariableConfigModal } from './variable-config-modal'
import { VariableTree } from './variable-tree'

interface AddressSpaceTabProps {
  config: OpcUaServerConfig
  serverName: string
  onConfigChange: () => void
}

export const AddressSpaceTab = ({ config, serverName, onConfigChange }: AddressSpaceTabProps) => {
  const {
    projectActions: { addOpcUaNode, updateOpcUaNode, removeOpcUaNode },
  } = useOpenPLCStore()

  // Get all project variables for the tree
  const projectVariables = useProjectVariables()
  const instances = useOpenPLCStore((state) => state.project.data.configurations.resource.instances)
  const treeIndex = useMemo(() => indexTree(projectVariables), [projectVariables])

  // Local state
  const isEditingLocked = useIsEditingLocked()
  const [filter, setFilter] = useState('')
  const entryCounts = useMemo(() => countTopLevelEntries(projectVariables, filter), [projectVariables, filter])
  const [selectedVariableIds, setSelectedVariableIds] = useState<Set<string>>(() => {
    // Initialize with IDs of already configured nodes
    return new Set(config.addressSpace.nodes.map((n) => treeIdForNode(n, treeIndex)))
  })
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingVariable, setEditingVariable] = useState<VariableTreeNode | null>(null)
  const [editingConfig, setEditingConfig] = useState<OpcUaNodeConfig | undefined>(undefined)

  // Get existing node IDs for validation
  const existingNodeIds = useMemo(() => config.addressSpace.nodes.map((n) => n.nodeId), [config.addressSpace.nodes])

  // Nodes the build drops with a warning, by the build resolver's rule: a program-scoped node needs
  // its program instantiated in Resources before the variable is looked up, globals included.
  const missingNodeIds = useMemo(
    () =>
      new Set(
        config.addressSpace.nodes
          .filter(
            (n) =>
              (!isGlobalScopePou(n.pouName) && findInstanceName(n.pouName, instances) === null) ||
              !treeIndex.get(treeIdForNode(n, treeIndex)),
          )
          .map((n) => n.id),
      ),
    [config.addressSpace.nodes, instances, treeIndex],
  )

  // Handle namespace URI change
  // Handle variable selection from tree
  const handleVariableSelect = useCallback(
    (node: VariableTreeNode) => {
      if (isEditingLocked) return
      if (!node.isSelectable) return

      // Check if already selected
      const nodeKey = `${node.pouName}-${node.variablePath}`
      if (selectedVariableIds.has(nodeKey)) {
        // Deselect - remove from config if it exists
        const existingNode = config.addressSpace.nodes.find((n) => treeIdForNode(n, treeIndex) === nodeKey)
        if (existingNode) {
          removeOpcUaNode(serverName, existingNode.id)
          onConfigChange()
        }

        // For complex types, also deselect all children
        if (isComplexType(node)) {
          const descendantIds = getSelectableDescendantIds(node)
          setSelectedVariableIds((prev) => {
            const next = new Set(prev)
            next.delete(nodeKey)
            // Remove all descendant IDs
            descendantIds.forEach((id) => next.delete(id))
            return next
          })

          // Also remove any configured descendant nodes
          descendantIds.forEach((descendantId) => {
            const descendantNode = config.addressSpace.nodes.find(
              (n) => `${n.pouName}-${n.variablePath}` === descendantId,
            )
            if (descendantNode) {
              removeOpcUaNode(serverName, descendantNode.id)
            }
          })
        } else {
          setSelectedVariableIds((prev) => {
            const next = new Set(prev)
            next.delete(nodeKey)
            return next
          })
        }
      } else {
        // Select - open modal to configure
        setEditingVariable(node)
        setEditingConfig(undefined)
        setIsModalOpen(true)
      }
    },
    [
      isEditingLocked,
      selectedVariableIds,
      config.addressSpace.nodes,
      treeIndex,
      serverName,
      removeOpcUaNode,
      onConfigChange,
    ],
  )

  // Handle save from configuration modal
  const handleSaveConfig = useCallback(
    (nodeConfig: OpcUaNodeConfig) => {
      const nodeKey = `${nodeConfig.pouName}-${nodeConfig.variablePath}`

      if (editingConfig) {
        // Update existing node
        updateOpcUaNode(serverName, editingConfig.id, nodeConfig)
      } else {
        // Add new node
        addOpcUaNode(serverName, nodeConfig)

        // For complex types, also mark all descendants as selected
        if (editingVariable && isComplexType(editingVariable)) {
          const descendantIds = getSelectableDescendantIds(editingVariable)
          setSelectedVariableIds((prev) => {
            const next = new Set(prev)
            next.add(nodeKey)
            descendantIds.forEach((id) => next.add(id))
            return next
          })
        } else {
          setSelectedVariableIds((prev) => new Set(prev).add(nodeKey))
        }
      }
      onConfigChange()
    },
    [serverName, editingConfig, editingVariable, addOpcUaNode, updateOpcUaNode, onConfigChange],
  )

  // Handle edit from selected list
  const handleEditNode = useCallback(
    (node: OpcUaNodeConfig) => {
      if (isEditingLocked) return
      // Find the corresponding tree node
      const treeNode = treeIndex.get(treeIdForNode(node, treeIndex))
      if (treeNode) {
        setEditingVariable(treeNode)
        setEditingConfig(node)
        setIsModalOpen(true)
      }
    },
    [isEditingLocked, treeIndex],
  )

  // Handle remove from selected list
  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      if (isEditingLocked) return
      const node = config.addressSpace.nodes.find((n) => n.id === nodeId)
      if (node) {
        removeOpcUaNode(serverName, nodeId)

        // Find the tree node to check if it's a complex type with descendants
        const nodeKey = treeIdForNode(node, treeIndex)
        const treeNode = findTreeNodeById(projectVariables, nodeKey)

        if (treeNode && isComplexType(treeNode)) {
          // For complex types, also remove all descendant IDs from selection
          const descendantIds = getSelectableDescendantIds(treeNode)
          setSelectedVariableIds((prev) => {
            const next = new Set(prev)
            next.delete(nodeKey)
            descendantIds.forEach((id) => next.delete(id))
            return next
          })
        } else {
          setSelectedVariableIds((prev) => {
            const next = new Set(prev)
            next.delete(nodeKey)
            return next
          })
        }
        onConfigChange()
      }
    },
    [
      isEditingLocked,
      config.addressSpace.nodes,
      serverName,
      removeOpcUaNode,
      onConfigChange,
      projectVariables,
      treeIndex,
    ],
  )

  return (
    <div className='flex h-full flex-col gap-4'>
      {/* Split Pane Layout */}
      <div className='flex flex-1 gap-4 overflow-hidden'>
        {/* Left Panel - Available Variables */}
        <div className='flex w-1/2 flex-col rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'>
          {/* Panel Header */}
          <div className='border-b border-neutral-200 p-3 dark:border-neutral-800'>
            <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
              Available PLC Variables
            </h3>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              {filter ? `${entryCounts.shown} of ${entryCounts.total} shown` : `${entryCounts.total} available`}
            </p>
          </div>

          {/* Filter Input */}
          <div className='border-b border-neutral-200 p-2 dark:border-neutral-800'>
            <InputWithRef
              type='text'
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder='Filter variables...'
              className='h-[28px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
          </div>

          {/* Variable Tree */}
          <EditingLockBoundary className='h-auto w-auto flex-1 overflow-y-auto p-2'>
            <VariableTree
              nodes={projectVariables}
              selectedIds={selectedVariableIds}
              onSelect={handleVariableSelect}
              filter={filter}
            />
          </EditingLockBoundary>
        </div>

        {/* Right Panel - Selected Variables */}
        <div className='flex w-1/2 flex-col rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'>
          {/* Panel Header */}
          <div className='border-b border-neutral-200 p-3 dark:border-neutral-800'>
            <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Selected for OPC-UA</h3>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              {config.addressSpace.nodes.length} variable{config.addressSpace.nodes.length !== 1 ? 's' : ''} configured
            </p>
          </div>

          {/* Selected Variables List */}
          <EditingLockBoundary className='h-auto w-auto flex-1 overflow-y-auto p-2'>
            <SelectedVariablesList
              nodes={config.addressSpace.nodes}
              missingNodeIds={missingNodeIds}
              onEdit={handleEditNode}
              onRemove={handleRemoveNode}
            />
          </EditingLockBoundary>
        </div>
      </div>

      {/* Variable Configuration Modal */}
      <VariableConfigModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingVariable(null)
          setEditingConfig(undefined)
        }}
        onSave={handleSaveConfig}
        variable={editingVariable}
        existingConfig={editingConfig}
        existingNodeIds={existingNodeIds}
      />
    </div>
  )
}
