import type { OpcUaNodeConfig } from '@root/types/PLC/open-plc'

interface SelectedVariablesListProps {
  nodes: OpcUaNodeConfig[]
  onEdit: (node: OpcUaNodeConfig) => void
  onRemove: (nodeId: string) => void
}

// Get icon component for node type
const NodeTypeIcon = ({ nodeType }: { nodeType: OpcUaNodeConfig['nodeType'] }) => {
  switch (nodeType) {
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
    default:
      return (
        <span className='flex h-4 w-4 items-center justify-center rounded bg-neutral-200 text-[9px] font-bold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'>
          V
        </span>
      )
  }
}

// Format permissions for display
const formatPermissions = (permissions: OpcUaNodeConfig['permissions']): string => {
  return `V:${permissions.viewer} O:${permissions.operator} E:${permissions.engineer}`
}

export const SelectedVariablesList = ({ nodes, onEdit, onRemove }: SelectedVariablesListProps) => {
  if (nodes.length === 0) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-center text-xs text-neutral-500 dark:text-neutral-400'>
          No variables selected. Select variables from the left panel to expose them via OPC-UA.
        </p>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2 overflow-y-auto'>
      {nodes.map((node) => (
        <div
          key={node.id}
          className='flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900'
        >
          {/* Header row with icon, name, and actions */}
          <div className='flex items-start justify-between'>
            <div className='flex items-start gap-2'>
              {/* Node Icon */}
              <div className='mt-0.5'>
                <NodeTypeIcon nodeType={node.nodeType} />
              </div>

              {/* Node Info */}
              <div className='flex flex-col gap-1'>
                <span className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
                  {node.displayName}
                </span>
                <span className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>{node.nodeId}</span>
              </div>
            </div>

            {/* Actions */}
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => onEdit(node)}
                className='h-[24px] rounded-md border border-neutral-300 bg-white px-2 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
              >
                Edit
              </button>
              <button
                type='button'
                onClick={() => onRemove(node.id)}
                className='h-[24px] rounded-md border border-red-300 bg-white px-2 font-caption text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-neutral-800 dark:text-red-400 dark:hover:bg-red-950'
              >
                Remove
              </button>
            </div>
          </div>

          {/* Details */}
          <div className='flex flex-col gap-1 pl-6'>
            <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
              <span className='font-medium'>Variable:</span> {node.pouName}:{node.variablePath}
            </p>
            <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
              <span className='font-medium'>Type:</span> {node.variableType}
            </p>
            <p className='font-caption text-xs text-neutral-500 dark:text-neutral-500'>
              <span className='font-medium'>Permissions:</span> {formatPermissions(node.permissions)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
