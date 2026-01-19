import { ArrowIcon, MinusIcon, PlusIcon } from '@root/renderer/assets/icons'
import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import TableActions from '@root/renderer/components/_atoms/table-actions'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/renderer/components/_molecules/modal'
import { useOpenPLCStore } from '@root/renderer/store'
import type { ModbusIOGroup, ModbusIOPoint } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

type FunctionCodeOption = {
  value: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'
  label: string
}

const FUNCTION_CODE_OPTIONS: FunctionCodeOption[] = [
  { value: '1', label: 'Read Coils (FC 1)' },
  { value: '2', label: 'Read Discrete Inputs (FC 2)' },
  { value: '3', label: 'Read Holding Registers (FC 3)' },
  { value: '4', label: 'Read Input Registers (FC 4)' },
  { value: '5', label: 'Write Single Coil (FC 5)' },
  { value: '6', label: 'Write Single Register (FC 6)' },
  { value: '15', label: 'Write Multiple Coils (FC 15)' },
  { value: '16', label: 'Write Multiple Registers (FC 16)' },
]

const ERROR_HANDLING_OPTIONS = [
  { value: 'keep-last-value', label: 'Keep last value' },
  { value: 'set-to-zero', label: 'Set to zero' },
]

const getFunctionCodeLabel = (fc: string): string => {
  const option = FUNCTION_CODE_OPTIONS.find((o) => o.value === fc)
  return option ? option.label : `FC ${fc}`
}

type IOGroupModalProps = {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'
    cycleTime: number
    offset: string
    length: number
    errorHandling: 'keep-last-value' | 'set-to-zero'
  }) => void
  editingGroup?: ModbusIOGroup | null
}

const IOGroupModal = ({ isOpen, onClose, onSubmit, editingGroup }: IOGroupModalProps) => {
  const [name, setName] = useState('')
  const [functionCode, setFunctionCode] = useState<'1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'>('3')
  const [cycleTime, setCycleTime] = useState('100')
  const [offset, setOffset] = useState('0')
  const [length, setLength] = useState('1')
  const [errorHandling, setErrorHandling] = useState<'keep-last-value' | 'set-to-zero'>('keep-last-value')

  // FC 5 (Write Single Coil) and FC 6 (Write Single Register) are single-element operations
  const isSingleElementOperation = functionCode === '5' || functionCode === '6'

  useEffect(() => {
    if (editingGroup) {
      setName(editingGroup.name)
      setFunctionCode(editingGroup.functionCode)
      setCycleTime(editingGroup.cycleTime.toString())
      setOffset(editingGroup.offset)
      // For single-element operations, length is always 1
      const isSingleElement = editingGroup.functionCode === '5' || editingGroup.functionCode === '6'
      setLength(isSingleElement ? '1' : editingGroup.length.toString())
      setErrorHandling(editingGroup.errorHandling)
    } else {
      setName('')
      setFunctionCode('3')
      setCycleTime('100')
      setOffset('0')
      setLength('1')
      setErrorHandling('keep-last-value')
    }
  }, [editingGroup, isOpen])

  // When function code changes, enforce length=1 for single-element operations
  useEffect(() => {
    if (isSingleElementOperation) {
      setLength('1')
    }
  }, [functionCode, isSingleElementOperation])

  const handleSubmit = () => {
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      functionCode,
      cycleTime: parseInt(cycleTime, 10) || 100,
      offset,
      length: parseInt(length, 10) || 1,
      errorHandling,
    })
    setName('')
    setFunctionCode('3')
    setCycleTime('100')
    setOffset('0')
    setLength('1')
    setErrorHandling('keep-last-value')
    onClose()
  }

  const inputStyles =
    'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className='w-[450px]' onClose={onClose}>
        <ModalHeader>
          <ModalTitle>{editingGroup ? 'Edit IO Group' : 'New IO Group'}</ModalTitle>
        </ModalHeader>
        <div className='flex flex-col gap-3 py-2'>
          <div className='flex items-center gap-2'>
            <Label className='w-28 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Name</Label>
            <InputWithRef
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='IO Group Name'
              className={inputStyles}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Label className='w-28 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Function Code</Label>
            <Select value={functionCode} onValueChange={(v) => setFunctionCode(v as typeof functionCode)}>
              <SelectTrigger
                withIndicator
                placeholder='Select function code'
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                {FUNCTION_CODE_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className={cn(
                      'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                      'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                    )}
                  >
                    <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center gap-2'>
            <Label className='w-28 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Cycle Time (ms)</Label>
            <InputWithRef
              type='number'
              value={cycleTime}
              onChange={(e) => setCycleTime(e.target.value)}
              placeholder='100'
              className={inputStyles}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Label className='w-28 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Offset</Label>
            <InputWithRef
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              placeholder='0'
              className={inputStyles}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Label className='w-28 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Length</Label>
            <InputWithRef
              type='number'
              value={length}
              onChange={(e) => {
                if (!isSingleElementOperation) setLength(e.target.value)
              }}
              placeholder='1'
              min='1'
              readOnly={isSingleElementOperation}
              className={isSingleElementOperation ? `${inputStyles} cursor-not-allowed opacity-50` : inputStyles}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Label className='w-28 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Error Handling</Label>
            <Select value={errorHandling} onValueChange={(v) => setErrorHandling(v as typeof errorHandling)}>
              <SelectTrigger
                withIndicator
                placeholder='Select error handling'
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent className='h-fit w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                {ERROR_HANDLING_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className={cn(
                      'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                      'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                    )}
                  >
                    <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <ModalFooter className='flex justify-end gap-2 pt-2'>
          <button
            onClick={onClose}
            className='rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className='rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
          >
            {editingGroup ? 'Save' : 'Create'}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

type IOGroupRowProps = {
  ioGroup: ModbusIOGroup
  isExpanded: boolean
  onToggleExpand: () => void
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onUpdateAlias: (ioPointId: string, alias: string) => void
}

const IOGroupRow = ({
  ioGroup,
  isExpanded,
  onToggleExpand,
  isSelected,
  onSelect,
  onEdit,
  onUpdateAlias,
}: IOGroupRowProps) => {
  const firstIOPoint = ioGroup.ioPoints[0]
  const groupType = firstIOPoint?.type || '-'
  const groupAddress = firstIOPoint?.iecLocation || '-'
  const groupOffset = ioGroup.offset

  return (
    <>
      <tr
        onClick={onSelect}
        onDoubleClick={onEdit}
        className={cn(
          'cursor-pointer border-b border-neutral-200 dark:border-neutral-800',
          isSelected && 'bg-brand/10 dark:bg-brand/20',
        )}
      >
        <td className='px-2 py-2'>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className='flex items-center justify-center'
          >
            <ArrowIcon
              direction='right'
              className={cn('h-4 w-4 stroke-brand-light transition-all', isExpanded && 'rotate-270 stroke-brand')}
            />
          </button>
        </td>
        <td className='px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'>{ioGroup.name}</td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{groupType}</td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{groupAddress}</td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{groupOffset}</td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>
          {getFunctionCodeLabel(ioGroup.functionCode)}
        </td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>-</td>
      </tr>
      {isExpanded &&
        ioGroup.ioPoints.map((ioPoint: ModbusIOPoint, index: number) => (
          <IOPointRow
            key={ioPoint.id}
            ioPoint={ioPoint}
            offset={parseInt(groupOffset, 10) + index}
            onUpdateAlias={(alias) => onUpdateAlias(ioPoint.id, alias)}
          />
        ))}
    </>
  )
}

type IOPointRowProps = {
  ioPoint: ModbusIOPoint
  offset: number
  onUpdateAlias: (alias: string) => void
}

const IOPointRow = ({ ioPoint, offset, onUpdateAlias }: IOPointRowProps) => {
  const [alias, setAlias] = useState(ioPoint.alias || '')

  const handleBlur = () => {
    if (alias !== ioPoint.alias) {
      onUpdateAlias(alias)
    }
  }

  return (
    <tr className='border-b border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900/50'>
      <td className='px-2 py-1'></td>
      <td className='px-2 py-1 pl-6 text-xs text-neutral-600 dark:text-neutral-400'>{ioPoint.name}</td>
      <td className='px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400'>{ioPoint.type}</td>
      <td className='px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400'>{ioPoint.iecLocation}</td>
      <td className='px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400'>{offset}</td>
      <td className='px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400'>-</td>
      <td className='px-2 py-1'>
        <InputWithRef
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onBlur={handleBlur}
          placeholder='Alias'
          className='h-6 w-full rounded border border-neutral-200 bg-white px-1 text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
        />
      </td>
    </tr>
  )
}

const RemoteDeviceEditor = () => {
  const { editor, project, projectActions, workspaceActions } = useOpenPLCStore()

  const deviceName = editor.type === 'plc-remote-device' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-remote-device' ? editor.meta.protocol : ''

  const remoteDevice = useMemo(() => {
    return project.data.remoteDevices?.find((d) => d.name === deviceName)
  }, [project.data.remoteDevices, deviceName])

  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('')
  const [slaveId, setSlaveId] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ModbusIOGroup | null>(null)

  useEffect(() => {
    if (remoteDevice?.modbusTcpConfig) {
      setHost(remoteDevice.modbusTcpConfig.host)
      setPort(remoteDevice.modbusTcpConfig.port.toString())
      setTimeoutMs(remoteDevice.modbusTcpConfig.timeout.toString())
      setSlaveId((remoteDevice.modbusTcpConfig.slaveId ?? 1).toString())
    } else {
      setHost('127.0.0.1')
      setPort('502')
      setTimeoutMs('1000')
      setSlaveId('1')
    }
  }, [remoteDevice])

  const ioGroups = remoteDevice?.modbusTcpConfig?.ioGroups || []

  const handleHostBlur = useCallback(() => {
    if (host !== remoteDevice?.modbusTcpConfig?.host) {
      projectActions.updateRemoteDeviceConfig(deviceName, { host })
      workspaceActions.setEditingState('unsaved')
    }
  }, [host, deviceName, remoteDevice?.modbusTcpConfig?.host, projectActions, workspaceActions])

  const handlePortBlur = useCallback(() => {
    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum !== remoteDevice?.modbusTcpConfig?.port) {
      projectActions.updateRemoteDeviceConfig(deviceName, { port: portNum })
      workspaceActions.setEditingState('unsaved')
    }
  }, [port, deviceName, remoteDevice?.modbusTcpConfig?.port, projectActions, workspaceActions])

  const handleTimeoutBlur = useCallback(() => {
    const timeoutNum = parseInt(timeoutMs, 10)
    if (!isNaN(timeoutNum) && timeoutNum !== remoteDevice?.modbusTcpConfig?.timeout) {
      projectActions.updateRemoteDeviceConfig(deviceName, { timeout: timeoutNum })
      workspaceActions.setEditingState('unsaved')
    }
  }, [timeoutMs, deviceName, remoteDevice?.modbusTcpConfig?.timeout, projectActions, workspaceActions])

  const handleSlaveIdBlur = useCallback(() => {
    const slaveIdNum = parseInt(slaveId, 10)
    if (
      !isNaN(slaveIdNum) &&
      slaveIdNum >= 0 &&
      slaveIdNum <= 255 &&
      slaveIdNum !== remoteDevice?.modbusTcpConfig?.slaveId
    ) {
      projectActions.updateRemoteDeviceConfig(deviceName, { slaveId: slaveIdNum })
      workspaceActions.setEditingState('unsaved')
    }
  }, [slaveId, deviceName, remoteDevice?.modbusTcpConfig?.slaveId, projectActions, workspaceActions])

  const handleToggleExpand = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }, [])

  const handleOpenAddModal = useCallback(() => {
    setEditingGroup(null)
    setIsModalOpen(true)
  }, [])

  const handleOpenEditModal = useCallback(
    (groupId: string) => {
      const group = ioGroups.find((g) => g.id === groupId)
      if (group) {
        setEditingGroup(group)
        setIsModalOpen(true)
      }
    },
    [ioGroups],
  )

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingGroup(null)
  }, [])

  const handleSubmitIOGroup = useCallback(
    (data: {
      name: string
      functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'
      cycleTime: number
      offset: string
      length: number
      errorHandling: 'keep-last-value' | 'set-to-zero'
    }) => {
      if (editingGroup) {
        projectActions.updateIOGroup(deviceName, editingGroup.id, data)
      } else {
        projectActions.addIOGroup(deviceName, {
          id: uuidv4(),
          ...data,
        })
      }
      workspaceActions.setEditingState('unsaved')
    },
    [deviceName, projectActions, editingGroup, workspaceActions],
  )

  const handleDeleteIOGroup = useCallback(() => {
    if (selectedGroupId) {
      projectActions.deleteIOGroup(deviceName, selectedGroupId)
      setSelectedGroupId(null)
      workspaceActions.setEditingState('unsaved')
    }
  }, [deviceName, selectedGroupId, projectActions, workspaceActions])

  const handleUpdateAlias = useCallback(
    (ioGroupId: string, ioPointId: string, alias: string) => {
      projectActions.updateIOPointAlias(deviceName, ioGroupId, ioPointId, alias)
      workspaceActions.setEditingState('unsaved')
    },
    [deviceName, projectActions, workspaceActions],
  )

  const inputStyles =
    'h-[30px] w-full max-w-[200px] rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

  if (protocol !== 'modbus-tcp') {
    return (
      <div aria-label='Remote device content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
        <div className='mb-4'>
          <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>Remote Device: {deviceName}</h2>
          <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: {protocol}</p>
        </div>
        <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700'>
          <p className='text-sm text-neutral-500 dark:text-neutral-400'>
            Configuration for this protocol is not yet available.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div aria-label='Remote device content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>Remote Device: {deviceName}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: Modbus/TCP</p>
      </div>

      <div className='mb-6 flex flex-wrap gap-6'>
        <div className='flex items-center gap-2'>
          <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>IP Address</Label>
          <InputWithRef
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onBlur={handleHostBlur}
            placeholder='127.0.0.1'
            className={inputStyles}
          />
        </div>
        <div className='flex items-center gap-2'>
          <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Port</Label>
          <InputWithRef
            type='number'
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onBlur={handlePortBlur}
            placeholder='502'
            className={inputStyles}
          />
        </div>
        <div className='flex items-center gap-2'>
          <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Response Timeout (ms)</Label>
          <InputWithRef
            type='number'
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(e.target.value)}
            onBlur={handleTimeoutBlur}
            placeholder='1000'
            className={inputStyles}
          />
        </div>
        <div className='flex items-center gap-2'>
          <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Slave ID</Label>
          <InputWithRef
            type='number'
            value={slaveId}
            onChange={(e) => setSlaveId(e.target.value)}
            onBlur={handleSlaveIdBlur}
            placeholder='1'
            min={0}
            max={255}
            className={inputStyles}
          />
        </div>
      </div>

      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='mb-2 flex items-center justify-between'>
          <h3 className='text-sm font-medium text-neutral-950 dark:text-neutral-100'>IO Tag Mapping</h3>
          <TableActions
            actions={[
              {
                ariaLabel: 'Add IO Group',
                onClick: handleOpenAddModal,
                icon: <PlusIcon className='h-4 w-4 stroke-brand' />,
                id: 'add-io-group-button',
              },
              {
                ariaLabel: 'Remove IO Group',
                onClick: handleDeleteIOGroup,
                disabled: !selectedGroupId,
                icon: <MinusIcon className='h-4 w-4 stroke-brand' />,
                id: 'remove-io-group-button',
              },
            ]}
            buttonProps={{
              className:
                'rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed',
            }}
          />
        </div>

        <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
          <table className='w-full table-fixed'>
            <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
              <tr>
                <th className='w-8 px-2 py-2'></th>
                <th className='w-[15%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Name
                </th>
                <th className='w-[20%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Type
                </th>
                <th className='w-[10%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Address
                </th>
                <th className='w-[8%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Offset
                </th>
                <th className='w-[22%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Function Code
                </th>
                <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Alias
                </th>
              </tr>
            </thead>
            <tbody>
              {ioGroups.length === 0 ? (
                <tr>
                  <td colSpan={7} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                    No IO groups configured. Click the + button to add one.
                  </td>
                </tr>
              ) : (
                ioGroups.map((ioGroup: ModbusIOGroup) => (
                  <IOGroupRow
                    key={ioGroup.id}
                    ioGroup={ioGroup}
                    isExpanded={expandedGroups.has(ioGroup.id)}
                    onToggleExpand={() => handleToggleExpand(ioGroup.id)}
                    isSelected={selectedGroupId === ioGroup.id}
                    onSelect={() => setSelectedGroupId(ioGroup.id)}
                    onEdit={() => handleOpenEditModal(ioGroup.id)}
                    onUpdateAlias={(ioPointId, alias) => handleUpdateAlias(ioGroup.id, ioPointId, alias)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <IOGroupModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSubmit={handleSubmitIOGroup}
        editingGroup={editingGroup}
      />
    </div>
  )
}

export { RemoteDeviceEditor }
