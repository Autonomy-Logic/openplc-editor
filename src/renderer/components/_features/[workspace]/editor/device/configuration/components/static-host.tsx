import { zodResolver } from '@hookform/resolvers/zod'
import { InputWithRef, Label } from '@root/renderer/components/_atoms'
import { ComponentPropsWithoutRef, memo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

import { staticHostSelectors } from '../../useStoreSelectors'
import { INPUT_STYLES } from '../constants'

const staticHostSchema = z.object({
  ipAddress: z.string().ip(),
  gateway: z.string().ip(),
  subnet: z.string().ip(),
  dns: z.string().ip(),
})

type StaticHostSchema = z.infer<typeof staticHostSchema>

type StaticHostConfigurationComponentProps = ComponentPropsWithoutRef<'div'>

const StaticHostConfigurationComponent = memo(function (props: StaticHostConfigurationComponentProps) {
  const tcpStaticHostConfiguration = staticHostSelectors.useTcpStaticHostConfiguration()
  const setStaticHostConfiguration = staticHostSelectors.useSetStaticHostConfiguration()
  const {
    control,
    formState: { errors },
  } = useForm<StaticHostSchema>({
    mode: 'onChange', // Can be on touched...
    resolver: zodResolver(staticHostSchema),
  })

  return (
    <div id='static-host-config-form-container' className='flex gap-6' {...props}>
      <div id='static-host-form-config-left-slot' className='flex flex-1 flex-col gap-4'>
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
            defaultValue={tcpStaticHostConfiguration.ipAddress}
            render={({ field }) => (
              <InputWithRef
                id='ipAddress'
                placeholder='xxx.xxx.xxx.xxx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.ipAddress) setStaticHostConfiguration({ ipAddress: field.value })
                }}
                className={errors.ipAddress ? INPUT_STYLES.error : INPUT_STYLES.default}
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
            defaultValue={tcpStaticHostConfiguration.gateway}
            render={({ field }) => (
              <InputWithRef
                id='gateway'
                placeholder='xxx.xxx.xxx.xxx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.gateway) setStaticHostConfiguration({ gateway: field.value })
                }}
                className={errors.gateway ? INPUT_STYLES.error : INPUT_STYLES.default}
              />
            )}
          />
        </div>
      </div>
      <div id='static-host-form-config-right-slot' className='flex flex-1 flex-col gap-4'>
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
            defaultValue={tcpStaticHostConfiguration.dns}
            render={({ field }) => (
              <InputWithRef
                id='dns'
                placeholder='xxx.xxx.xxx.xxx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.dns) setStaticHostConfiguration({ dns: field.value })
                }}
                className={errors.dns ? INPUT_STYLES.error : INPUT_STYLES.default}
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
            defaultValue={tcpStaticHostConfiguration.subnet}
            render={({ field }) => (
              <InputWithRef
                id='subnet'
                placeholder='xxx.xxx.xxx.xxx'
                {...field}
                onBlur={(_event) => {
                  field.onBlur()
                  if (!errors.subnet) setStaticHostConfiguration({ subnet: field.value })
                }}
                className={errors.subnet ? INPUT_STYLES.error : INPUT_STYLES.default}
              />
            )}
          />
        </div>
      </div>
    </div>
  )
})

export { StaticHostConfigurationComponent }
