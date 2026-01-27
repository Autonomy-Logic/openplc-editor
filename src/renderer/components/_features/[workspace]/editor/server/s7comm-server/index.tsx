import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDownIcon, Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { useOpenPLCStore } from '@root/renderer/store'
import type { S7CommBufferType, S7CommDataBlock } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'

// Default configurations
const DEFAULT_SERVER_SETTINGS = {
  enabled: false,
  bindAddress: '0.0.0.0',
  port: 102,
  maxClients: 32,
  workIntervalMs: 100,
  sendTimeoutMs: 3000,
  recvTimeoutMs: 3000,
  pingTimeoutMs: 10000,
  pduSize: 480,
}

const DEFAULT_PLC_IDENTITY = {
  name: 'OpenPLC Runtime',
  moduleType: 'CPU 315-2 PN/DP',
  serialNumber: 'S C-OPENPLC01',
  copyright: 'OpenPLC Project',
  moduleName: 'OpenPLC',
}

const DEFAULT_LOGGING = {
  logConnections: true,
  logDataAccess: false,
  logErrors: true,
}

const NETWORK_INTERFACE_OPTIONS = [
  { value: '0.0.0.0', label: 'All Interfaces (0.0.0.0)' },
  { value: '127.0.0.1', label: 'Localhost (127.0.0.1)' },
]

const BUFFER_TYPE_OPTIONS: { value: S7CommBufferType; label: string; description: string }[] = [
  { value: 'bool_input', label: 'Boolean Input (%IX)', description: '1 bit - Digital inputs' },
  { value: 'bool_output', label: 'Boolean Output (%QX)', description: '1 bit - Digital outputs' },
  { value: 'bool_memory', label: 'Boolean Memory (%MX)', description: '1 bit - Internal markers' },
  { value: 'byte_input', label: 'Byte Input (%IB)', description: '1 byte - Byte inputs' },
  { value: 'byte_output', label: 'Byte Output (%QB)', description: '1 byte - Byte outputs' },
  { value: 'int_input', label: 'Word Input (%IW)', description: '2 bytes - Word inputs' },
  { value: 'int_output', label: 'Word Output (%QW)', description: '2 bytes - Word outputs' },
  { value: 'int_memory', label: 'Word Memory (%MW)', description: '2 bytes - Word memory' },
  { value: 'dint_input', label: 'Double Word Input (%ID)', description: '4 bytes - DWord inputs' },
  { value: 'dint_output', label: 'Double Word Output (%QD)', description: '4 bytes - DWord outputs' },
  { value: 'dint_memory', label: 'Double Word Memory (%MD)', description: '4 bytes - DWord memory' },
  { value: 'lint_input', label: 'Long Word Input (%IL)', description: '8 bytes - LWord inputs' },
  { value: 'lint_output', label: 'Long Word Output (%QL)', description: '8 bytes - LWord outputs' },
  { value: 'lint_memory', label: 'Long Word Memory (%ML)', description: '8 bytes - LWord memory' },
]

// Accordion components
const AccordionItem = forwardRef<HTMLDivElement, AccordionPrimitive.AccordionItemProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <AccordionPrimitive.Item
      className={cn('overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700', className)}
      {...props}
      ref={forwardedRef}
    >
      {children}
    </AccordionPrimitive.Item>
  ),
)
AccordionItem.displayName = 'AccordionItem'

const AccordionTrigger = forwardRef<HTMLButtonElement, AccordionPrimitive.AccordionTriggerProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <AccordionPrimitive.Header className='flex'>
      <AccordionPrimitive.Trigger
        className={cn(
          'group flex w-full items-center justify-between bg-neutral-50 px-3 py-2 text-left text-sm font-medium transition-all hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-700',
          className,
        )}
        {...props}
        ref={forwardedRef}
      >
        {children}
        <ChevronDownIcon
          className='h-4 w-4 text-neutral-500 transition-transform duration-200 ease-in-out group-data-[state=open]:rotate-180 dark:text-neutral-400'
          aria-hidden
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  ),
)
AccordionTrigger.displayName = 'AccordionTrigger'

const AccordionContent = forwardRef<HTMLDivElement, AccordionPrimitive.AccordionContentProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <AccordionPrimitive.Content
      className={cn(
        'overflow-hidden border-t border-neutral-200 bg-white transition-all duration-200 ease-in-out data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown dark:border-neutral-700 dark:bg-neutral-900',
        className,
      )}
      {...props}
      ref={forwardedRef}
    >
      <div className='p-3'>{children}</div>
    </AccordionPrimitive.Content>
  ),
)
AccordionContent.displayName = 'AccordionContent'

// Data Block Modal Component
interface DataBlockModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (dataBlock: S7CommDataBlock) => void
  existingDbNumbers: number[]
  editingBlock?: S7CommDataBlock
}

const DataBlockModal = ({ isOpen, onClose, onSave, existingDbNumbers, editingBlock }: DataBlockModalProps) => {
  const [dbNumber, setDbNumber] = useState(editingBlock?.dbNumber.toString() || '1')
  const [description, setDescription] = useState(editingBlock?.description || '')
  const [sizeBytes, setSizeBytes] = useState(editingBlock?.sizeBytes.toString() || '128')
  const [mappingType, setMappingType] = useState<S7CommBufferType>(editingBlock?.mapping.type || 'bool_input')
  const [startBuffer, setStartBuffer] = useState(editingBlock?.mapping.startBuffer.toString() || '0')
  const [bitAddressing, setBitAddressing] = useState(editingBlock?.mapping.bitAddressing || false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (editingBlock) {
      setDbNumber(editingBlock.dbNumber.toString())
      setDescription(editingBlock.description)
      setSizeBytes(editingBlock.sizeBytes.toString())
      setMappingType(editingBlock.mapping.type)
      setStartBuffer(editingBlock.mapping.startBuffer.toString())
      setBitAddressing(editingBlock.mapping.bitAddressing)
    } else {
      setDbNumber('1')
      setDescription('')
      setSizeBytes('128')
      setMappingType('bool_input')
      setStartBuffer('0')
      setBitAddressing(false)
    }
    setError('')
  }, [editingBlock, isOpen])

  const handleSave = () => {
    const dbNum = parseInt(dbNumber, 10)
    const size = parseInt(sizeBytes, 10)
    const start = parseInt(startBuffer, 10)

    if (isNaN(dbNum) || dbNum < 1 || dbNum > 65535) {
      setError('DB Number must be between 1 and 65535')
      return
    }
    if (existingDbNumbers.includes(dbNum) && dbNum !== editingBlock?.dbNumber) {
      setError(`DB${dbNum} already exists`)
      return
    }
    if (isNaN(size) || size < 1 || size > 65536) {
      setError('Size must be between 1 and 65536 bytes')
      return
    }
    if (isNaN(start) || start < 0 || start > 1023) {
      setError('Start buffer must be between 0 and 1023')
      return
    }

    onSave({
      dbNumber: dbNum,
      description,
      sizeBytes: size,
      mapping: {
        type: mappingType,
        startBuffer: start,
        bitAddressing,
      },
    })
    onClose()
  }

  if (!isOpen) return null

  const isBoolType = mappingType.startsWith('bool_')

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='w-[480px] rounded-lg border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        <h3 className='mb-4 text-lg font-semibold text-neutral-950 dark:text-white'>
          {editingBlock ? 'Edit Data Block' : 'Add Data Block'}
        </h3>

        <div className='flex flex-col gap-4'>
          <div className='flex items-center gap-4'>
            <Label className='w-32 text-xs text-neutral-950 dark:text-white'>DB Number</Label>
            <InputWithRef
              type='number'
              value={dbNumber}
              onChange={(e) => setDbNumber(e.target.value)}
              min='1'
              max='65535'
              className='h-[30px] w-32 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
          </div>

          <div className='flex items-center gap-4'>
            <Label className='w-32 text-xs text-neutral-950 dark:text-white'>Description</Label>
            <InputWithRef
              type='text'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={128}
              placeholder='Optional description'
              className='h-[30px] flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
          </div>

          <div className='flex items-center gap-4'>
            <Label className='w-32 text-xs text-neutral-950 dark:text-white'>Size (bytes)</Label>
            <InputWithRef
              type='number'
              value={sizeBytes}
              onChange={(e) => setSizeBytes(e.target.value)}
              min='1'
              max='65536'
              className='h-[30px] w-32 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
          </div>

          <div className='flex items-center gap-4'>
            <Label className='w-32 text-xs text-neutral-950 dark:text-white'>Mapping Type</Label>
            <Select value={mappingType} onValueChange={(v) => setMappingType(v as S7CommBufferType)}>
              <SelectTrigger
                withIndicator
                placeholder='Select mapping type'
                className='flex h-[30px] flex-1 items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                {BUFFER_TYPE_OPTIONS.map((option) => (
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

          <div className='flex items-center gap-4'>
            <Label className='w-32 text-xs text-neutral-950 dark:text-white'>Start Buffer</Label>
            <InputWithRef
              type='number'
              value={startBuffer}
              onChange={(e) => setStartBuffer(e.target.value)}
              min='0'
              max='1023'
              className='h-[30px] w-32 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
          </div>

          {isBoolType && (
            <div className='flex items-center gap-4'>
              <Label className='w-32 text-xs text-neutral-950 dark:text-white'>Bit Addressing</Label>
              <label className='relative inline-flex cursor-pointer items-center'>
                <input
                  type='checkbox'
                  checked={bitAddressing}
                  onChange={(e) => setBitAddressing(e.target.checked)}
                  className='peer sr-only'
                />
                <div
                  className={cn(
                    'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                    'peer-checked:bg-brand peer-checked:after:translate-x-full',
                    'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                  )}
                />
              </label>
              <span className='text-xs text-neutral-500 dark:text-neutral-400'>Enable bit-level access</span>
            </div>
          )}

          {error && <p className='text-sm text-red-500'>{error}</p>}

          <div className='mt-4 flex justify-end gap-3'>
            <button
              onClick={onClose}
              className='rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className='rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              {editingBlock ? 'Save Changes' : 'Add Data Block'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main S7Comm Server Editor Component
const S7CommServerEditor = () => {
  const {
    editor,
    project,
    projectActions,
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  const serverName = editor.type === 'plc-server' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-server' ? editor.meta.protocol : ''

  const server = useMemo(() => {
    return project.data.servers?.find((s) => s.name === serverName)
  }, [project.data.servers, serverName])

  const config = server?.s7commSlaveConfig

  // Server settings state
  const [enabled, setEnabled] = useState(DEFAULT_SERVER_SETTINGS.enabled)
  const [bindAddress, setBindAddress] = useState(DEFAULT_SERVER_SETTINGS.bindAddress)
  const [port, setPort] = useState(DEFAULT_SERVER_SETTINGS.port.toString())
  const [maxClients, setMaxClients] = useState(DEFAULT_SERVER_SETTINGS.maxClients.toString())
  const [pduSize, setPduSize] = useState(DEFAULT_SERVER_SETTINGS.pduSize.toString())

  // PLC identity state
  const [plcName, setPlcName] = useState(DEFAULT_PLC_IDENTITY.name)
  const [moduleType, setModuleType] = useState(DEFAULT_PLC_IDENTITY.moduleType)
  const [serialNumber, setSerialNumber] = useState(DEFAULT_PLC_IDENTITY.serialNumber)
  const [copyright, setCopyright] = useState(DEFAULT_PLC_IDENTITY.copyright)
  const [moduleName, setModuleName] = useState(DEFAULT_PLC_IDENTITY.moduleName)

  // Logging state
  const [logConnections, setLogConnections] = useState(DEFAULT_LOGGING.logConnections)
  const [logDataAccess, setLogDataAccess] = useState(DEFAULT_LOGGING.logDataAccess)
  const [logErrors, setLogErrors] = useState(DEFAULT_LOGGING.logErrors)

  // Accordion state
  const [openSections, setOpenSections] = useState<string[]>(['server-config', 'data-blocks'])

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingBlock, setEditingBlock] = useState<S7CommDataBlock | undefined>(undefined)

  // Sync state from config
  useEffect(() => {
    if (config) {
      // Server settings
      setEnabled(config.server.enabled)
      setBindAddress(config.server.bindAddress)
      setPort(config.server.port.toString())
      setMaxClients(config.server.maxClients.toString())
      setPduSize(config.server.pduSize.toString())

      // PLC Identity
      if (config.plcIdentity) {
        setPlcName(config.plcIdentity.name)
        setModuleType(config.plcIdentity.moduleType)
        setSerialNumber(config.plcIdentity.serialNumber)
        setCopyright(config.plcIdentity.copyright)
        setModuleName(config.plcIdentity.moduleName)
      }

      // Logging
      if (config.logging) {
        setLogConnections(config.logging.logConnections)
        setLogDataAccess(config.logging.logDataAccess)
        setLogErrors(config.logging.logErrors)
      }
    }
  }, [config])

  // Handlers for server settings
  const handleEnabledChange = useCallback(
    (newEnabled: boolean) => {
      setEnabled(newEnabled)
      projectActions.updateS7CommServerSettings(serverName, { enabled: newEnabled })
      setEditingState('unsaved')
    },
    [serverName, projectActions, setEditingState],
  )

  const handleBindAddressChange = useCallback(
    (newAddress: string) => {
      setBindAddress(newAddress)
      projectActions.updateS7CommServerSettings(serverName, { bindAddress: newAddress })
      setEditingState('unsaved')
    },
    [serverName, projectActions, setEditingState],
  )

  const handlePortBlur = useCallback(() => {
    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum >= 1 && portNum <= 65535) {
      if (portNum !== config?.server.port) {
        projectActions.updateS7CommServerSettings(serverName, { port: portNum })
        setEditingState('unsaved')
      }
    } else {
      // Reset to last valid value when validation fails
      setPort((config?.server.port ?? DEFAULT_SERVER_SETTINGS.port).toString())
    }
  }, [port, serverName, config?.server.port, projectActions, setEditingState])

  const handleMaxClientsBlur = useCallback(() => {
    const num = parseInt(maxClients, 10)
    if (!isNaN(num) && num >= 1 && num <= 1024) {
      if (num !== config?.server.maxClients) {
        projectActions.updateS7CommServerSettings(serverName, { maxClients: num })
        setEditingState('unsaved')
      }
    } else {
      // Reset to last valid value when validation fails
      setMaxClients((config?.server.maxClients ?? DEFAULT_SERVER_SETTINGS.maxClients).toString())
    }
  }, [maxClients, serverName, config?.server.maxClients, projectActions, setEditingState])

  const handlePduSizeBlur = useCallback(() => {
    const num = parseInt(pduSize, 10)
    if (!isNaN(num) && num >= 240 && num <= 960) {
      if (num !== config?.server.pduSize) {
        projectActions.updateS7CommServerSettings(serverName, { pduSize: num })
        setEditingState('unsaved')
      }
    } else {
      // Reset to last valid value when validation fails
      setPduSize((config?.server.pduSize ?? DEFAULT_SERVER_SETTINGS.pduSize).toString())
    }
  }, [pduSize, serverName, config?.server.pduSize, projectActions, setEditingState])

  // Handlers for PLC identity
  const handlePlcIdentityBlur = useCallback(
    (field: string, value: string, currentValue?: string) => {
      if (value !== currentValue) {
        projectActions.updateS7CommPlcIdentity(serverName, { [field]: value })
        setEditingState('unsaved')
      }
    },
    [serverName, projectActions, setEditingState],
  )

  // Handlers for logging
  const handleLoggingChange = useCallback(
    (field: 'logConnections' | 'logDataAccess' | 'logErrors', value: boolean) => {
      if (field === 'logConnections') setLogConnections(value)
      if (field === 'logDataAccess') setLogDataAccess(value)
      if (field === 'logErrors') setLogErrors(value)
      projectActions.updateS7CommLogging(serverName, { [field]: value })
      setEditingState('unsaved')
    },
    [serverName, projectActions, setEditingState],
  )

  // Handlers for data blocks
  const handleAddDataBlock = useCallback(() => {
    setEditingBlock(undefined)
    setIsModalOpen(true)
  }, [])

  const handleEditDataBlock = useCallback((dataBlock: S7CommDataBlock) => {
    setEditingBlock(dataBlock)
    setIsModalOpen(true)
  }, [])

  const handleSaveDataBlock = useCallback(
    (dataBlock: S7CommDataBlock) => {
      if (editingBlock) {
        projectActions.updateS7CommDataBlock(serverName, editingBlock.dbNumber, dataBlock)
      } else {
        projectActions.addS7CommDataBlock(serverName, dataBlock)
      }
      setEditingState('unsaved')
    },
    [serverName, editingBlock, projectActions, setEditingState],
  )

  const handleDeleteDataBlock = useCallback(
    (dbNumber: number) => {
      projectActions.removeS7CommDataBlock(serverName, dbNumber)
      setEditingState('unsaved')
    },
    [serverName, projectActions, setEditingState],
  )

  const inputStyles =
    'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

  if (protocol !== 's7comm') {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-neutral-500 dark:text-neutral-400'>
          Configuration for {protocol} servers is not yet available.
        </p>
      </div>
    )
  }

  const existingDbNumbers = config?.dataBlocks.map((db) => db.dbNumber) || []

  return (
    <div aria-label='Server content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>S7Comm Server: {serverName}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: Siemens S7Comm</p>
      </div>

      <div className='flex flex-1 flex-col gap-4 overflow-auto'>
        <AccordionPrimitive.Root
          type='multiple'
          value={openSections}
          onValueChange={setOpenSections}
          className='flex flex-col gap-3'
        >
          {/* Server Configuration Section */}
          <AccordionItem value='server-config'>
            <AccordionTrigger>
              <span className='text-neutral-950 dark:text-white'>Server Configuration</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className='flex flex-col gap-4'>
                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>
                    Enable Server
                  </Label>
                  <label className='relative inline-flex cursor-pointer items-center'>
                    <input
                      type='checkbox'
                      checked={enabled}
                      onChange={(e) => handleEnabledChange(e.target.checked)}
                      className='peer sr-only'
                    />
                    <div
                      className={cn(
                        'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                        'peer-checked:bg-brand peer-checked:after:translate-x-full',
                        'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                      )}
                    />
                  </label>
                  <span className='text-xs text-neutral-600 dark:text-neutral-400'>
                    {enabled ? 'Server will start when PLC runs' : 'Server is disabled'}
                  </span>
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>
                    Bind Address
                  </Label>
                  <div className='w-64'>
                    <Select value={bindAddress} onValueChange={handleBindAddressChange}>
                      <SelectTrigger
                        withIndicator
                        placeholder='Select network interface'
                        className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                      />
                      <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                        {NETWORK_INTERFACE_OPTIONS.map((option) => (
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

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Port</Label>
                  <div className='w-32'>
                    <InputWithRef
                      type='number'
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      onBlur={handlePortBlur}
                      placeholder='102'
                      min='1'
                      max='65535'
                      className={inputStyles}
                    />
                  </div>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>Default: 102 (S7 standard)</span>
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Max Clients</Label>
                  <div className='w-32'>
                    <InputWithRef
                      type='number'
                      value={maxClients}
                      onChange={(e) => setMaxClients(e.target.value)}
                      onBlur={handleMaxClientsBlur}
                      min='1'
                      max='1024'
                      className={inputStyles}
                    />
                  </div>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>1-1024</span>
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>PDU Size</Label>
                  <div className='w-32'>
                    <InputWithRef
                      type='number'
                      value={pduSize}
                      onChange={(e) => setPduSize(e.target.value)}
                      onBlur={handlePduSizeBlur}
                      min='240'
                      max='960'
                      className={inputStyles}
                    />
                  </div>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>240-960 bytes</span>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Data Blocks Section */}
          <AccordionItem value='data-blocks'>
            <AccordionTrigger>
              <span className='text-neutral-950 dark:text-white'>
                Data Blocks ({config?.dataBlocks.length || 0}/64)
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className='flex flex-col gap-3'>
                <p className='text-xs text-neutral-600 dark:text-neutral-400'>
                  Configure S7 data blocks that map to OpenPLC buffer areas. Each DB can expose different IEC variable
                  types to S7 clients.
                </p>

                <button
                  onClick={handleAddDataBlock}
                  disabled={(config?.dataBlocks.length || 0) >= 64}
                  className='flex w-fit items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
                >
                  <PlusIcon className='h-4 w-4' />
                  Add Data Block
                </button>

                {config?.dataBlocks && config.dataBlocks.length > 0 ? (
                  <div className='mt-2 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
                    <table className='w-full'>
                      <thead className='bg-neutral-50 dark:bg-neutral-800'>
                        <tr>
                          <th className='px-3 py-2 text-left text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                            DB
                          </th>
                          <th className='px-3 py-2 text-left text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                            Description
                          </th>
                          <th className='px-3 py-2 text-left text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                            Size
                          </th>
                          <th className='px-3 py-2 text-left text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                            Type
                          </th>
                          <th className='px-3 py-2 text-right text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...config.dataBlocks]
                          .sort((a, b) => a.dbNumber - b.dbNumber)
                          .map((db) => (
                            <tr key={db.dbNumber} className='border-t border-neutral-200 dark:border-neutral-700'>
                              <td className='px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100'>
                                DB{db.dbNumber}
                              </td>
                              <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>
                                {db.description || '-'}
                              </td>
                              <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>
                                {db.sizeBytes} bytes
                              </td>
                              <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>
                                {BUFFER_TYPE_OPTIONS.find((o) => o.value === db.mapping.type)?.label || db.mapping.type}
                              </td>
                              <td className='px-3 py-2 text-right'>
                                <div className='flex justify-end gap-2'>
                                  <button
                                    onClick={() => handleEditDataBlock(db)}
                                    className='rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
                                    title='Edit'
                                  >
                                    <Pencil1Icon className='h-4 w-4' />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteDataBlock(db.dbNumber)}
                                    className='rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-900/30 dark:hover:text-red-400'
                                    title='Delete'
                                  >
                                    <TrashIcon className='h-4 w-4' />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className='mt-2 text-sm text-neutral-500 dark:text-neutral-400'>
                    No data blocks configured. Add a data block to expose PLC data to S7 clients.
                  </p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* PLC Identity Section */}
          <AccordionItem value='plc-identity'>
            <AccordionTrigger>
              <span className='text-neutral-950 dark:text-white'>PLC Identity</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className='flex flex-col gap-4'>
                <p className='text-xs text-neutral-600 dark:text-neutral-400'>
                  Configure the PLC identity returned in S7 SZL queries. These values help HMIs identify the PLC.
                </p>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>PLC Name</Label>
                  <InputWithRef
                    type='text'
                    value={plcName}
                    onChange={(e) => setPlcName(e.target.value)}
                    onBlur={() => handlePlcIdentityBlur('name', plcName, config?.plcIdentity?.name)}
                    maxLength={64}
                    className={cn(inputStyles, 'w-64')}
                  />
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Module Type</Label>
                  <InputWithRef
                    type='text'
                    value={moduleType}
                    onChange={(e) => setModuleType(e.target.value)}
                    onBlur={() => handlePlcIdentityBlur('moduleType', moduleType, config?.plcIdentity?.moduleType)}
                    maxLength={64}
                    className={cn(inputStyles, 'w-64')}
                  />
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>
                    Serial Number
                  </Label>
                  <InputWithRef
                    type='text'
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    onBlur={() =>
                      handlePlcIdentityBlur('serialNumber', serialNumber, config?.plcIdentity?.serialNumber)
                    }
                    maxLength={64}
                    className={cn(inputStyles, 'w-64')}
                  />
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Copyright</Label>
                  <InputWithRef
                    type='text'
                    value={copyright}
                    onChange={(e) => setCopyright(e.target.value)}
                    onBlur={() => handlePlcIdentityBlur('copyright', copyright, config?.plcIdentity?.copyright)}
                    maxLength={64}
                    className={cn(inputStyles, 'w-64')}
                  />
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Module Name</Label>
                  <InputWithRef
                    type='text'
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    onBlur={() => handlePlcIdentityBlur('moduleName', moduleName, config?.plcIdentity?.moduleName)}
                    maxLength={64}
                    className={cn(inputStyles, 'w-64')}
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Logging Section */}
          <AccordionItem value='logging'>
            <AccordionTrigger>
              <span className='text-neutral-950 dark:text-white'>Logging</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className='flex flex-col gap-4'>
                <div className='flex items-center gap-4'>
                  <Label className='w-40 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>
                    Log Connections
                  </Label>
                  <label className='relative inline-flex cursor-pointer items-center'>
                    <input
                      type='checkbox'
                      checked={logConnections}
                      onChange={(e) => handleLoggingChange('logConnections', e.target.checked)}
                      className='peer sr-only'
                    />
                    <div
                      className={cn(
                        'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                        'peer-checked:bg-brand peer-checked:after:translate-x-full',
                        'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                      )}
                    />
                  </label>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>Log client connect/disconnect</span>
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-40 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>
                    Log Data Access
                  </Label>
                  <label className='relative inline-flex cursor-pointer items-center'>
                    <input
                      type='checkbox'
                      checked={logDataAccess}
                      onChange={(e) => handleLoggingChange('logDataAccess', e.target.checked)}
                      className='peer sr-only'
                    />
                    <div
                      className={cn(
                        'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                        'peer-checked:bg-brand peer-checked:after:translate-x-full',
                        'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                      )}
                    />
                  </label>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                    Log read/write operations (verbose)
                  </span>
                </div>

                <div className='flex items-center gap-4'>
                  <Label className='w-40 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Log Errors</Label>
                  <label className='relative inline-flex cursor-pointer items-center'>
                    <input
                      type='checkbox'
                      checked={logErrors}
                      onChange={(e) => handleLoggingChange('logErrors', e.target.checked)}
                      className='peer sr-only'
                    />
                    <div
                      className={cn(
                        'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                        'peer-checked:bg-brand peer-checked:after:translate-x-full',
                        'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                      )}
                    />
                  </label>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>Log errors and warnings</span>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </AccordionPrimitive.Root>
      </div>

      <DataBlockModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveDataBlock}
        existingDbNumbers={
          editingBlock ? existingDbNumbers.filter((n) => n !== editingBlock.dbNumber) : existingDbNumbers
        }
        editingBlock={editingBlock}
      />
    </div>
  )
}

export { S7CommServerEditor }
