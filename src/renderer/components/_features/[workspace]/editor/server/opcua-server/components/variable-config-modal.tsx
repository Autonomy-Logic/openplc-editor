import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/renderer/components/_molecules/modal'
import type { OpcUaFieldConfig, OpcUaNodeConfig, OpcUaPermissions } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { isComplexType, type VariableTreeNode } from '../hooks/use-project-variables'

interface VariableConfigModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (config: OpcUaNodeConfig) => void
  variable: VariableTreeNode | null
  existingConfig?: OpcUaNodeConfig
  existingNodeIds: string[]
}

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const textareaStyles =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-2 font-caption text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

type PermissionLevel = 'r' | 'w' | 'rw'

/**
 * Generate a default node ID based on the variable path
 */
const generateNodeId = (pouName: string, variablePath: string): string => {
  const cleanPath = variablePath.replace(/\./g, '.').replace(/\[/g, '_').replace(/\]/g, '')
  return `PLC.${pouName}.${cleanPath}`
}

/**
 * Generate a browse name from the variable path
 */
const generateBrowseName = (variablePath: string): string => {
  const parts = variablePath.split('.')
  return parts[parts.length - 1] || variablePath
}

/**
 * Generate a display name from the variable path
 * Handles camelCase, snake_case, and ALL_CAPS naming conventions
 */
const generateDisplayName = (variablePath: string): string => {
  const parts = variablePath.split('.')
  const name = parts[parts.length - 1] || variablePath

  // First replace underscores with spaces
  let result = name.replace(/_/g, ' ')

  // Only add spaces before uppercase letters if the string is NOT all uppercase
  // This prevents "IRRIGATION MAIN CONTROLLER0" from becoming "I R R I G A T I O N..."
  const isAllUpperCase = name === name.toUpperCase()
  if (!isAllUpperCase) {
    // For camelCase/PascalCase: add space before uppercase letters
    result = result.replace(/([a-z])([A-Z])/g, '$1 $2')
  }

  // Convert to Title Case
  return result
    .replace(/^\s+/, '')
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Get default initial value based on type
 */
const getDefaultInitialValue = (variableType?: string): string | number | boolean => {
  if (!variableType) return 0
  const type = variableType.toLowerCase()

  if (type === 'bool') return false
  if (type.includes('real') || type.includes('lreal')) return 0.0
  if (type.includes('string')) return ''
  return 0
}

/**
 * Determine node type from variable tree node
 */
const getNodeType = (node: VariableTreeNode): 'variable' | 'structure' | 'array' => {
  if (node.type === 'array') return 'array'
  if (node.type === 'structure' || node.type === 'function_block') return 'structure'
  return 'variable'
}

/**
 * Generate default field configs from a structure/FB/array node.
 * Generates hierarchical nested field configs to preserve structure in OPC-UA.
 * Complex types (FBs, nested structs) become fields with nested fields array.
 */
const generateDefaultFieldConfigs = (
  node: VariableTreeNode,
  parentPermissions: OpcUaPermissions,
): OpcUaFieldConfig[] => {
  if (!node.children || node.children.length === 0) {
    return []
  }

  return node.children.map((child) => {
    // Check if this is a leaf variable (base type) or a complex type
    const isLeaf = child.type === 'variable' && (!child.children || child.children.length === 0)

    if (isLeaf) {
      // Leaf field - no nested fields
      return {
        fieldPath: child.name,
        displayName: child.name,
        datatype: child.variableType || 'UNKNOWN',
        initialValue: getDefaultInitialValue(child.variableType || 'UNKNOWN'),
        permissions: { ...parentPermissions },
      }
    } else {
      // Complex type (FB, struct, array) - generate nested fields recursively
      const nestedFields = generateDefaultFieldConfigs(child, parentPermissions)
      return {
        fieldPath: child.name,
        displayName: child.name,
        datatype: child.variableType || 'UNKNOWN',
        initialValue: getDefaultInitialValue(child.variableType || 'UNKNOWN'),
        permissions: { ...parentPermissions },
        fields: nestedFields.length > 0 ? nestedFields : undefined,
      }
    }
  })
}

/**
 * Permission selector component for inline use in tables
 */
const PermissionSelect = ({
  value,
  onChange,
  className,
}: {
  value: PermissionLevel
  onChange: (value: PermissionLevel) => void
  className?: string
}) => (
  <Select value={value} onValueChange={(v) => onChange(v as PermissionLevel)}>
    <SelectTrigger
      withIndicator
      placeholder='Select'
      className={cn(
        'flex h-[24px] w-[70px] items-center justify-between gap-1 rounded border border-neutral-300 bg-white px-1 font-caption text-[10px] font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300',
        className,
      )}
    />
    <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
      <SelectItem
        value='r'
        className='flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
      >
        <span className='text-start font-caption text-[10px] font-normal text-neutral-700 dark:text-neutral-100'>
          R
        </span>
      </SelectItem>
      <SelectItem
        value='w'
        className='flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
      >
        <span className='text-start font-caption text-[10px] font-normal text-neutral-700 dark:text-neutral-100'>
          W
        </span>
      </SelectItem>
      <SelectItem
        value='rw'
        className='flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
      >
        <span className='text-start font-caption text-[10px] font-normal text-neutral-700 dark:text-neutral-100'>
          RW
        </span>
      </SelectItem>
    </SelectContent>
  </Select>
)

export const VariableConfigModal = ({
  isOpen,
  onClose,
  onSave,
  variable,
  existingConfig,
  existingNodeIds,
}: VariableConfigModalProps) => {
  // Form state
  const [nodeId, setNodeId] = useState('')
  const [browseName, setBrowseName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [initialValue, setInitialValue] = useState<string>('')
  const [viewerPerm, setViewerPerm] = useState<PermissionLevel>('r')
  const [operatorPerm, setOperatorPerm] = useState<PermissionLevel>('r')
  const [engineerPerm, setEngineerPerm] = useState<PermissionLevel>('rw')

  // Field configurations (for structures/arrays)
  const [fieldConfigs, setFieldConfigs] = useState<OpcUaFieldConfig[]>([])

  // Check if this is a complex type
  const isStructureOrFb = variable && (variable.type === 'structure' || variable.type === 'function_block')
  const isArray = variable && variable.type === 'array'
  const isComplex = variable && isComplexType(variable)

  // Initialize form when modal opens or variable changes
  useEffect(() => {
    if (isOpen && variable) {
      if (existingConfig) {
        // Editing existing configuration
        setNodeId(existingConfig.nodeId)
        setBrowseName(existingConfig.browseName)
        setDisplayName(existingConfig.displayName)
        setDescription(existingConfig.description)
        setInitialValue(String(existingConfig.initialValue))
        setViewerPerm(existingConfig.permissions.viewer)
        setOperatorPerm(existingConfig.permissions.operator)
        setEngineerPerm(existingConfig.permissions.engineer)
        // Load existing field configs
        setFieldConfigs(existingConfig.fields || [])
      } else {
        // New configuration - generate defaults
        setNodeId(generateNodeId(variable.pouName, variable.variablePath))
        setBrowseName(generateBrowseName(variable.variablePath))
        setDisplayName(generateDisplayName(variable.variablePath))
        setDescription('')
        setInitialValue(String(getDefaultInitialValue(variable.variableType)))
        setViewerPerm('r')
        setOperatorPerm('r')
        setEngineerPerm('rw')
        // Generate default field configs for complex types
        const defaultPerms: OpcUaPermissions = { viewer: 'r', operator: 'r', engineer: 'rw' }
        setFieldConfigs(isComplexType(variable) ? generateDefaultFieldConfigs(variable, defaultPerms) : [])
      }
    }
  }, [isOpen, variable, existingConfig])

  // Validation
  const validationErrors = useMemo(() => {
    const errors: string[] = []

    if (!nodeId.trim()) {
      errors.push('Node ID is required')
    } else if (nodeId.length > 128) {
      errors.push('Node ID must be 128 characters or less')
    } else {
      // Check for duplicate Node ID (excluding current node if editing)
      const isDuplicate = existingNodeIds.some((id) => {
        if (existingConfig && existingConfig.nodeId === id) return false
        return id.toLowerCase() === nodeId.trim().toLowerCase()
      })
      if (isDuplicate) {
        errors.push('A node with this ID already exists')
      }
    }

    if (!browseName.trim()) {
      errors.push('Browse name is required')
    } else if (browseName.length > 64) {
      errors.push('Browse name must be 64 characters or less')
    }

    if (!displayName.trim()) {
      errors.push('Display name is required')
    } else if (displayName.length > 128) {
      errors.push('Display name must be 128 characters or less')
    }

    return errors
  }, [nodeId, browseName, displayName, existingNodeIds, existingConfig])

  const isValid = validationErrors.length === 0

  // Apply parent permissions to all fields
  const applyPermissionsToAllFields = useCallback(() => {
    setFieldConfigs((prev) =>
      prev.map((field) => ({
        ...field,
        permissions: {
          viewer: viewerPerm,
          operator: operatorPerm,
          engineer: engineerPerm,
        },
      })),
    )
  }, [viewerPerm, operatorPerm, engineerPerm])

  // Update a single field's permission
  const updateFieldPermission = useCallback(
    (fieldPath: string, role: 'viewer' | 'operator' | 'engineer', value: PermissionLevel) => {
      setFieldConfigs((prev) =>
        prev.map((field) =>
          field.fieldPath === fieldPath ? { ...field, permissions: { ...field.permissions, [role]: value } } : field,
        ),
      )
    },
    [],
  )

  // Handle save
  const handleSave = useCallback(() => {
    if (!isValid || !variable) return

    // Parse initial value based on type
    let parsedInitialValue: boolean | number | string = initialValue
    const varType = variable.variableType?.toLowerCase() || ''
    if (varType === 'bool') {
      parsedInitialValue = initialValue.toLowerCase() === 'true' || initialValue === '1'
    } else if (
      varType.includes('int') ||
      varType.includes('real') ||
      varType.includes('word') ||
      varType.includes('byte')
    ) {
      const num = parseFloat(initialValue)
      parsedInitialValue = isNaN(num) ? 0 : num
    }

    const permissions: OpcUaPermissions = {
      viewer: viewerPerm,
      operator: operatorPerm,
      engineer: engineerPerm,
    }

    const config: OpcUaNodeConfig = {
      id: existingConfig?.id || uuidv4(),
      pouName: variable.pouName,
      variablePath: variable.variablePath,
      variableType: variable.variableType || 'unknown',
      nodeId: nodeId.trim(),
      browseName: browseName.trim(),
      displayName: displayName.trim(),
      description: description.trim(),
      initialValue: parsedInitialValue,
      permissions,
      nodeType: getNodeType(variable),
      // Include field configs for complex types
      fields: isComplex ? fieldConfigs : undefined,
      // Include array info if applicable
      arrayLength: variable.arrayInfo?.totalLength,
      elementType: variable.arrayInfo?.elementType,
    }

    onSave(config)
    onClose()
  }, [
    isValid,
    variable,
    nodeId,
    browseName,
    displayName,
    description,
    initialValue,
    viewerPerm,
    operatorPerm,
    engineerPerm,
    existingConfig,
    isComplex,
    fieldConfigs,
    onSave,
    onClose,
  ])

  if (!variable) return null

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className={cn('h-auto max-h-[90vh]', isComplex ? 'w-[650px]' : 'w-[550px]')} onClose={onClose}>
        <ModalHeader>
          <ModalTitle>{existingConfig ? 'Edit' : 'Configure'} OPC-UA Node</ModalTitle>
        </ModalHeader>

        <div className='flex flex-1 flex-col gap-4 overflow-y-auto'>
          {/* Variable Info */}
          <div className='rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900'>
            <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
              <span className='font-medium'>PLC Variable:</span> {variable.pouName}:{variable.variablePath}
            </p>
            <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
              <span className='font-medium'>Type:</span> {variable.variableType || 'Unknown'}
            </p>
          </div>

          {/* Node ID */}
          <div className='flex flex-col gap-2'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Node ID</Label>
            <InputWithRef
              type='text'
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              placeholder='e.g., PLC.Main.MotorSpeed'
              maxLength={128}
              className={inputStyles}
            />
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              Unique identifier in the OPC-UA address space
            </span>
          </div>

          {/* Browse Name & Display Name */}
          <div className='grid grid-cols-2 gap-4'>
            <div className='flex flex-col gap-2'>
              <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Browse Name</Label>
              <InputWithRef
                type='text'
                value={browseName}
                onChange={(e) => setBrowseName(e.target.value)}
                placeholder='e.g., MotorSpeed'
                maxLength={64}
                className={inputStyles}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Display Name</Label>
              <InputWithRef
                type='text'
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder='e.g., Motor Speed'
                maxLength={128}
                className={inputStyles}
              />
            </div>
          </div>

          {/* Description */}
          <div className='flex flex-col gap-2'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='Optional description for this node'
              rows={2}
              className={textareaStyles}
            />
          </div>

          {/* Initial Value */}
          <div className='flex flex-col gap-2'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Initial Value</Label>
            <InputWithRef
              type='text'
              value={initialValue}
              onChange={(e) => setInitialValue(e.target.value)}
              placeholder={variable.variableType?.toLowerCase() === 'bool' ? 'true/false' : '0'}
              className={inputStyles}
            />
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              Default value when the OPC-UA server starts
            </span>
          </div>

          {/* Permissions */}
          <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
            <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>Access Permissions</h4>

            <div className='grid grid-cols-3 gap-4'>
              {/* Viewer Permission */}
              <div className='flex flex-col gap-2'>
                <Label className='text-xs text-neutral-700 dark:text-neutral-300'>Viewer</Label>
                <Select value={viewerPerm} onValueChange={(v) => setViewerPerm(v as PermissionLevel)}>
                  <SelectTrigger
                    withIndicator
                    placeholder='Select'
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                    <SelectItem
                      value='r'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Read Only
                      </span>
                    </SelectItem>
                    <SelectItem
                      value='w'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Write Only
                      </span>
                    </SelectItem>
                    <SelectItem
                      value='rw'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Read/Write
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Operator Permission */}
              <div className='flex flex-col gap-2'>
                <Label className='text-xs text-neutral-700 dark:text-neutral-300'>Operator</Label>
                <Select value={operatorPerm} onValueChange={(v) => setOperatorPerm(v as PermissionLevel)}>
                  <SelectTrigger
                    withIndicator
                    placeholder='Select'
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                    <SelectItem
                      value='r'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Read Only
                      </span>
                    </SelectItem>
                    <SelectItem
                      value='w'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Write Only
                      </span>
                    </SelectItem>
                    <SelectItem
                      value='rw'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Read/Write
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Engineer Permission */}
              <div className='flex flex-col gap-2'>
                <Label className='text-xs text-neutral-700 dark:text-neutral-300'>Engineer</Label>
                <Select value={engineerPerm} onValueChange={(v) => setEngineerPerm(v as PermissionLevel)}>
                  <SelectTrigger
                    withIndicator
                    placeholder='Select'
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                    <SelectItem
                      value='r'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Read Only
                      </span>
                    </SelectItem>
                    <SelectItem
                      value='w'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Write Only
                      </span>
                    </SelectItem>
                    <SelectItem
                      value='rw'
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        Read/Write
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              Configure access permissions for each user role
            </p>
          </div>

          {/* Array Info */}
          {isArray && variable?.arrayInfo && (
            <div className='rounded-lg border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-900 dark:bg-cyan-950'>
              <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>Array Information</h4>
              <div className='mt-2 grid grid-cols-2 gap-2'>
                <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                  <span className='font-medium'>Dimensions:</span> [{variable.arrayInfo.dimensions.join(', ')}]
                </p>
                <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                  <span className='font-medium'>Element Type:</span> {variable.arrayInfo.elementType}
                </p>
                <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                  <span className='font-medium'>Total Elements:</span> {variable.arrayInfo.totalLength}
                </p>
              </div>
            </div>
          )}

          {/* Structure Info */}
          {isStructureOrFb && variable?.structureInfo && (
            <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950'>
              <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>
                Structure Information
              </h4>
              <div className='mt-2 grid grid-cols-2 gap-2'>
                <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                  <span className='font-medium'>Type:</span> {variable.structureInfo.structTypeName}
                </p>
                <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                  <span className='font-medium'>Fields:</span> {variable.structureInfo.fieldCount}
                </p>
              </div>
            </div>
          )}

          {/* Field Permissions Table (for structures/FBs) */}
          {isComplex && fieldConfigs.length > 0 && (
            <div className='flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
              <div className='flex items-center justify-between'>
                <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>
                  Field Permissions ({fieldConfigs.length} fields)
                </h4>
                <button
                  type='button'
                  onClick={applyPermissionsToAllFields}
                  className='h-[24px] rounded border border-neutral-300 bg-white px-2 font-caption text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
                >
                  Apply Parent Permissions to All
                </button>
              </div>

              {/* Table */}
              <div className='max-h-[200px] overflow-y-auto rounded border border-neutral-200 dark:border-neutral-700'>
                <table className='w-full text-xs'>
                  <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-800'>
                    <tr>
                      <th className='px-2 py-1.5 text-left font-medium text-neutral-700 dark:text-neutral-300'>
                        Field
                      </th>
                      <th className='px-2 py-1.5 text-center font-medium text-neutral-700 dark:text-neutral-300'>
                        Viewer
                      </th>
                      <th className='px-2 py-1.5 text-center font-medium text-neutral-700 dark:text-neutral-300'>
                        Operator
                      </th>
                      <th className='px-2 py-1.5 text-center font-medium text-neutral-700 dark:text-neutral-300'>
                        Engineer
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldConfigs.map((field, index) => (
                      <tr
                        key={field.fieldPath}
                        className={cn(
                          'border-t border-neutral-200 dark:border-neutral-700',
                          index % 2 === 0 ? 'bg-white dark:bg-neutral-900' : 'bg-neutral-50 dark:bg-neutral-850',
                        )}
                      >
                        <td className='px-2 py-1.5'>
                          <span className='font-medium text-neutral-950 dark:text-white'>{field.displayName}</span>
                        </td>
                        <td className='px-2 py-1.5 text-center'>
                          <PermissionSelect
                            value={field.permissions.viewer}
                            onChange={(v) => updateFieldPermission(field.fieldPath, 'viewer', v)}
                          />
                        </td>
                        <td className='px-2 py-1.5 text-center'>
                          <PermissionSelect
                            value={field.permissions.operator}
                            onChange={(v) => updateFieldPermission(field.fieldPath, 'operator', v)}
                          />
                        </td>
                        <td className='px-2 py-1.5 text-center'>
                          <PermissionSelect
                            value={field.permissions.engineer}
                            onChange={(v) => updateFieldPermission(field.fieldPath, 'engineer', v)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                Configure individual permissions for each field. Use "Apply Parent Permissions" to set all fields to
                match the parent variable.
              </p>
            </div>
          )}

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className='rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950'>
              <ul className='list-inside list-disc space-y-1'>
                {validationErrors.map((error, index) => (
                  <li key={index} className='text-xs text-red-600 dark:text-red-400'>
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <ModalFooter className='mt-4 flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='h-[32px] rounded-md border border-neutral-300 bg-white px-4 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={handleSave}
            disabled={!isValid}
            className={cn(
              'h-[32px] rounded-md bg-brand px-4 font-caption text-xs font-medium text-white hover:bg-brand-medium-dark',
              !isValid && 'cursor-not-allowed opacity-50',
            )}
          >
            {existingConfig ? 'Save Changes' : 'Add to Address Space'}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
