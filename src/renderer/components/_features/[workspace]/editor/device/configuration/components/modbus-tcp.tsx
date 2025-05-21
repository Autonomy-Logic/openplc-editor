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
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, memo, useCallback, useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { tcpSelectors } from '../../useStoreSelectors'
import { INPUT_STYLES } from '../constants'
import { StaticHostConfigurationComponent } from './static-host'

type ModbusTCPComponentProps = ComponentPropsWithoutRef<'div'> & {
  isModbusTCPEnabled: boolean
}

const MAC_ADDRESS_REGEX = /^([0-9A-Fa-f]{2})([:\-,])(?:[0-9A-Fa-f]{2}\2){4}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/

const tcpConfigSchema = z.object({
  tcpInterface: z.enum(['Wi-Fi', 'Ethernet']),
  tcpMacAddress: z.string().regex(MAC_ADDRESS_REGEX),
  tcpWifiSSID: z.string(),
  tcpWifiPassword: z.string(),
})

type TCPConfigSchema = z.infer<typeof tcpConfigSchema>

const ModbusTCPComponent = memo(function ModbusTCP({ isModbusTCPEnabled, ...props }: ModbusTCPComponentProps) {
  const {
    control,
    formState: { errors },
  } = useForm<TCPConfigSchema>({
    mode: 'onChange',
    resolver: zodResolver(tcpConfigSchema),
  })

  const tcpInterface = useWatch({
    control,
    name: 'tcpInterface',
  })

  const modbusTCP = tcpSelectors.useModbusTCP()
  const availableTCPInterfaces = tcpSelectors.useAvailableTCPInterfaces()
  const setTCPConfig = tcpSelectors.useSetTCPConfig()
  const setWifiConfig = tcpSelectors.useSetWifiConfig()

  const [enableDHCPHost, setEnableDHCPHost] = useState(true)

  const handleEnableDHCPHost = useCallback(() => setEnableDHCPHost(!enableDHCPHost), [enableDHCPHost])

  useEffect(() => {
    if (modbusTCP.tcpInterface !== tcpInterface) {
      setTCPConfig({ tcpConfig: 'tcpInterface', value: tcpInterface })
    }
  }, [tcpInterface])

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
            <Controller
              name='tcpInterface'
              control={control}
              defaultValue={modbusTCP.tcpInterface}
              render={({ field: { value, onChange } }) => (
                <Select aria-label='modbus-tcp-interface-select' value={value} onValueChange={onChange}>
                  <SelectTrigger
                    aria-label='modbus-tcp-interface-select-trigger'
                    placeholder='Select interface'
                    withIndicator
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
              )}
            />
          </div>
          <div id='modbus-tcp-mac-address-container' className='flex w-full flex-1 items-center justify-start gap-1'>
            <Label
              id='modbus-tcp-mac-address-id-input-label'
              htmlFor='modbus-tcp-mac-address-id-input'
              className='whitespace-pre text-xs text-neutral-950 dark:text-white'
            >
              MAC Address
            </Label>
            <Controller
              name='tcpMacAddress'
              control={control}
              defaultValue={modbusTCP.tcpMacAddress ?? ''}
              render={({ field }) => (
                <InputWithRef
                  id='tcpMacAddress'
                  placeholder='MAC Address'
                  {...field}
                  onBlur={(_ev) => {
                    field.onBlur()
                    if (!errors.tcpMacAddress) setTCPConfig({ tcpConfig: field.name, value: field.value })
                  }}
                  className={errors.tcpMacAddress ? INPUT_STYLES.error : INPUT_STYLES.default}
                />
              )}
            />
          </div>
          {modbusTCP.tcpInterface === 'Wi-Fi' && (
            <div id='modbus-tcp-wifi-config-container' className='flex w-full flex-1 items-center justify-start gap-1'>
              <Label
                id='modbus-tcp-wifi-ssid-id-input-label'
                htmlFor='modbus-tcp-wifi-ssid-id-input'
                className='whitespace-pre text-xs text-neutral-950 dark:text-white'
              >
                Wi-Fi SSID
              </Label>
              <Controller
                name='tcpWifiSSID'
                control={control}
                defaultValue={modbusTCP.tcpWifiSSID ?? ''}
                render={({ field }) => (
                  <InputWithRef
                    id='tcpWifiSSID'
                    placeholder='WIFI SSID'
                    {...field}
                    onBlur={(_ev) => {
                      field.onBlur()
                      setWifiConfig({ tcpWifiSSID: field.value })
                    }}
                    className={errors.tcpWifiSSID ? INPUT_STYLES.error : INPUT_STYLES.default}
                  />
                )}
              />
              <Label
                id='modbus-tcp-wifi-password-id-input-label'
                htmlFor='modbus-tcp-wifi-password-id-input'
                className='ml-6 whitespace-pre text-xs text-neutral-950 dark:text-white'
              >
                Password
              </Label>
              <Controller
                name='tcpWifiPassword'
                control={control}
                defaultValue={modbusTCP.tcpWifiPassword ?? ''}
                render={({ field }) => (
                  <InputWithRef
                    id='tcpWifiPassword'
                    placeholder='Password'
                    type='password'
                    {...field}
                    onBlur={(_ev) => {
                      field.onBlur()
                      setWifiConfig({ tcpWifiPassword: field.value })
                    }}
                    className={errors.tcpWifiPassword ? INPUT_STYLES.error : INPUT_STYLES.default}
                  />
                )}
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
})

export { ModbusTCPComponent }
