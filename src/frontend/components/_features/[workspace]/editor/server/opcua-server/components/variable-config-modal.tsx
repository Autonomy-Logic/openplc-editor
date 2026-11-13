import { cn } from '@root/frontend/utils/cn'
import { newUuid } from '@root/frontend/utils/new-uuid'
import {
  buildDefaultNodeConfig,
  isComplexTreeNode as isComplexType,
  MAX_BROWSE_NAME_LENGTH,
  MAX_NODE_ID_LENGTH,
} from '@root/frontend/utils/opcua/node-defaults'
import type { VariableTreeNode } from '@root/frontend/utils/opcua/types'
import type { OpcUaFieldConfig, OpcUaNodeConfig, OpcUaPermissions } from '@root/middleware/shared/ports/types'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { InputWithRef } from '../../../../../../_atoms/input'
import { Label } from '../../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../../_atoms/select'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../../../../../_molecules/modal'

interface VariableConfigModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (config: OpcUaNodeConfig) => void
  variable: VariableTreeNode | null
  existingConfig?: OpcUaNodeConfig
  existingNodeIds: string[]
}

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const textareaStyles =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-2 font-caption text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

type PermissionLevel = 'r' | 'w' | 'rw'

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
        setViewerPerm(existingConfig.permissions.viewer)
        setOperatorPerm(existingConfig.permissions.operator)
        setEngineerPerm(existingConfig.permissions.engineer)
        // Load existing field configs
        setFieldConfigs(existingConfig.fields || [])
      } else {
        // New configuration - generate defaults
        const defaults = buildDefaultNodeConfig(variable, () => '')
        setNodeId(defaults.nodeId)
        setBrowseName(defaults.browseName)
        setDisplayName(defaults.displayName)
        setDescription(defaults.description)
        setViewerPerm(defaults.permissions.viewer)
        setOperatorPerm(defaults.permissions.operator)
        setEngineerPerm(defaults.permissions.engineer)
        setFieldConfigs(defaults.fields ?? [])
      }
    }
  }, [isOpen, variable, existingConfig])

  // Validation
  const validationErrors = useMemo(() => {
    const errors: string[] = []

    if (!nodeId.trim()) {
      errors.push('Node ID is required')
    } else if (nodeId.length > MAX_NODE_ID_LENGTH) {
      errors.push(`Node ID must be ${MAX_NODE_ID_LENGTH} characters or less`)
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
    } else if (browseName.length > MAX_BROWSE_NAME_LENGTH) {
      errors.push(`Browse name must be ${MAX_BROWSE_NAME_LENGTH} characters or less`)
    }

    if (!displayName.trim()) {
      errors.push('Display name is required')
    } else if (displayName.length > 128) {
      errors.push('Display name must be 128 characters or less')
    }

    return errors
  }, [nodeId, browseName, displayName, existingNodeIds, existingConfig])

  const isValid = validationErrors.length === 0

  // Helper to recursively apply permissions to all fields including nested ones
  const applyPermissionsRecursively = useCallback(
    (fields: OpcUaFieldConfig[], permissions: OpcUaPermissions): OpcUaFieldConfig[] => {
      return fields.map((field) => ({
        ...field,
        permissions: { ...permissions },
        fields: field.fields ? applyPermissionsRecursively(field.fields, permissions) : undefined,
      }))
    },
    [],
  )

  // Apply parent permissions to all fields (including nested)
  const applyPermissionsToAllFields = useCallback(() => {
    const permissions: OpcUaPermissions = {
      viewer: viewerPerm,
      operator: operatorPerm,
      engineer: engineerPerm,
    }
    setFieldConfigs((prev) => applyPermissionsRecursively(prev, permissions))
  }, [viewerPerm, operatorPerm, engineerPerm, applyPermissionsRecursively])

  // Helper to recursively update a field's permission by path
  const updateFieldPermissionRecursively = useCallback(
    (
      fields: OpcUaFieldConfig[],
      fieldPath: string,
      role: 'viewer' | 'operator' | 'engineer',
      value: PermissionLevel,
    ): OpcUaFieldConfig[] => {
      return fields.map((field) => {
        if (field.fieldPath === fieldPath) {
          return { ...field, permissions: { ...field.permissions, [role]: value } }
        }
        if (field.fields) {
          return { ...field, fields: updateFieldPermissionRecursively(field.fields, fieldPath, role, value) }
        }
        return field
      })
    },
    [],
  )

  // Update a single field's permission (searches recursively)
  const updateFieldPermission = useCallback(
    (fieldPath: string, role: 'viewer' | 'operator' | 'engineer', value: PermissionLevel) => {
      setFieldConfigs((prev) => updateFieldPermissionRecursively(prev, fieldPath, role, value))
    },
    [updateFieldPermissionRecursively],
  )

  // Handle save
  const handleSave = useCallback(() => {
    if (!isValid || !variable) return

    const permissions: OpcUaPermissions = {
      viewer: viewerPerm,
      operator: operatorPerm,
      engineer: engineerPerm,
    }

    const config: OpcUaNodeConfig = {
      ...buildDefaultNodeConfig(variable, () => existingConfig?.id ?? newUuid()),
      nodeId: nodeId.trim(),
      browseName: browseName.trim(),
      displayName: displayName.trim(),
      description: description.trim(),
      permissions,
      fields: isComplex ? fieldConfigs : undefined,
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
      <ModalContent className={cn('max-h-[90vh]', isComplex ? 'w-[650px]' : 'w-[550px]')} onClose={onClose}>
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
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
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
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
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
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
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
            <div className='rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900'>
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
            <div className='rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900'>
              <ul className='list-inside list-disc space-y-1'>
                {validationErrors.map((error, index) => (
                  <li key={index} className='text-xs text-neutral-700 dark:text-neutral-300'>
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
