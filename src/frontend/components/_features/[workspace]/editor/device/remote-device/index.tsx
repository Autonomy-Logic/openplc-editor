import { Pencil1Icon, TrashIcon } from '@radix-ui/react-icons'
import type { ModbusIOGroup, ModbusIOPoint } from '@root/middleware/shared/ports/types'
import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { ArrowIcon } from '../../../../../../assets/icons/interface/Arrow'
import { PlusIcon } from '../../../../../../assets/icons/interface/Plus'
import { useOpenPLCStore } from '../../../../../../store'
import { cn } from '../../../../../../utils/cn'
import { getErrorMessage } from '../../../../../../utils/get-error-message'
import { GenericComboboxCell } from '../../../../../_atoms/generic-table-inputs/generic-combobox-cell'
import { InputWithRef } from '../../../../../_atoms/input'
import { Label } from '../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'
import TableActions from '../../../../../_atoms/table-actions'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../../../../_molecules/modal'

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

// Modbus transport type options
const TRANSPORT_OPTIONS = [
  { value: 'tcp', label: 'TCP/IP' },
  { value: 'rtu', label: 'RTU (Serial)' },
]

// Default serial port for RTU devices.  Pre-filled as a real value (not
// just the combobox placeholder) so it is persisted to the device config
// and reaches the compiler — an empty serial port makes the runtime drop
// the Modbus master plugin entirely.
const DEFAULT_SERIAL_PORT = '/dev/ttyUSB0'

// RTU configuration options
const BAUD_RATE_OPTIONS = [
  { value: '9600', label: '9600' },
  { value: '19200', label: '19200' },
  { value: '38400', label: '38400' },
  { value: '57600', label: '57600' },
  { value: '115200', label: '115200' },
]

const PARITY_OPTIONS = [
  { value: 'N', label: 'None' },
  { value: 'E', label: 'Even' },
  { value: 'O', label: 'Odd' },
]

const STOP_BITS_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
]

const DATA_BITS_OPTIONS = [
  { value: '7', label: '7' },
  { value: '8', label: '8' },
]

// Slave ID validation ranges per transport type
const SLAVE_ID_TCP_MIN = 0
const SLAVE_ID_TCP_MAX = 255
const SLAVE_ID_RTU_MIN = 1
const SLAVE_ID_RTU_MAX = 247

type SerialPortOption = {
  value: string
  label: string
}

type SerialPortComboboxProps = {
  value: string
  onValueChange: (value: string) => void
  options: SerialPortOption[]
  isLoading?: boolean
  placeholder?: string
}

// Field-style trigger (bordered, chevron) matching the other RTU config fields.
const SERIAL_PORT_TRIGGER_CLASS =
  'flex h-[30px] w-full max-w-[200px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-normal text-neutral-700 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-100'

/**
 * Editable serial-port picker for RTU devices.
 *
 * A thin wrapper over the shared GenericComboboxCell — the single combobox in the
 * app. Runtime-discovered ports populate the list (filterable, case-insensitive),
 * and the user can still type a custom device path (`canAddACustomOption`) that
 * propagates verbatim through onValueChange to the device config.
 */
const SerialPortCombobox = ({
  value,
  onValueChange,
  options,
  isLoading = false,
  placeholder = '/dev/ttyUSB0',
}: SerialPortComboboxProps) => {
  // Map runtime ports to options. The device path is the value that propagates;
  // the human description (when distinct) is appended to the visible label.
  const selectValues = useMemo(
    () =>
      isLoading
        ? []
        : options.map((opt) => ({
            id: opt.value,
            value: opt.value,
            label: opt.label && opt.label !== opt.value ? `${opt.value} — ${opt.label}` : opt.value,
          })),
    [options, isLoading],
  )

  return (
    <GenericComboboxCell
      value={value}
      onValueChange={onValueChange}
      selectValues={selectValues}
      displayLabel={value || placeholder}
      canAddACustomOption
      showClearOption={false}
      showChevron
      triggerClassName={SERIAL_PORT_TRIGGER_CLASS}
      placeholder={placeholder}
      customValueLabel='Use custom port'
      emptyMessage={isLoading ? 'Loading ports...' : 'No ports available. Type a custom value.'}
    />
  )
}

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
  onEdit: () => void
  onDelete: () => void
  onUpdateAlias: (ioPointId: string, alias: string) => void
}

const IOGroupRow = ({ ioGroup, isExpanded, onToggleExpand, onEdit, onDelete, onUpdateAlias }: IOGroupRowProps) => {
  const firstIOPoint = ioGroup.ioPoints?.[0]
  const groupType = firstIOPoint?.type || '-'
  const groupAddress = firstIOPoint?.iecLocation || '-'
  const groupOffset = ioGroup.offset

  return (
    <>
      <tr className='border-b border-neutral-200 dark:border-neutral-800'>
        <td className='px-2 py-2'>
          <button onClick={onToggleExpand} className='flex items-center justify-center'>
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
        <td className='px-2 py-2'>
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={onEdit}
              className='rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
              title='Edit'
              aria-label={`Edit ${ioGroup.name}`}
            >
              <Pencil1Icon className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onDelete}
              className='rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-900/30 dark:hover:text-red-400'
              title='Delete'
              aria-label={`Delete ${ioGroup.name}`}
            >
              <TrashIcon className='h-4 w-4' />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded &&
        (ioGroup.ioPoints ?? []).map((ioPoint: ModbusIOPoint, index: number) => (
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
      <td className='px-2 py-1'></td>
    </tr>
  )
}

const RemoteDeviceEditor = () => {
  const { editor, project, projectActions, sharedWorkspaceActions, runtimeConnection, consoleActions } =
    useOpenPLCStore()
  const runtime = useRuntime()

  const deviceName = editor.type === 'plc-remote-device' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-remote-device' ? editor.meta.protocol : ''

  const remoteDevice = useMemo(() => {
    return project.data.remoteDevices?.find((d) => d.name === deviceName)
  }, [project.data.remoteDevices, deviceName])

  // Runtime connection state
  const { connectionStatus, jwtToken } = runtimeConnection
  const isConnectedToRuntime = connectionStatus === 'connected' && jwtToken !== null

  // Serial port options state
  const [serialPortOptions, setSerialPortOptions] = useState<SerialPortOption[]>([])
  const [isLoadingSerialPorts, setIsLoadingSerialPorts] = useState(false)

  // Transport type state
  const [transport, setTransport] = useState<'tcp' | 'rtu'>('tcp')

  // TCP-specific state
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')

  // RTU-specific state
  const [serialPort, setSerialPort] = useState('')
  const [baudRate, setBaudRate] = useState('9600')
  const [parity, setParity] = useState<'N' | 'E' | 'O'>('N')
  const [stopBits, setStopBits] = useState('1')
  const [dataBits, setDataBits] = useState('8')

  // Common state
  const [timeout, setTimeout] = useState('')
  const [slaveId, setSlaveId] = useState('')

  // UI state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ModbusIOGroup | null>(null)

  useEffect(() => {
    if (remoteDevice?.modbusTcpConfig) {
      const config = remoteDevice.modbusTcpConfig
      // Transport type (defaults to 'tcp' for backward compatibility)
      setTransport(config.transport || 'tcp')
      // TCP fields
      setHost(config.host ?? '127.0.0.1')
      setPort((config.port ?? 502).toString())
      // RTU fields — show the default serial port as a real value when
      // none is stored (the self-heal effect below persists it).
      setSerialPort(config.serialPort || DEFAULT_SERIAL_PORT)
      setBaudRate((config.baudRate ?? 9600).toString())
      setParity(config.parity ?? 'N')
      setStopBits((config.stopBits ?? 1).toString())
      setDataBits((config.dataBits ?? 8).toString())
      // Common fields
      setTimeout(config.timeout.toString())
      setSlaveId((config.slaveId ?? 1).toString())
    } else {
      setTransport('tcp')
      setHost('127.0.0.1')
      setPort('502')
      setSerialPort(DEFAULT_SERIAL_PORT)
      setBaudRate('9600')
      setParity('N')
      setStopBits('1')
      setDataBits('8')
      setTimeout('1000')
      setSlaveId('1')
    }
  }, [remoteDevice])

  // Self-heal: an RTU device must carry a concrete serial port, otherwise
  // the compiler silently drops it from the Modbus master config.  The UI
  // shows DEFAULT_SERIAL_PORT as a real value, so persist it whenever the
  // stored config has none — keeping disk in sync with what's displayed
  // and fixing projects saved before the serial port was pre-filled.
  useEffect(() => {
    const config = remoteDevice?.modbusTcpConfig
    if (config && (config.transport ?? 'tcp') === 'rtu' && !config.serialPort) {
      projectActions.updateRemoteDeviceConfig(deviceName, { serialPort: DEFAULT_SERIAL_PORT })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    }
  }, [remoteDevice, deviceName, projectActions, sharedWorkspaceActions])

  const ioGroups = useMemo(
    () => remoteDevice?.modbusTcpConfig?.ioGroups || [],
    [remoteDevice?.modbusTcpConfig?.ioGroups],
  )

  // Fetch serial ports from runtime when transport is RTU and connected
  const fetchSerialPorts = useCallback(async () => {
    if (!isConnectedToRuntime) {
      setSerialPortOptions([])
      return
    }

    setIsLoadingSerialPorts(true)
    try {
      const result = await runtime.getSerialPorts()

      if (result.success && result.ports) {
        const options: SerialPortOption[] = result.ports.map((p) => ({
          value: p.device,
          label: p.description || p.device,
        }))
        setSerialPortOptions(options)
      } else {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `Failed to fetch serial ports: ${result.error || 'Unknown error'}`,
        })
        setSerialPortOptions([])
      }
    } catch (error) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'warning',
        message: `Error fetching serial ports: ${getErrorMessage(error)}`,
      })
      setSerialPortOptions([])
    } finally {
      setIsLoadingSerialPorts(false)
    }
  }, [isConnectedToRuntime, runtime, consoleActions])

  // Fetch serial ports when transport changes to RTU or when runtime connection changes
  useEffect(() => {
    if (transport === 'rtu') {
      void fetchSerialPorts()
    }
  }, [transport, isConnectedToRuntime, fetchSerialPorts])

  const handleHostBlur = useCallback(() => {
    if (host !== remoteDevice?.modbusTcpConfig?.host) {
      projectActions.updateRemoteDeviceConfig(deviceName, { host })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    }
  }, [host, deviceName, remoteDevice?.modbusTcpConfig?.host, projectActions, sharedWorkspaceActions])

  const handlePortBlur = useCallback(() => {
    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum !== remoteDevice?.modbusTcpConfig?.port) {
      projectActions.updateRemoteDeviceConfig(deviceName, { port: portNum })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    }
  }, [port, deviceName, remoteDevice?.modbusTcpConfig?.port, projectActions, sharedWorkspaceActions])

  const handleTimeoutBlur = useCallback(() => {
    const timeoutNum = parseInt(timeout, 10)
    if (!isNaN(timeoutNum) && timeoutNum !== remoteDevice?.modbusTcpConfig?.timeout) {
      projectActions.updateRemoteDeviceConfig(deviceName, { timeout: timeoutNum })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    }
  }, [timeout, deviceName, remoteDevice?.modbusTcpConfig?.timeout, projectActions, sharedWorkspaceActions])

  const handleSlaveIdBlur = useCallback(() => {
    const slaveIdNum = parseInt(slaveId, 10)
    const minSlaveId = transport === 'rtu' ? SLAVE_ID_RTU_MIN : SLAVE_ID_TCP_MIN
    const maxSlaveId = transport === 'rtu' ? SLAVE_ID_RTU_MAX : SLAVE_ID_TCP_MAX
    if (
      !isNaN(slaveIdNum) &&
      slaveIdNum >= minSlaveId &&
      slaveIdNum <= maxSlaveId &&
      slaveIdNum !== remoteDevice?.modbusTcpConfig?.slaveId
    ) {
      projectActions.updateRemoteDeviceConfig(deviceName, { slaveId: slaveIdNum })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    }
  }, [slaveId, transport, deviceName, remoteDevice?.modbusTcpConfig?.slaveId, projectActions, sharedWorkspaceActions])

  // Transport type handler
  const handleTransportChange = useCallback(
    (newTransport: 'tcp' | 'rtu') => {
      setTransport(newTransport)
      projectActions.updateRemoteDeviceConfig(deviceName, { transport: newTransport })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
  )

  // RTU field handlers
  const handleSerialPortChange = useCallback(
    (value: string) => {
      setSerialPort(value)
      projectActions.updateRemoteDeviceConfig(deviceName, { serialPort: value })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
  )

  const handleBaudRateChange = useCallback(
    (value: string) => {
      setBaudRate(value)
      projectActions.updateRemoteDeviceConfig(deviceName, { baudRate: parseInt(value, 10) })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
  )

  const handleParityChange = useCallback(
    (value: 'N' | 'E' | 'O') => {
      setParity(value)
      projectActions.updateRemoteDeviceConfig(deviceName, { parity: value })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
  )

  const handleStopBitsChange = useCallback(
    (value: string) => {
      setStopBits(value)
      projectActions.updateRemoteDeviceConfig(deviceName, { stopBits: parseInt(value, 10) })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
  )

  const handleDataBitsChange = useCallback(
    (value: string) => {
      setDataBits(value)
      projectActions.updateRemoteDeviceConfig(deviceName, { dataBits: parseInt(value, 10) })
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
  )

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
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, editingGroup, sharedWorkspaceActions],
  )

  const handleDeleteIOGroup = useCallback(
    (groupId: string) => {
      projectActions.deleteIOGroup(deviceName, groupId)
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
  )

  const handleUpdateAlias = useCallback(
    (ioGroupId: string, ioPointId: string, alias: string) => {
      projectActions.updateIOPointAlias(deviceName, ioGroupId, ioPointId, alias)
      sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
    },
    [deviceName, projectActions, sharedWorkspaceActions],
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

  const selectTriggerStyles =
    'flex h-[30px] w-full max-w-[200px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

  const selectContentStyles =
    'h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'

  const selectItemStyles = cn(
    'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
    'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
  )

  return (
    <div aria-label='Remote device content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>Remote Device: {deviceName}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>
          Protocol: Modbus {transport === 'tcp' ? '(TCP/IP)' : '(RTU/Serial)'}
        </p>
      </div>

      <div className='mb-6 flex flex-wrap gap-6'>
        {/* Transport Type Selector */}
        <div className='flex items-center gap-2'>
          <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Transport</Label>
          <Select value={transport} onValueChange={(v) => handleTransportChange(v as 'tcp' | 'rtu')}>
            <SelectTrigger withIndicator placeholder='Select transport' className={selectTriggerStyles} />
            <SelectContent className={selectContentStyles}>
              {TRANSPORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className={selectItemStyles}>
                  <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* TCP-specific fields */}
        {transport === 'tcp' && (
          <>
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
          </>
        )}

        {/* RTU-specific fields */}
        {transport === 'rtu' && (
          <>
            <div className='flex items-center gap-2'>
              <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Serial Port</Label>
              <SerialPortCombobox
                value={serialPort}
                onValueChange={handleSerialPortChange}
                options={serialPortOptions}
                isLoading={isLoadingSerialPorts}
                placeholder='/dev/ttyUSB0'
              />
            </div>
            <div className='flex items-center gap-2'>
              <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Baud Rate</Label>
              <Select value={baudRate} onValueChange={handleBaudRateChange}>
                <SelectTrigger withIndicator placeholder='Select baud rate' className={selectTriggerStyles} />
                <SelectContent className={selectContentStyles}>
                  {BAUD_RATE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className={selectItemStyles}>
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex items-center gap-2'>
              <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Parity</Label>
              <Select value={parity} onValueChange={(v) => handleParityChange(v as 'N' | 'E' | 'O')}>
                <SelectTrigger withIndicator placeholder='Select parity' className={selectTriggerStyles} />
                <SelectContent className={selectContentStyles}>
                  {PARITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className={selectItemStyles}>
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex items-center gap-2'>
              <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Stop Bits</Label>
              <Select value={stopBits} onValueChange={handleStopBitsChange}>
                <SelectTrigger withIndicator placeholder='Select stop bits' className={selectTriggerStyles} />
                <SelectContent className={selectContentStyles}>
                  {STOP_BITS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className={selectItemStyles}>
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex items-center gap-2'>
              <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Data Bits</Label>
              <Select value={dataBits} onValueChange={handleDataBitsChange}>
                <SelectTrigger withIndicator placeholder='Select data bits' className={selectTriggerStyles} />
                <SelectContent className={selectContentStyles}>
                  {DATA_BITS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className={selectItemStyles}>
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Common fields - Timeout and Slave ID */}
        <div className='flex items-center gap-2'>
          <Label className='whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Timeout (ms)</Label>
          <InputWithRef
            type='number'
            value={timeout}
            onChange={(e) => setTimeout(e.target.value)}
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
            min={transport === 'rtu' ? SLAVE_ID_RTU_MIN : SLAVE_ID_TCP_MIN}
            max={transport === 'rtu' ? SLAVE_ID_RTU_MAX : SLAVE_ID_TCP_MAX}
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
                <th className='w-[20%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Function Code
                </th>
                <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Alias
                </th>
                <th className='w-20 px-2 py-2 text-right text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {ioGroups.length === 0 ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
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
                    onEdit={() => handleOpenEditModal(ioGroup.id)}
                    onDelete={() => handleDeleteIOGroup(ioGroup.id)}
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
