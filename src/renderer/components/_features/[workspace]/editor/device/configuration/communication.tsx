import { zodResolver } from '@hookform/resolvers/zod'
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
import { ComponentPropsWithoutRef, useCallback, useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
type ModbusRTUComponentProps = ComponentPropsWithoutRef<'div'> & {
  isModbusRTUEnabled: boolean
}
const ModbusRTUComponent = ({ isModbusRTUEnabled = false, ...props }: ModbusRTUComponentProps) => {
  const {
    deviceAvailableOptions: { availableRTUInterfaces, availableRTUBaudRates },
    deviceDefinitions: {
      configuration: {
        communicationConfiguration: { modbusRTU },
      },
    },
    deviceActions: { setRTUConfig },
  } = useOpenPLCStore()
  const [enableRS485Pin, setEnableRS485Pin] = useState(false)
  const [rtuConfigFields, setRTUConfigFields] = useState({
    rtuSlaveId: modbusRTU.rtuSlaveId,
    rtuRS485ENPin: modbusRTU.rtuRS485ENPin,
  })
  const [rtuInterfaceIsOpen, setRTUInterfaceIsOpen] = useState(false)
  const rtuInterfaceRef = useRef<HTMLDivElement>(null)

  const [rtuBaudRateIsOpen, setRTUBaudRateIsOpen] = useState(false)
  const rtuBaudRateRef = useRef<HTMLDivElement>(null)
  const toggleEnableRS485Pin = () => setEnableRS485Pin((prev) => !prev)
  const scrollToSelectedOption = (selectRef: React.RefObject<HTMLDivElement>, selectIsOpen: boolean) => {
    if (!selectIsOpen) return

    const checkedElement = selectRef.current?.querySelector('[data-state="checked"]')
    if (checkedElement) {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }
  useEffect(() => {
    scrollToSelectedOption(rtuBaudRateRef, rtuBaudRateIsOpen)
  }, [rtuBaudRateIsOpen])

  useEffect(() => {
    scrollToSelectedOption(rtuInterfaceRef, rtuInterfaceIsOpen)
  }, [rtuInterfaceIsOpen])
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
    <div id='modbus-rtu-form-config-container' className={cn('flex gap-6', !isModbusRTUEnabled && 'hidden')} {...props}>
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
              withIndicator
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
              withIndicator
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
            className={cn('whitespace-pre text-xs text-neutral-950 dark:text-white', !enableRS485Pin && 'opacity-50')}
          >
            RS485 EN Pin
          </Label>
          <InputWithRef
            id='rtuRS485ENPin'
            placeholder='RS485 EN Pin'
            value={rtuConfigFields.rtuRS485ENPin}
            onChange={handleInputChange}
            onBlur={writeRS485ENPinInGlobalStore}
            disabled={!enableRS485Pin}
            className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
          />
        </div>
      </div>
    </div>
  )
}

type ModbusTCPComponentProps = ComponentPropsWithoutRef<'div'> & {
  isModbusTCPEnabled: boolean
}

const _rtuConfigSchema = z.object({
  slaveId: z.string(),
})

const staticHostSchema = z.object({
  ipAddress: z.string().ip(),
  gateway: z.string().ip(),
  subnet: z.string().cidr(),
  dns: z.string().ip(),
})

type StaticHostSchema = z.infer<typeof staticHostSchema>

type StaticHostConfigurationComponentProps = ComponentPropsWithoutRef<'form'>
const StaticHostConfigurationComponent = (props: StaticHostConfigurationComponentProps) => {
  const {
    deviceDefinitions,
    deviceActions: { setStaticHostConfiguration },
  } = useOpenPLCStore()
  const {
    control,
    formState: { errors },
  } = useForm<StaticHostSchema>({
    mode: 'onChange', // Can be on touched...
    resolver: zodResolver(staticHostSchema),
  })

  console.log('Global State ->', deviceDefinitions)
  console.log('Errors ->', errors)

  return (
    <form id='static-host-config-form-container' className='flex gap-6' {...props}>
      <section id='static-host-form-config-left-slot' className='flex flex-1 flex-col gap-4'>
        <div id='static-host-ip-container' className='flex w-full flex-1 items-center justify-start gap-1'>
          <Label
            id='static-host-ip-config-id-input-label'
            htmlFor='static-host-ip-config-id-input'
            className='whitespace-pre text-xs text-neutral-950 dark:text-white'
          >
            IP
          </Label>
          <Controller
            name='ipAddress'
            control={control}
            defaultValue=''
            render={({ field }) => (
              <InputWithRef
                id='ipAddress'
                placeholder='xxx.xxx.xxx.xxx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.ipAddress) setStaticHostConfiguration({ ipAddress: field.value })
                }}
                className='relative h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
            )}
          />
        </div>
        <div id='static-host-gateway-container' className='flex w-full flex-1 items-center justify-start gap-1'>
          <Label
            id='static-host-gateway-id-input-label'
            htmlFor='static-host-gateway-id-input'
            className='whitespace-pre text-xs text-neutral-950 dark:text-white'
          >
            Gateway
          </Label>
          <Controller
            name='gateway'
            control={control}
            defaultValue=''
            render={({ field }) => (
              <InputWithRef
                id='gateway'
                placeholder='xxx.xxx.xxx.xxx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.gateway) setStaticHostConfiguration({ gateway: field.value })
                }}
                className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
            )}
          />
        </div>
      </section>
      <section id='static-host-form-config-right-slot' className='flex flex-1 flex-col gap-4'>
        <div id='static-host-dns-container' className='flex w-full flex-1 items-center justify-start gap-1'>
          <Label
            id='static-host-dns-id-input-label'
            htmlFor='static-host-dns-id-input'
            className='whitespace-pre text-xs text-neutral-950 dark:text-white'
          >
            DNS
          </Label>
          <Controller
            name='dns'
            control={control}
            defaultValue=''
            render={({ field }) => (
              <InputWithRef
                id='dns'
                placeholder='xxx.xxx.xxx.xxx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.dns) setStaticHostConfiguration({ dns: field.value })
                }}
                className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
            )}
          />
        </div>
        <div id='static-host-subnet-container' className='flex w-full flex-1 items-center justify-start gap-1'>
          <Label
            id='static-host-subnet-id-input-label'
            htmlFor='static-host-subnet-id-input'
            className='whitespace-pre text-xs text-neutral-950 dark:text-white'
          >
            Subnet
          </Label>
          <Controller
            name='subnet'
            control={control}
            defaultValue=''
            render={({ field }) => (
              <InputWithRef
                id='subnet'
                placeholder='xxx.xxx.xxx.xxx/xx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.subnet) setStaticHostConfiguration({ subnet: field.value })
                }}
                className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
            )}
          />
        </div>
      </section>
    </form>
  )
}

const ModbusTCPComponent = ({ isModbusTCPEnabled = false, ...props }: ModbusTCPComponentProps) => {
  const {
    deviceDefinitions: {
      configuration: {
        communicationConfiguration: { modbusTCP },
      },
    },
    deviceAvailableOptions: { availableTCPInterfaces },
    deviceActions: { setTCPConfig, setWifConfig },
  } = useOpenPLCStore()
  const [tcpConfigFields, setTCPConfigFields] = useState({
    tcpMACAddress: modbusTCP.tcpMacAddress,
    tcpWifiSSID: '',
    tcpWifiPassword: '',
  })

  const [enableDHCPHost, setEnableDHCPHost] = useState(true)

  const handleEnableDHCPHost = useCallback(() => setEnableDHCPHost(!enableDHCPHost), [enableDHCPHost])

  const handleTCPInterfaceChange = useCallback(
    (value: 'ethernet' | 'wifi') => setTCPConfig({ tcpConfig: 'tcpInterface', value }),
    [],
  )

  const writeMACAddressInGlobalStore = useCallback(
    () => setTCPConfig({ tcpConfig: 'tcpMacAddress', value: tcpConfigFields.tcpMACAddress }),
    [],
  )
  const writeWifiSSIDInGlobalStore = useCallback(() => setWifConfig({ wifiSSID: tcpConfigFields.tcpWifiSSID }), [])
  const writeWifiPasswordInGlobalStore = useCallback(
    () => setWifConfig({ wifiPassword: tcpConfigFields.tcpWifiPassword }),
    [],
  )

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    setTCPConfigFields({ ...tcpConfigFields, [event.target.id]: event.target.value })

  return (
    <>
      <div
        id='modbus-tcp-form-config-container'
        className={cn('flex gap-6', !isModbusTCPEnabled && 'hidden')}
        {...props}
      >
        <div id='modbus-tcp-form-config-slot' className='flex flex-1 flex-col gap-4'>
          <div id='modbus-tcp-interface-container' className='flex w-full flex-1 items-center justify-start gap-1'>
            <Label
              id='modbus-tcp-interface-select-label'
              className='whitespace-pre text-xs text-neutral-950 dark:text-white'
            >
              Interface
            </Label>
            <Select
              aria-label='modbus-tcp-interface-select'
              value={modbusTCP.tcpInterface}
              onValueChange={handleTCPInterfaceChange}
            >
              <SelectTrigger
                aria-label='modbus-tcp-interface-select-trigger'
                placeholder='Select interface'
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent
                aria-label='modbus-tcp-interface-select-content'
                className='h-fit w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
              >
                {availableTCPInterfaces.map((tcpInterface) => {
                  return (
                    <SelectItem
                      key={tcpInterface}
                      value={tcpInterface}
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {tcpInterface}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div id='modbus-tcp-mac-address-container' className='flex w-full flex-1 items-center justify-start gap-1'>
            <Label
              id='modbus-tcp-mac-address-id-input-label'
              htmlFor='modbus-tcp-mac-address-id-input'
              className='whitespace-pre text-xs text-neutral-950 dark:text-white'
            >
              MAC Address
            </Label>
            <InputWithRef
              id='tcpMacAddress'
              placeholder='MAC Address'
              value={tcpConfigFields.tcpMACAddress}
              onChange={handleInputChange}
              onBlur={writeMACAddressInGlobalStore}
              className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
            />
          </div>
          {modbusTCP.tcpInterface === 'wifi' && (
            <div id='modbus-tcp-wifi-config-container' className='flex w-full flex-1 items-center justify-start gap-1'>
              <Label
                id='modbus-tcp-wifi-ssid-id-input-label'
                htmlFor='modbus-tcp-wifi-ssid-id-input'
                className='whitespace-pre text-xs text-neutral-950 dark:text-white'
              >
                Wifi SSID
              </Label>
              <InputWithRef
                id='tcpWifiSSID'
                placeholder='WIFI SSID'
                value={tcpConfigFields.tcpWifiSSID}
                onChange={handleInputChange}
                onBlur={writeWifiSSIDInGlobalStore}
                className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <Label
                id='modbus-tcp-wifi-password-id-input-label'
                htmlFor='modbus-tcp-wifi-password-id-input'
                className='ml-6 whitespace-pre text-xs text-neutral-950 dark:text-white'
              >
                Password
              </Label>
              <InputWithRef
                id='tcpWifiPassword'
                placeholder='Password'
                type='password'
                value={tcpConfigFields.tcpWifiPassword}
                onChange={handleInputChange}
                onBlur={writeWifiPasswordInGlobalStore}
                className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand-medium-dark focus:outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
            </div>
          )}
        </div>
      </div>
      {isModbusTCPEnabled && (
        <div id='enable-dhcp-host-container' className='flex h-fit w-full items-center justify-start gap-1'>
          <Checkbox
            id='enable-dhcp-host-checkbox'
            className={enableDHCPHost ? 'border-brand' : 'border-neutral-300'}
            checked={enableDHCPHost}
            onCheckedChange={handleEnableDHCPHost}
          />
          <Label
            htmlFor='enable-dhcp-host-checkbox'
            className='text-sm font-medium text-neutral-950 hover:cursor-pointer dark:text-white'
          >
            Enable DHCP
          </Label>
        </div>
      )}
      {!enableDHCPHost && isModbusTCPEnabled && <StaticHostConfigurationComponent />}
    </>
  )
}

const Communication = () => {
  const onlyCompileBoards = ['OpenPLC Runtime', 'Raspberry Pi']
  const {
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
  } = useOpenPLCStore()
  const [modbusConfig, setModbusConfig] = useState({ RTU: false, TCP: false })

  useEffect(() => {
    const updateModbusConfig = () => {
      if (onlyCompileBoards.includes(deviceBoard)) {
        setModbusConfig({ RTU: false, TCP: false })
      }
    }
    updateModbusConfig()
  }, [deviceBoard])

  const toggleModbus = useCallback(
    (type: 'RTU' | 'TCP') => setModbusConfig((prev) => ({ ...prev, [type]: !prev[type] })),
    [],
  )

  const handleEnableModbusRTU = () => toggleModbus('RTU')

  const handleEnableModbusTCP = () => toggleModbus('TCP')

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
        <ModbusRTUComponent isModbusRTUEnabled={modbusConfig.RTU} />
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
        <ModbusTCPComponent isModbusTCPEnabled={modbusConfig.TCP} />
      </div>
    </DeviceEditorSlot>
  )
}

export { Communication }
