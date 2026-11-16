import { useOpenPLCStore } from '@root/frontend/store'
import { findInstanceName } from '@root/frontend/utils/debug-variable-finder'
import { newUuid } from '@root/frontend/utils/new-uuid'
import {
  anonymousAccess,
  bulkConfirmationMessage,
  exposableChildren,
  planBulkAdd,
  planBulkRemove,
  type SkipReport,
} from '@root/frontend/utils/opcua/bulk-selection'
import { isComplexTreeNode as isComplexType } from '@root/frontend/utils/opcua/node-defaults'
import { isGlobalScopePou } from '@root/frontend/utils/opcua/resolve-indices'
import { countTopLevelEntries, indexTree, treeIdForNode } from '@root/frontend/utils/opcua/tree-index'
import type { VariableTreeNode } from '@root/frontend/utils/opcua/types'
import { toast } from '@root/frontend/utils/toast'
import type { OpcUaNodeConfig, OpcUaServerConfig } from '@root/middleware/shared/ports/types'
import { useCallback, useEffect, useMemo, useState } from 'react'

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

/** The line a bulk action reports for each reason an entry was skipped. */
const SKIP_REASON_TEXT: Record<keyof SkipReport, string> = {
  'member-has-node': 'skipped: a member already has its own node',
  'filter-hides-part': 'skipped: only some members match the filter',
  'no-instance': 'skipped: program has no instance in Resources',
  'node-id-too-long': 'skipped: Node ID over 128 characters',
  'node-id-exists': 'skipped: Node ID already exists',
  'browse-name-too-long': 'skipped: Browse Name over 64 characters',
}

const reportSkipped = (skipped: SkipReport): void => {
  const lines = Object.entries(skipped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${SKIP_REASON_TEXT[reason as keyof SkipReport]} ${count}`)

  if (lines.length === 0) return

  toast({ title: 'Some entries were skipped', description: lines.join('\n'), variant: 'warn' })
}

/** A bulk action waiting on its confirmation; it carries everything the answer needs. */
type PendingBulk =
  | { kind: 'add'; message: string; nodes: OpcUaNodeConfig[]; skipped: SkipReport }
  | { kind: 'remove'; message: string; nodeIds: string[] }

export const AddressSpaceTab = ({ config, serverName, onConfigChange }: AddressSpaceTabProps) => {
  const {
    projectActions: { addOpcUaNode, addOpcUaNodes, updateOpcUaNode, removeOpcUaNode, removeOpcUaNodes },
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
  const [pendingBulk, setPendingBulk] = useState<PendingBulk | null>(null)
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
  const applyBulkAdd = useCallback(
    (nodes: OpcUaNodeConfig[], skipped: SkipReport) => {
      if (nodes.length > 0) {
        addOpcUaNodes(serverName, nodes)
        setSelectedVariableIds((prev) => {
          const next = new Set(prev)
          for (const node of nodes) {
            const treeId = treeIdForNode(node, treeIndex)
            next.add(treeId)
            const entry = treeIndex.get(treeId)
            if (entry) for (const id of getSelectableDescendantIds(entry)) next.add(id)
          }
          return next
        })
        onConfigChange()
      }
      reportSkipped(skipped)
    },
    [serverName, addOpcUaNodes, treeIndex, onConfigChange],
  )

  const applyBulkRemove = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) return
      const doomed = new Set(nodeIds)
      const removed = new Set(
        config.addressSpace.nodes.filter((node) => doomed.has(node.id)).map((node) => treeIdForNode(node, treeIndex)),
      )
      removeOpcUaNodes(serverName, nodeIds)
      setSelectedVariableIds((prev) => {
        const next = new Set(prev)
        for (const id of removed) {
          next.delete(id)
          const entry = treeIndex.get(id)
          if (entry) for (const descendant of getSelectableDescendantIds(entry)) next.delete(descendant)
        }
        return next
      })
      onConfigChange()
    },
    [config.addressSpace.nodes, treeIndex, serverName, removeOpcUaNodes, onConfigChange],
  )

  const runBulkAdd = useCallback(
    (groups: VariableTreeNode[]) => {
      if (isEditingLocked) return

      const plan = planBulkAdd({
        tree: groups,
        index: treeIndex,
        filter,
        existingNodes: config.addressSpace.nodes,
        instances,
        createId: newUuid,
      })

      const access = anonymousAccess(config.securityProfiles)
      if (access && plan.nodes.length > 0) {
        setPendingBulk({
          kind: 'add',
          message: bulkConfirmationMessage({
            count: plan.nodes.length,
            access,
            serverEnabled: config.server.enabled,
          }),
          nodes: plan.nodes,
          skipped: plan.skipped,
        })
        return
      }

      applyBulkAdd(plan.nodes, plan.skipped)
    },
    [
      isEditingLocked,
      treeIndex,
      filter,
      config.addressSpace.nodes,
      config.securityProfiles,
      config.server.enabled,
      instances,
      applyBulkAdd,
    ],
  )

  const runBulkRemove = useCallback(
    (groups: VariableTreeNode[], everyGroup = false) => {
      if (isEditingLocked) return

      const plan = planBulkRemove({
        groups,
        index: treeIndex,
        filter,
        existingNodes: config.addressSpace.nodes,
        everyGroup,
      })
      if (plan.nodeIds.length === 0) return

      setPendingBulk({
        kind: 'remove',
        message: `${plan.nodeIds.length} ${plan.nodeIds.length === 1 ? 'node' : 'nodes'} will be removed from the address space.`,
        nodeIds: plan.nodeIds,
      })
    },
    [isEditingLocked, treeIndex, filter, config.addressSpace.nodes],
  )

  const handleSelectAll = useCallback(() => runBulkAdd(projectVariables), [runBulkAdd, projectVariables])

  const handleRemoveAll = useCallback(() => runBulkRemove(projectVariables, true), [runBulkRemove, projectVariables])

  const isGroupFullyExposed = useCallback(
    (group: VariableTreeNode) => {
      const relevant = exposableChildren({
        group,
        index: treeIndex,
        filter,
        existingNodes: config.addressSpace.nodes,
      })
      return relevant.length > 0 && relevant.every((child) => selectedVariableIds.has(child.id))
    },
    [treeIndex, filter, config.addressSpace.nodes, selectedVariableIds],
  )

  /** A group whose exposable children are all exposed is unticked; otherwise it is ticked. */
  const handleSelectGroup = useCallback(
    (group: VariableTreeNode) => {
      if (isGroupFullyExposed(group)) {
        runBulkRemove([group])
        return
      }
      runBulkAdd([group])
    },
    [isGroupFullyExposed, runBulkAdd, runBulkRemove],
  )

  useEffect(() => {
    if (isEditingLocked) setPendingBulk(null)
  }, [isEditingLocked])

  const confirmPendingBulk = useCallback(() => {
    if (isEditingLocked) return
    if (!pendingBulk) return
    if (pendingBulk.kind === 'add') applyBulkAdd(pendingBulk.nodes, pendingBulk.skipped)
    else applyBulkRemove(pendingBulk.nodeIds)
    setPendingBulk(null)
  }, [isEditingLocked, pendingBulk, applyBulkAdd, applyBulkRemove])

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
    <div className='relative flex h-full flex-col gap-4'>
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
            <button
              type='button'
              onClick={handleSelectAll}
              disabled={isEditingLocked || entryCounts.shown === 0}
              className='mt-2 h-[24px] rounded-md border border-neutral-300 bg-white px-2 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
            >
              Select all
            </button>
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
          <EditingLockBoundary className='oplc-visible-scrollbar h-auto w-auto flex-1 overflow-y-auto p-2'>
            <VariableTree
              nodes={projectVariables}
              selectedIds={selectedVariableIds}
              onSelect={handleVariableSelect}
              onSelectGroup={handleSelectGroup}
              isGroupFullyExposed={isGroupFullyExposed}
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
            <button
              type='button'
              onClick={handleRemoveAll}
              disabled={isEditingLocked || config.addressSpace.nodes.length === 0}
              className='mt-2 h-[24px] rounded-md border border-neutral-300 bg-white px-2 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
            >
              Remove all
            </button>
          </div>

          {/* Selected Variables List */}
          <EditingLockBoundary className='oplc-visible-scrollbar h-auto w-auto flex-1 overflow-y-auto p-2'>
            <SelectedVariablesList
              nodes={config.addressSpace.nodes}
              missingNodeIds={missingNodeIds}
              onEdit={handleEditNode}
              onRemove={handleRemoveNode}
            />
          </EditingLockBoundary>
        </div>
      </div>

      {pendingBulk && (
        <div
          role='alertdialog'
          aria-label='Confirm the bulk action'
          className='absolute inset-0 z-50 flex items-center justify-center bg-black/30'
        >
          <div className='flex max-w-md flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
            <p className='font-caption text-sm text-neutral-950 dark:text-white'>{pendingBulk.message}</p>
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => setPendingBulk(null)}
                className='h-[28px] rounded-md border border-neutral-300 bg-white px-3 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={confirmPendingBulk}
                className='h-[28px] rounded-md bg-brand px-3 font-caption text-xs font-medium text-white hover:bg-brand-medium-dark'
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

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
