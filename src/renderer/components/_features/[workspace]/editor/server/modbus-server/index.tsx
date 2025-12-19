import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'

const DEFAULT_NETWORK_INTERFACE_OPTIONS = [
  { value: '0.0.0.0', label: 'All Interfaces (0.0.0.0)' },
  { value: '127.0.0.1', label: 'Localhost (127.0.0.1)' },
]

const ModbusServerEditor = () => {
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

  const [enabled, setEnabled] = useState(false)
  const [networkInterface, setNetworkInterface] = useState('0.0.0.0')
  const [port, setPort] = useState('502')

  useEffect(() => {
    if (server?.modbusSlaveConfig) {
      setEnabled(server.modbusSlaveConfig.enabled)
      setNetworkInterface(server.modbusSlaveConfig.networkInterface || '0.0.0.0')
      setPort(server.modbusSlaveConfig.port.toString())
    } else {
      setEnabled(false)
      setNetworkInterface('0.0.0.0')
      setPort('502')
    }
  }, [server])

  const handleEnabledChange = useCallback(
    (newEnabled: boolean) => {
      setEnabled(newEnabled)
      projectActions.updateServerConfig(serverName, { enabled: newEnabled })
      setEditingState('unsaved')
    },
    [serverName, projectActions, setEditingState],
  )

  const handleNetworkInterfaceChange = useCallback(
    (newInterface: string) => {
      setNetworkInterface(newInterface)
      projectActions.updateServerConfig(serverName, { networkInterface: newInterface })
      setEditingState('unsaved')
    },
    [serverName, projectActions, setEditingState],
  )

  const handlePortBlur = useCallback(() => {
    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum !== server?.modbusSlaveConfig?.port) {
      projectActions.updateServerConfig(serverName, { port: portNum })
      setEditingState('unsaved')
    }
  }, [port, serverName, server?.modbusSlaveConfig?.port, projectActions, setEditingState])

  const inputStyles =
    'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

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
                  className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
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

        <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
          <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Buffer Mapping</h3>
          <p className='text-xs text-neutral-600 dark:text-neutral-400'>
            The Modbus TCP Slave server exposes the OpenPLC buffers to external clients. The buffer mapping is
            automatically configured based on the located variables in your PLC program.
          </p>
          <div className='grid grid-cols-2 gap-4 text-xs'>
            <div className='flex justify-between rounded bg-neutral-50 p-2 dark:bg-neutral-800'>
              <span className='text-neutral-600 dark:text-neutral-400'>Max Coils:</span>
              <span className='font-medium text-neutral-950 dark:text-white'>8000</span>
            </div>
            <div className='flex justify-between rounded bg-neutral-50 p-2 dark:bg-neutral-800'>
              <span className='text-neutral-600 dark:text-neutral-400'>Max Discrete Inputs:</span>
              <span className='font-medium text-neutral-950 dark:text-white'>8000</span>
            </div>
            <div className='flex justify-between rounded bg-neutral-50 p-2 dark:bg-neutral-800'>
              <span className='text-neutral-600 dark:text-neutral-400'>Max Holding Registers:</span>
              <span className='font-medium text-neutral-950 dark:text-white'>1000</span>
            </div>
            <div className='flex justify-between rounded bg-neutral-50 p-2 dark:bg-neutral-800'>
              <span className='text-neutral-600 dark:text-neutral-400'>Max Input Registers:</span>
              <span className='font-medium text-neutral-950 dark:text-white'>1000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { ModbusServerEditor }
