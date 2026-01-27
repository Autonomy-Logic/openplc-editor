import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { useOpenPLCStore } from '@root/renderer/store'
import type { OpcUaNodeConfig, OpcUaServerConfig } from '@root/types/PLC/open-plc'
import { useCallback, useMemo, useState } from 'react'

import {
  findTreeNodeById,
  getSelectableDescendantIds,
  isComplexType,
  useProjectVariables,
  type VariableTreeNode,
} from '../hooks/use-project-variables'
import { SelectedVariablesList } from './selected-variables-list'
import { VariableConfigModal } from './variable-config-modal'
import { VariableTree } from './variable-tree'

interface AddressSpaceTabProps {
  config: OpcUaServerConfig
  serverName: string
  onConfigChange: () => void
}

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

export const AddressSpaceTab = ({ config, serverName, onConfigChange }: AddressSpaceTabProps) => {
  const {
    projectActions: { updateOpcUaAddressSpaceNamespace, addOpcUaNode, updateOpcUaNode, removeOpcUaNode },
  } = useOpenPLCStore()

  // Get all project variables for the tree
  const projectVariables = useProjectVariables()

  // Local state
  const [filter, setFilter] = useState('')
  const [selectedVariableIds, setSelectedVariableIds] = useState<Set<string>>(() => {
    // Initialize with IDs of already configured nodes
    return new Set(config.addressSpace.nodes.map((n) => `${n.pouName}-${n.variablePath}`))
  })
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingVariable, setEditingVariable] = useState<VariableTreeNode | null>(null)
  const [editingConfig, setEditingConfig] = useState<OpcUaNodeConfig | undefined>(undefined)

  // Get existing node IDs for validation
  const existingNodeIds = useMemo(() => config.addressSpace.nodes.map((n) => n.nodeId), [config.addressSpace.nodes])

  // Handle namespace URI change
  const handleNamespaceChange = useCallback(
    (namespaceUri: string) => {
      updateOpcUaAddressSpaceNamespace(serverName, namespaceUri)
      onConfigChange()
    },
    [serverName, updateOpcUaAddressSpaceNamespace, onConfigChange],
  )

  // Handle variable selection from tree
  const handleVariableSelect = useCallback(
    (node: VariableTreeNode) => {
      if (!node.isSelectable) return

      // Check if already selected
      const nodeKey = `${node.pouName}-${node.variablePath}`
      if (selectedVariableIds.has(nodeKey)) {
        // Deselect - remove from config if it exists
        const existingNode = config.addressSpace.nodes.find(
          (n) => n.pouName === node.pouName && n.variablePath === node.variablePath,
        )
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
    [selectedVariableIds, config.addressSpace.nodes, serverName, removeOpcUaNode, onConfigChange],
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
      // Find the corresponding tree node
      const treeNode = findTreeNodeById(projectVariables, `${node.pouName}-${node.variablePath}`)
      if (treeNode) {
        setEditingVariable(treeNode)
        setEditingConfig(node)
        setIsModalOpen(true)
      }
    },
    [projectVariables],
  )

  // Handle remove from selected list
  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      const node = config.addressSpace.nodes.find((n) => n.id === nodeId)
      if (node) {
        removeOpcUaNode(serverName, nodeId)

        // Find the tree node to check if it's a complex type with descendants
        const nodeKey = `${node.pouName}-${node.variablePath}`
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
    [config.addressSpace.nodes, serverName, removeOpcUaNode, onConfigChange, projectVariables],
  )

  return (
    <div className='flex h-full flex-col gap-4'>
      {/* Header */}
      <div className='flex flex-col gap-2'>
        <p className='text-xs text-neutral-600 dark:text-neutral-400'>
          Select PLC variables to expose via OPC-UA. Variable indices are resolved automatically during project
          compilation.
        </p>
      </div>

      {/* Namespace URI */}
      <div className='flex flex-col gap-2'>
        <Label className='text-xs text-neutral-950 dark:text-white'>Namespace URI</Label>
        <InputWithRef
          type='text'
          value={config.addressSpace.namespaceUri}
          onChange={(e) => handleNamespaceChange(e.target.value)}
          placeholder='urn:openplc:opcua:namespace'
          className={inputStyles}
        />
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          Unique namespace identifier for your OPC-UA address space
        </span>
      </div>

      {/* Split Pane Layout */}
      <div className='flex flex-1 gap-4 overflow-hidden'>
        {/* Left Panel - Available Variables */}
        <div className='flex w-1/2 flex-col rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'>
          {/* Panel Header */}
          <div className='border-b border-neutral-200 p-3 dark:border-neutral-800'>
            <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
              Available PLC Variables
            </h3>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>Select variables to expose</p>
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
          <div className='flex-1 overflow-y-auto p-2'>
            <VariableTree
              nodes={projectVariables}
              selectedIds={selectedVariableIds}
              onSelect={handleVariableSelect}
              filter={filter}
            />
          </div>
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
          <div className='flex-1 overflow-y-auto p-2'>
            <SelectedVariablesList
              nodes={config.addressSpace.nodes}
              onEdit={handleEditNode}
              onRemove={handleRemoveNode}
            />
          </div>
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
