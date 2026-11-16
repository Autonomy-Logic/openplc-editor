import type { OpcUaFieldConfig, OpcUaNodeConfig, OpcUaPermissions } from '../../../middleware/shared/ports/types'
import type { VariableTreeNode } from './types'

export const DEFAULT_NODE_PERMISSIONS: OpcUaPermissions = { viewer: 'r', operator: 'r', engineer: 'rw' }

export const MAX_NODE_ID_LENGTH = 128
export const MAX_BROWSE_NAME_LENGTH = 64

export type NodeSkipReason =
  | 'member-has-node'
  | 'filter-hides-part'
  | 'no-instance'
  | 'node-id-too-long'
  | 'node-id-exists'
  | 'browse-name-too-long'

export type NodeValidationFailure = Extract<
  NodeSkipReason,
  'node-id-too-long' | 'node-id-exists' | 'browse-name-too-long'
>

export const isComplexTreeNode = (node: VariableTreeNode): boolean =>
  node.type === 'structure' || node.type === 'array' || node.type === 'function_block'

const generateNodeId = (pouName: string, variablePath: string): string =>
  `PLC.${pouName}.${variablePath.replace(/\[/g, '_').replace(/\]/g, '')}`

const lastSegment = (variablePath: string): string => {
  const parts = variablePath.split('.')
  return parts[parts.length - 1] || variablePath
}

const generateDisplayName = (variablePath: string): string => {
  const name = lastSegment(variablePath)
  let result = name.replace(/_/g, ' ')
  if (name !== name.toUpperCase()) {
    result = result.replace(/([a-z])([A-Z])/g, '$1 $2')
  }
  return result
    .replace(/^\s+/, '')
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const nodeTypeOf = (node: VariableTreeNode): 'variable' | 'structure' | 'array' => {
  if (node.type === 'array') return 'array'
  if (node.type === 'structure' || node.type === 'function_block') return 'structure'
  return 'variable'
}

const buildFieldConfigs = (node: VariableTreeNode, permissions: OpcUaPermissions): OpcUaFieldConfig[] => {
  if (!node.children || node.children.length === 0) return []

  return node.children.map((child) => {
    const isLeaf = child.type === 'variable' && (!child.children || child.children.length === 0)
    if (isLeaf) {
      return {
        fieldPath: child.name,
        displayName: child.name,
        datatype: child.variableType || 'UNKNOWN',
        permissions: { ...permissions },
      }
    }
    const nested = buildFieldConfigs(child, permissions)
    return {
      fieldPath: child.name,
      displayName: child.name,
      datatype: child.variableType || 'UNKNOWN',
      permissions: { ...permissions },
      fields: nested.length > 0 ? nested : undefined,
    }
  })
}

export function buildDefaultNodeConfig(node: VariableTreeNode, createId: () => string): OpcUaNodeConfig {
  const permissions: OpcUaPermissions = { ...DEFAULT_NODE_PERMISSIONS }

  return {
    id: createId(),
    pouName: node.pouName,
    variablePath: node.variablePath,
    variableType: node.variableType || 'unknown',
    nodeId: generateNodeId(node.pouName, node.variablePath),
    browseName: lastSegment(node.variablePath),
    displayName: generateDisplayName(node.variablePath),
    description: '',
    permissions,
    nodeType: nodeTypeOf(node),
    fields: isComplexTreeNode(node) ? buildFieldConfigs(node, permissions) : undefined,
    arrayLength: node.arrayInfo?.totalLength,
    elementType: node.arrayInfo?.elementType,
  }
}

/** The checks run in a fixed order, so an entry failing several is reported once. */
export function firstValidationFailure(
  config: OpcUaNodeConfig,
  takenNodeIdsLower: ReadonlySet<string>,
): NodeValidationFailure | null {
  if (config.nodeId.length > MAX_NODE_ID_LENGTH) return 'node-id-too-long'
  if (takenNodeIdsLower.has(config.nodeId.trim().toLowerCase())) return 'node-id-exists'
  if (config.browseName.length > MAX_BROWSE_NAME_LENGTH) return 'browse-name-too-long'
  return null
}
