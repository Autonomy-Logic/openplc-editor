import {
  Checkbox,
  InputWithRef,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@root/renderer/components/_atoms'
import { DeviceEditorSlot } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useCallback, useEffect, useRef, useState } from 'react'

const Communication = () => {
  const onlyCompileBoards = ['OpenPLC Runtime', 'Raspberry Pi']
  const {
    deviceAvailableOptions: { availableRTUInterfaces, availableRTUBaudRates },
    deviceDefinitions: {
      configuration: {
        deviceBoard,
        communicationConfiguration: { modbusRTU },
      },
    },
    deviceActions: { setRTUConfig },
  } = useOpenPLCStore()
  const [modbusConfig, setModbusConfig] = useState({ RTU: false, TCP: false })
  const [enableRS485Pin, setEnableRS485Pin] = useState(false)
  const [rtuConfigFields, setRTUConfigFields] = useState({
    rtuSlaveId: modbusRTU.rtuSlaveId,
    rtuRS485ENPin: modbusRTU.rtuRS485ENPin,
  })
  const [rtuInterfaceIsOpen, setRTUInterfaceIsOpen] = useState(false)
  const rtuInterfaceRef = useRef<HTMLDivElement>(null)

  const [rtuBaudRateIsOpen, setRTUBaudRateIsOpen] = useState(false)
  const rtuBaudRateRef = useRef<HTMLDivElement>(null)

  const scrollToSelectedOption = (selectRef: React.RefObject<HTMLDivElement>, selectIsOpen: boolean) => {
    if (!selectIsOpen) return

    const checkedElement = selectRef.current?.querySelector('[data-state="checked"]')
    if (checkedElement) {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }
  console.log('🚀 ~ Communication ~ modbusRTU:', modbusRTU)
  useEffect(() => {
    const updateModbusConfig = () => {
      if (onlyCompileBoards.includes(deviceBoard)) {
        setModbusConfig({ RTU: false, TCP: false })
      }
    }
    updateModbusConfig()
  }, [deviceBoard])

  useEffect(() => {
    scrollToSelectedOption(rtuBaudRateRef, rtuBaudRateIsOpen)
  }, [rtuBaudRateIsOpen])

  useEffect(() => {
    scrollToSelectedOption(rtuInterfaceRef, rtuInterfaceIsOpen)
  }, [rtuInterfaceIsOpen])

  const toggleModbus = useCallback(
    (type: 'RTU' | 'TCP') => setModbusConfig((prev) => ({ ...prev, [type]: !prev[type] })),
    [],
  )

  const toggleEnableRS485Pin = () => setEnableRS485Pin((prev) => !prev)

  const handleEnableModbusRTU = () => toggleModbus('RTU')

  const handleEnableModbusTCP = () => toggleModbus('TCP')

  const handleRTUInterfaceChange = (rtuInterface: string) =>
    setRTUConfig({ rtuConfig: 'rtuInterface', value: rtuInterface as 'Serial' | 'Serial 1' | 'Serial 2' | 'Serial 3' })

  const handleRTUBaudRateChange = (rtuBaudRate: string) =>
    setRTUConfig({
      rtuConfig: 'rtuBaudRate',
      value: rtuBaudRate as '9600' | '14400' | '19200' | '38400' | '57600' | '115200',
    })

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    setRTUConfigFields({ ...rtuConfigFields, [event.target.id]: event.target.value })

  const writeSlaveIdInGlobalStore = () => setRTUConfig({ rtuConfig: 'rtuSlaveId', value: rtuConfigFields.rtuSlaveId })
  const writeRS485ENPinInGlobalStore = () =>
    setRTUConfig({ rtuConfig: 'rtuRS485ENPin', value: rtuConfigFields.rtuRS485ENPin })

  return (
    <DeviceEditorSlot heading='Communication'>
      <div id='modbus-rtu-container' className='flex h-fit w-full flex-col gap-4'>
        <div
          id='enable-modbus-rtu'
          className={cn('flex select-none items-center gap-2', !modbusConfig.RTU && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-rtu-checkbox'
            className={modbusConfig.RTU ? 'border-brand' : 'border-neutral-300'}
            checked={modbusConfig.RTU}
            disabled={onlyCompileBoards.includes(deviceBoard)}
            onCheckedChange={handleEnableModbusRTU}
          />
          <Label
            htmlFor='enable-modbus-rtu-checkbox'
            className='text-sm font-medium text-neutral-950 hover:cursor-pointer dark:text-white'
          >
            Enable Modbus RTU
          </Label>
        </div>
        <div id='modbus-rtu-form-config-container' className={cn('flex gap-6', !modbusConfig.RTU && 'hidden')}>
          <div id='modbus-rtu-form-config-left-slot' className='flex flex-1 flex-col gap-4'>
            <div id='modbus-rtu-interface-container' className='flex w-full flex-1 items-center justify-start gap-1'>
              <Label
                id='modbus-rtu-interface-select-label'
                className='whitespace-pre text-xs text-neutral-950 dark:text-white'
              >
                Interface
              </Label>
              <Select
                aria-label='modbus-rtu-interface-select'
                value={modbusRTU.rtuInterface}
                onValueChange={handleRTUInterfaceChange}
                onOpenChange={setRTUInterfaceIsOpen}
              >
                <SelectTrigger
                  aria-label='modbus-rtu-interface-select-trigger'
                  placeholder='Select interface'
                  className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent
                  aria-label='modbus-rtu-interface-select-content'
                  viewportRef={rtuInterfaceRef}
                  className='h-[100px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                >
                  {availableRTUInterfaces.map((rtuInterface) => {
                    return (
                      <SelectItem
                        key={rtuInterface}
                        value={rtuInterface}
                        className={cn(
                          'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                          'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                        )}
                      >
                        <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                          {rtuInterface}
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div id='modbus-rtu-slave-id-container' className='flex w-full flex-1 items-center justify-start gap-1'>
              <Label
                id='modbus-rtu-slave-id-input-label'
                htmlFor='modbus-rtu-slave-id-input'
                className='whitespace-pre text-xs text-neutral-950 dark:text-white'
              >
                Slave ID
              </Label>
              <InputWithRef
                id='rtuSlaveId'
                placeholder='Slave ID'
                value={rtuConfigFields.rtuSlaveId}
                onChange={handleInputChange}
                onBlur={writeSlaveIdInGlobalStore}
                className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
            </div>
          </div>
          <div id='modbus-rtu-form-config-right-slot' className='flex flex-1 flex-col gap-4'>
            <div id='modbus-rtu-baudrate-container' className='flex w-full flex-1 items-center justify-start gap-1'>
              <Label
                id='modbus-rtu-baudrate-select-label'
                className='whitespace-pre text-xs text-neutral-950 dark:text-white'
              >
                BaudRate
              </Label>
              <Select
                aria-label='modbus-rtu-baudrate-select'
                value={modbusRTU.rtuBaudRate}
                onValueChange={handleRTUBaudRateChange}
                onOpenChange={setRTUBaudRateIsOpen}
              >
                <SelectTrigger
                  aria-label='modbus-rtu-baudrate-select-trigger'
                  placeholder='Select baudrate'
                  className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent
                  aria-label='modbus-rtu-baudrate-select-content'
                  viewportRef={rtuBaudRateRef}
                  className='h-[100px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                >
                  {availableRTUBaudRates.map((rtuBaudRate) => {
                    return (
                      <SelectItem
                        key={rtuBaudRate}
                        value={rtuBaudRate}
                        className={cn(
                          'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                          'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                        )}
                      >
                        <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                          {rtuBaudRate}
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div id='modbus-rtu-rs485en-pin-container' className='flex w-full flex-1 items-center justify-start gap-1'>
              <Checkbox
                id='enable-rtu-rs485en-pin-checkbox'
                className={enableRS485Pin ? 'border-brand' : 'border-neutral-300'}
                checked={enableRS485Pin}
                onCheckedChange={toggleEnableRS485Pin}
              />
              <Label
                id='modbus-rtu-rs485en-pin-input-label'
                htmlFor='modbus-rtu-rs485en-pin-input'
                className={cn(
                  'whitespace-pre text-xs text-neutral-950 dark:text-white',
                  !enableRS485Pin && 'opacity-50',
                )}
              >
                RS485EN Pin
              </Label>
              <InputWithRef
                id='rtuRS485ENPin'
                placeholder='RS485EN Pin'
                value={rtuConfigFields.rtuRS485ENPin}
                onChange={handleInputChange}
                onBlur={writeRS485ENPinInGlobalStore}
                disabled={!enableRS485Pin}
                className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
            </div>
          </div>
        </div>
      </div>
      <hr id='container-split' className='h-[1px] w-full self-stretch bg-brand-light' />
      <div id='modbus-tcp-container' className='flex h-full w-full flex-col gap-4'>
        <div
          id='enable-modbus-tcp'
          className={cn('flex select-none items-center gap-2', !modbusConfig.TCP && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-tcp-checkbox'
            className={modbusConfig.TCP ? 'border-brand' : 'border-neutral-300'}
            checked={modbusConfig.TCP}
            disabled={onlyCompileBoards.includes(deviceBoard)}
            onCheckedChange={handleEnableModbusTCP}
          />
          <Label
            htmlFor='enable-modbus-tcp-checkbox'
            className='text-sm font-medium text-neutral-950 hover:cursor-pointer dark:text-white'
          >
            Enable Modbus TCP
          </Label>
        </div>
      </div>
    </DeviceEditorSlot>
  )
}

export { Communication }
