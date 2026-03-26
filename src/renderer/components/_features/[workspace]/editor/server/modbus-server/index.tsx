import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { DEFAULT_BUFFER_MAPPING } from '@root/utils/modbus/generate-modbus-slave-config'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'

const DEFAULT_NETWORK_INTERFACE_OPTIONS = [
  { value: '0.0.0.0', label: 'All Interfaces (0.0.0.0)' },
  { value: '127.0.0.1', label: 'Localhost (127.0.0.1)' },
]

// Buffer mapping constraints
const MAX_REGISTER_COUNT = 1024
const MAX_BIT_COUNT = 8192

// Accordion components for buffer mapping sections
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

interface BufferInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  max: number
  description: string
}

const BufferInput = ({ label, value, onChange, onBlur, max, description }: BufferInputProps) => (
  <div className='flex items-center gap-3'>
    <Label className='w-20 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>{label}</Label>
    <div className='w-24'>
      <InputWithRef
        type='number'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        min='0'
        max={max.toString()}
        className='h-[28px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
      />
    </div>
    <span className='text-xs text-neutral-500 dark:text-neutral-400'>
      {description} (max: {max})
    </span>
  </div>
)

const ModbusServerEditor = () => {
  const {
    editor,
    project,
    projectActions,
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const serverName = editor.type === 'plc-server' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-server' ? editor.meta.protocol : ''

  const server = useMemo(() => {
    return project.data.servers?.find((s) => s.name === serverName)
  }, [project.data.servers, serverName])

  // Server configuration state
  const [enabled, setEnabled] = useState(false)
  const [networkInterface, setNetworkInterface] = useState('0.0.0.0')
  const [port, setPort] = useState('502')

  // Buffer mapping state - holding registers
  const [qwCount, setQwCount] = useState(DEFAULT_BUFFER_MAPPING.holdingRegisters.qwCount.toString())
  const [mwCount, setMwCount] = useState(DEFAULT_BUFFER_MAPPING.holdingRegisters.mwCount.toString())
  const [mdCount, setMdCount] = useState(DEFAULT_BUFFER_MAPPING.holdingRegisters.mdCount.toString())
  const [mlCount, setMlCount] = useState(DEFAULT_BUFFER_MAPPING.holdingRegisters.mlCount.toString())

  // Buffer mapping state - coils
  const [qxBits, setQxBits] = useState(DEFAULT_BUFFER_MAPPING.coils.qxBits.toString())
  const [mxBits, setMxBits] = useState(DEFAULT_BUFFER_MAPPING.coils.mxBits.toString())

  // Buffer mapping state - discrete inputs
  const [ixBits, setIxBits] = useState(DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits.toString())

  // Buffer mapping state - input registers
  const [iwCount, setIwCount] = useState(DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount.toString())

  // Helper function to reset buffer mapping state to defaults or provided values
  const setBufferMappingState = useCallback((bufferMapping: typeof DEFAULT_BUFFER_MAPPING = DEFAULT_BUFFER_MAPPING) => {
    setQwCount(bufferMapping.holdingRegisters.qwCount.toString())
    setMwCount(bufferMapping.holdingRegisters.mwCount.toString())
    setMdCount(bufferMapping.holdingRegisters.mdCount.toString())
    setMlCount(bufferMapping.holdingRegisters.mlCount.toString())
    setQxBits(bufferMapping.coils.qxBits.toString())
    setMxBits(bufferMapping.coils.mxBits.toString())
    setIxBits(bufferMapping.discreteInputs.ixBits.toString())
    setIwCount(bufferMapping.inputRegisters.iwCount.toString())
  }, [])

  // Accordion state
  const [openSections, setOpenSections] = useState<string[]>(['holding-registers'])

  useEffect(() => {
    if (server?.modbusSlaveConfig) {
      setEnabled(server.modbusSlaveConfig.enabled)
      setNetworkInterface(server.modbusSlaveConfig.networkInterface || '0.0.0.0')
      setPort(server.modbusSlaveConfig.port.toString())
      setBufferMappingState(server.modbusSlaveConfig.bufferMapping || DEFAULT_BUFFER_MAPPING)
    } else {
      setEnabled(false)
      setNetworkInterface('0.0.0.0')
      setPort('502')
      setBufferMappingState()
    }
  }, [server, setBufferMappingState])

  const handleEnabledChange = useCallback(
    (newEnabled: boolean) => {
      setEnabled(newEnabled)
      projectActions.updateServerConfig(serverName, { enabled: newEnabled })
      handleFileAndWorkspaceSavedState(serverName)
    },
    [serverName, projectActions, handleFileAndWorkspaceSavedState],
  )

  const handleNetworkInterfaceChange = useCallback(
    (newInterface: string) => {
      setNetworkInterface(newInterface)
      projectActions.updateServerConfig(serverName, { networkInterface: newInterface })
      handleFileAndWorkspaceSavedState(serverName)
    },
    [serverName, projectActions, handleFileAndWorkspaceSavedState],
  )

  const handlePortBlur = useCallback(() => {
    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum >= 1 && portNum <= 65535 && portNum !== server?.modbusSlaveConfig?.port) {
      projectActions.updateServerConfig(serverName, { port: portNum })
      handleFileAndWorkspaceSavedState(serverName)
    }
  }, [port, serverName, server?.modbusSlaveConfig?.port, projectActions, handleFileAndWorkspaceSavedState])

  // Buffer mapping update handlers
  const createBufferMappingHandler = useCallback(
    (field: string, subField: string, currentValue: string, storedValue: number | undefined, max: number) => {
      return () => {
        const num = parseInt(currentValue, 10)
        if (!isNaN(num) && num >= 0 && num <= max && num !== storedValue) {
          projectActions.updateServerConfig(serverName, {
            bufferMapping: {
              [field]: { [subField]: num },
            },
          })
          handleFileAndWorkspaceSavedState(serverName)
        }
      }
    },
    [serverName, projectActions, handleFileAndWorkspaceSavedState],
  )

  const bufferMapping = server?.modbusSlaveConfig?.bufferMapping || DEFAULT_BUFFER_MAPPING

  const handleQwCountBlur = createBufferMappingHandler(
    'holdingRegisters',
    'qwCount',
    qwCount,
    bufferMapping.holdingRegisters.qwCount,
    MAX_REGISTER_COUNT,
  )
  const handleMwCountBlur = createBufferMappingHandler(
    'holdingRegisters',
    'mwCount',
    mwCount,
    bufferMapping.holdingRegisters.mwCount,
    MAX_REGISTER_COUNT,
  )
  const handleMdCountBlur = createBufferMappingHandler(
    'holdingRegisters',
    'mdCount',
    mdCount,
    bufferMapping.holdingRegisters.mdCount,
    MAX_REGISTER_COUNT,
  )
  const handleMlCountBlur = createBufferMappingHandler(
    'holdingRegisters',
    'mlCount',
    mlCount,
    bufferMapping.holdingRegisters.mlCount,
    MAX_REGISTER_COUNT,
  )
  const handleQxBitsBlur = createBufferMappingHandler(
    'coils',
    'qxBits',
    qxBits,
    bufferMapping.coils.qxBits,
    MAX_BIT_COUNT,
  )
  const handleMxBitsBlur = createBufferMappingHandler(
    'coils',
    'mxBits',
    mxBits,
    bufferMapping.coils.mxBits,
    MAX_BIT_COUNT,
  )
  const handleIxBitsBlur = createBufferMappingHandler(
    'discreteInputs',
    'ixBits',
    ixBits,
    bufferMapping.discreteInputs.ixBits,
    MAX_BIT_COUNT,
  )
  const handleIwCountBlur = createBufferMappingHandler(
    'inputRegisters',
    'iwCount',
    iwCount,
    bufferMapping.inputRegisters.iwCount,
    MAX_REGISTER_COUNT,
  )

  const inputStyles =
    'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

  if (protocol !== 'modbus-tcp') {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-neutral-500 dark:text-neutral-400'>
          Configuration for {protocol} servers is not yet available.
        </p>
      </div>
    )
  }

  return (
    <div aria-label='Server content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>
          Modbus TCP Slave Server: {serverName}
        </h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: Modbus/TCP</p>
      </div>

      <div className='flex flex-1 flex-col gap-6 overflow-auto'>
        {/* Server Configuration Section */}
        <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
          <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Server Configuration</h3>

          <div className='flex items-center gap-4'>
            <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Enable Server</Label>
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
            <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Network Interface</Label>
            <div className='w-64'>
              <Select value={networkInterface} onValueChange={handleNetworkInterfaceChange}>
                <SelectTrigger
                  withIndicator
                  placeholder='Select network interface'
                  className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                  {DEFAULT_NETWORK_INTERFACE_OPTIONS.map((option) => (
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
            <div className='w-64'>
              <InputWithRef
                type='number'
                value={port}
                onChange={(e) => setPort(e.target.value)}
                onBlur={handlePortBlur}
                placeholder='502'
                min='1'
                max='65535'
                className={inputStyles}
              />
            </div>
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>Default: 502</span>
          </div>
        </div>

        {/* Buffer Mapping Section */}
        <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
          <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Buffer Mapping</h3>
          <p className='text-xs text-neutral-600 dark:text-neutral-400'>
            Configure the size of each register segment exposed by the Modbus TCP Slave server. These values define how
            many addresses are allocated for each IEC variable type.
          </p>

          <AccordionPrimitive.Root
            type='multiple'
            value={openSections}
            onValueChange={setOpenSections}
            className='flex flex-col gap-2'
          >
            {/* Holding Registers Section */}
            <AccordionItem value='holding-registers'>
              <AccordionTrigger>
                <span className='text-neutral-950 dark:text-white'>Holding Registers</span>
              </AccordionTrigger>
              <AccordionContent>
                <div className='flex flex-col gap-3'>
                  <BufferInput
                    label='%QW'
                    value={qwCount}
                    onChange={setQwCount}
                    onBlur={handleQwCountBlur}
                    max={MAX_REGISTER_COUNT}
                    description='Integer outputs'
                  />
                  <BufferInput
                    label='%MW'
                    value={mwCount}
                    onChange={setMwCount}
                    onBlur={handleMwCountBlur}
                    max={MAX_REGISTER_COUNT}
                    description='Integer memory'
                  />
                  <BufferInput
                    label='%MD'
                    value={mdCount}
                    onChange={setMdCount}
                    onBlur={handleMdCountBlur}
                    max={MAX_REGISTER_COUNT}
                    description='Double integer memory (2 regs each)'
                  />
                  <BufferInput
                    label='%ML'
                    value={mlCount}
                    onChange={setMlCount}
                    onBlur={handleMlCountBlur}
                    max={MAX_REGISTER_COUNT}
                    description='Long integer memory (4 regs each)'
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Coils Section */}
            <AccordionItem value='coils'>
              <AccordionTrigger>
                <span className='text-neutral-950 dark:text-white'>Coils</span>
              </AccordionTrigger>
              <AccordionContent>
                <div className='flex flex-col gap-3'>
                  <BufferInput
                    label='%QX'
                    value={qxBits}
                    onChange={setQxBits}
                    onBlur={handleQxBitsBlur}
                    max={MAX_BIT_COUNT}
                    description='Boolean outputs'
                  />
                  <BufferInput
                    label='%MX'
                    value={mxBits}
                    onChange={setMxBits}
                    onBlur={handleMxBitsBlur}
                    max={MAX_BIT_COUNT}
                    description='Boolean memory'
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Discrete Inputs Section */}
            <AccordionItem value='discrete-inputs'>
              <AccordionTrigger>
                <span className='text-neutral-950 dark:text-white'>Discrete Inputs</span>
              </AccordionTrigger>
              <AccordionContent>
                <div className='flex flex-col gap-3'>
                  <BufferInput
                    label='%IX'
                    value={ixBits}
                    onChange={setIxBits}
                    onBlur={handleIxBitsBlur}
                    max={MAX_BIT_COUNT}
                    description='Boolean inputs'
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Input Registers Section */}
            <AccordionItem value='input-registers'>
              <AccordionTrigger>
                <span className='text-neutral-950 dark:text-white'>Input Registers</span>
              </AccordionTrigger>
              <AccordionContent>
                <div className='flex flex-col gap-3'>
                  <BufferInput
                    label='%IW'
                    value={iwCount}
                    onChange={setIwCount}
                    onBlur={handleIwCountBlur}
                    max={MAX_REGISTER_COUNT}
                    description='Integer inputs'
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </AccordionPrimitive.Root>
        </div>
      </div>
    </div>
  )
}

export { ModbusServerEditor }
