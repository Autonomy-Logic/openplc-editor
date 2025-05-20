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
import { memo, useEffect, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { rtuSelectors } from '../../useStoreSelectors'
import { INPUT_STYLES } from '../constants'

const rtuConfigSchema = z.object({
  rtuInterface: z.enum(['Serial', 'Serial 1', 'Serial 2', 'Serial 3']),
  rtuBaudRate: z.enum(['9600', '14400', '19200', '38400', '57600', '115200']),
  rtuSlaveId: z.number().int().positive().lte(255),
  rtuRS485ENPin: z.string(),
})

type RTUConfigSchema = z.infer<typeof rtuConfigSchema>

const ModbusRTUComponent = memo(function ({ isModbusRTUEnabled }: { isModbusRTUEnabled: boolean }) {
  const {
    control,
    formState: { errors },
  } = useForm<RTUConfigSchema>({
    mode: 'onChange',
    resolver: zodResolver(rtuConfigSchema),
  })
  const [rtuInterface, rtuBaudRate] = useWatch({
    control,
    name: ['rtuInterface', 'rtuBaudRate'],
  })

  const availableRTUInterfaces = rtuSelectors.useAvailableRTUInterfaces()
  const availableRTUBaudRates = rtuSelectors.useAvailableRTUBaudRates()
  const modbusRTU = rtuSelectors.useModbusRTU()
  const setRTUConfig = rtuSelectors.useSetRTUConfig()

  const [enableRS485ENPin, setEnableRS485ENPin] = useState(false)

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

  useEffect(() => {
    scrollToSelectedOption(rtuBaudRateRef, rtuBaudRateIsOpen)
  }, [rtuBaudRateIsOpen])

  useEffect(() => {
    scrollToSelectedOption(rtuInterfaceRef, rtuInterfaceIsOpen)
  }, [rtuInterfaceIsOpen])

  const toggleEnableRS485ENPin = () => setEnableRS485ENPin((prev) => !prev)

  useEffect(() => {
    if (modbusRTU.rtuInterface !== rtuInterface) {
      setRTUConfig({
        rtuConfig: 'rtuInterface',
        value: rtuInterface,
      })
    }
  }, [rtuInterface])
  useEffect(() => {
    if (modbusRTU.rtuBaudRate !== rtuBaudRate) {
      setRTUConfig({
        rtuConfig: 'rtuBaudRate',
        value: rtuBaudRate,
      })
    }
  }, [rtuBaudRate])

  return (
    <div id='modbus-rtu-form-config-container' className={cn('flex gap-6', !isModbusRTUEnabled && 'hidden')}>
      <div id='modbus-rtu-form-config-left-slot' className='flex flex-1 flex-col gap-4'>
        <div id='modbus-rtu-interface-container' className='flex w-full flex-1 items-center justify-start gap-1'>
          <Label
            id='modbus-rtu-interface-select-label'
            className='whitespace-pre text-xs text-neutral-950 dark:text-white'
          >
            Interface
          </Label>
          <Controller
            name='rtuInterface'
            control={control}
            render={({ field: { value, onChange } }) => (
              <Select
                aria-label='modbus-rtu-interface-select'
                value={value}
                onValueChange={onChange}
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
                  className='h-fit w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
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
            )}
          />
        </div>
        <div id='modbus-rtu-slave-id-container' className='flex w-full flex-1 items-center justify-start gap-1'>
          <Label
            id='modbus-rtu-slave-id-input-label'
            htmlFor='modbus-rtu-slave-id-input'
            className='whitespace-pre text-xs text-neutral-950 dark:text-white'
          >
            Slave ID
          </Label>
          <Controller
            name='rtuSlaveId'
            control={control}
            defaultValue={modbusRTU.rtuSlaveId ?? 0}
            render={({ field }) => (
              <InputWithRef
                id='rtuSlaveId'
                placeholder='Slave ID'
                {...field}
                onBlur={(_ev) => {
                  field.onBlur()
                  setRTUConfig({ rtuConfig: field.name, value: field.value })
                }}
                className={errors.rtuSlaveId ? INPUT_STYLES.error : INPUT_STYLES.default}
              />
            )}
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
          <Controller
            name='rtuBaudRate'
            control={control}
            render={({ field: { value, onChange } }) => (
              <Select
                aria-label='modbus-rtu-baudrate-select'
                value={value}
                onValueChange={onChange}
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
                  className='h-fit w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
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
            )}
          />
        </div>
        <div id='modbus-rtu-rs485en-pin-container' className='flex w-full flex-1 items-center justify-start gap-1'>
          <Checkbox
            id='enable-rtu-rs485en-pin-checkbox'
            className={enableRS485ENPin ? 'border-brand' : 'border-neutral-300'}
            checked={enableRS485ENPin}
            onCheckedChange={toggleEnableRS485ENPin}
          />
          <Label
            id='modbus-rtu-rs485en-pin-input-label'
            htmlFor='modbus-rtu-rs485en-pin-input'
            className={cn('whitespace-pre text-xs text-neutral-950 dark:text-white', !enableRS485ENPin && 'opacity-50')}
          >
            RS485 EN Pin
          </Label>
          {enableRS485ENPin && (
            <Controller
              name='rtuRS485ENPin'
              control={control}
              defaultValue={modbusRTU.rtuRS485ENPin ?? ''}
              render={({ field }) => (
                <InputWithRef
                  id='rtuRS485ENPin'
                  placeholder='RS485 EN Pin'
                  {...field}
                  onBlur={(_ev) => {
                    field.onBlur()
                    setRTUConfig({ rtuConfig: field.name, value: field.value })
                  }}
                  disabled={!enableRS485ENPin}
                  className={errors.rtuRS485ENPin ? INPUT_STYLES.error : INPUT_STYLES.default}
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  )
})

export { ModbusRTUComponent }
