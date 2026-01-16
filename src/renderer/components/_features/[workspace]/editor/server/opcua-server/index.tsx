import * as Tabs from '@radix-ui/react-tabs'
import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { useOpenPLCStore } from '@root/renderer/store'
import type { OpcUaServerConfig } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AddressSpaceTab } from './components/address-space-tab'
import { CertificatesTab } from './components/certificates-tab'
import { SecurityProfilesTab } from './components/security-profiles-tab'
import { UsersTab } from './components/users-tab'

/**
 * OPC-UA Server Editor Component
 *
 * This component provides the configuration interface for the OPC-UA server.
 * It consists of 5 tabs:
 * - General Settings: Server name, port, endpoint configuration
 * - Security Profiles: Security policies and authentication methods
 * - Users: User accounts with roles and permissions
 * - Certificates: Server and client certificate management
 * - Address Space: Variable selection for OPC-UA exposure
 */

const DEFAULT_NETWORK_INTERFACE_OPTIONS = [
  { value: '0.0.0.0', label: 'All Interfaces (0.0.0.0)' },
  { value: '127.0.0.1', label: 'Localhost (127.0.0.1)' },
]

// Input styles matching Modbus server editor
const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

// Tab item component
const TabItem = ({ value, label, isActive }: { value: string; label: string; isActive: boolean }) => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'px-4 py-2 font-caption text-xs font-medium transition-colors',
      'border-b-2 border-transparent',
      'hover:text-brand-medium dark:hover:text-brand-light',
      isActive
        ? 'border-brand-medium text-brand-medium dark:border-brand-light dark:text-brand-light'
        : 'text-neutral-500 dark:text-neutral-400',
    )}
  >
    {label}
  </Tabs.Trigger>
)

export const OpcUaServerEditor = () => {
  const {
    editor,
    project,
    projectActions: { updateOpcUaServerConfig },
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  const [activeTab, setActiveTab] = useState('general')

  // Get the current server configuration
  const serverName = editor.type === 'plc-server' ? editor.meta.name : ''
  const protocol = editor.type === 'plc-server' ? editor.meta.protocol : ''

  const server = useMemo(() => {
    return project.data.servers?.find((s) => s.name === serverName)
  }, [project.data.servers, serverName])

  const config = server?.opcuaServerConfig

  // Initialize local state from server config
  const [localConfig, setLocalConfig] = useState<OpcUaServerConfig | null>(null)

  useEffect(() => {
    if (config) {
      setLocalConfig(config)
    }
  }, [config])

  // Handle server settings updates
  const handleServerSettingsUpdate = useCallback(
    (updates: Partial<OpcUaServerConfig['server']>) => {
      if (!localConfig) return

      // Update local state immediately for responsive UI
      setLocalConfig((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          server: { ...prev.server, ...updates },
        }
      })

      // Persist to store
      updateOpcUaServerConfig(serverName, { server: updates })
      setEditingState('unsaved')
    },
    [localConfig, serverName, updateOpcUaServerConfig, setEditingState],
  )

  // Handle cycle time update (top-level config field)
  const handleCycleTimeUpdate = useCallback(
    (cycleTimeMs: number) => {
      if (!localConfig) return

      setLocalConfig((prev) => {
        if (!prev) return prev
        return { ...prev, cycleTimeMs }
      })

      updateOpcUaServerConfig(serverName, { cycleTimeMs })
      setEditingState('unsaved')
    },
    [localConfig, serverName, updateOpcUaServerConfig, setEditingState],
  )

  if (protocol !== 'opcua') {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-neutral-500 dark:text-neutral-400'>
          Configuration for {protocol} servers is not yet available.
        </p>
      </div>
    )
  }

  if (!localConfig) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-neutral-500 dark:text-neutral-400'>Loading OPC-UA configuration...</p>
      </div>
    )
  }

  return (
    <div aria-label='Server content container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>OPC-UA Server: {serverName}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: OPC-UA</p>
      </div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className='flex min-h-0 flex-1 flex-col'>
        {/* Tab Navigation */}
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='general' label='General Settings' isActive={activeTab === 'general'} />
          <TabItem value='security' label='Security Profiles' isActive={activeTab === 'security'} />
          <TabItem value='users' label='Users' isActive={activeTab === 'users'} />
          <TabItem value='certificates' label='Certificates' isActive={activeTab === 'certificates'} />
          <TabItem value='address-space' label='Address Space' isActive={activeTab === 'address-space'} />
        </Tabs.List>

        {/* General Settings Tab */}
        <Tabs.Content value='general' className='flex-1 overflow-auto pt-4'>
          <div className='pb-4'>
            <GeneralSettingsTab
              config={localConfig}
              onServerUpdate={handleServerSettingsUpdate}
              onCycleTimeUpdate={handleCycleTimeUpdate}
            />
          </div>
        </Tabs.Content>

        {/* Security Profiles Tab */}
        <Tabs.Content value='security' className='flex-1 overflow-auto pt-4'>
          <div className='pb-4'>
            <SecurityProfilesTab
              config={localConfig}
              serverName={serverName}
              onConfigChange={() => setEditingState('unsaved')}
            />
          </div>
        </Tabs.Content>

        {/* Users Tab */}
        <Tabs.Content value='users' className='flex-1 overflow-auto pt-4'>
          <div className='pb-4'>
            <UsersTab config={localConfig} serverName={serverName} onConfigChange={() => setEditingState('unsaved')} />
          </div>
        </Tabs.Content>

        {/* Certificates Tab */}
        <Tabs.Content value='certificates' className='flex-1 overflow-auto pt-4'>
          <div className='pb-4'>
            <CertificatesTab
              config={localConfig}
              serverName={serverName}
              onConfigChange={() => setEditingState('unsaved')}
            />
          </div>
        </Tabs.Content>

        {/* Address Space Tab */}
        <Tabs.Content value='address-space' className='flex-1 overflow-auto pt-4'>
          <div className='flex h-[calc(100vh-280px)] min-h-[400px] flex-col pb-4'>
            <AddressSpaceTab
              config={localConfig}
              serverName={serverName}
              onConfigChange={() => setEditingState('unsaved')}
            />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

// General Settings Tab Component
interface GeneralSettingsTabProps {
  config: OpcUaServerConfig
  onServerUpdate: (updates: Partial<OpcUaServerConfig['server']>) => void
  onCycleTimeUpdate: (cycleTimeMs: number) => void
}

const GeneralSettingsTab = ({ config, onServerUpdate, onCycleTimeUpdate }: GeneralSettingsTabProps) => {
  // Local state for text inputs to allow typing before validation
  const [port, setPort] = useState(config.server.port.toString())
  const [cycleTime, setCycleTime] = useState(config.cycleTimeMs.toString())
  const [serverDisplayName, setServerDisplayName] = useState(config.server.name)
  const [applicationUri, setApplicationUri] = useState(config.server.applicationUri)
  const [productUri, setProductUri] = useState(config.server.productUri)
  const [endpointPath, setEndpointPath] = useState(config.server.endpointPath)

  // Sync local state when config changes
  useEffect(() => {
    setPort(config.server.port.toString())
    setCycleTime(config.cycleTimeMs.toString())
    setServerDisplayName(config.server.name)
    setApplicationUri(config.server.applicationUri)
    setProductUri(config.server.productUri)
    setEndpointPath(config.server.endpointPath)
  }, [config])

  const handlePortBlur = useCallback(() => {
    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum >= 1 && portNum <= 65535) {
      if (portNum !== config.server.port) {
        onServerUpdate({ port: portNum })
      }
    } else {
      setPort(config.server.port.toString())
    }
  }, [port, config.server.port, onServerUpdate])

  const handleCycleTimeBlur = useCallback(() => {
    const value = parseInt(cycleTime, 10)
    if (!isNaN(value) && value >= 10 && value <= 10000) {
      if (value !== config.cycleTimeMs) {
        onCycleTimeUpdate(value)
      }
    } else {
      setCycleTime(config.cycleTimeMs.toString())
    }
  }, [cycleTime, config.cycleTimeMs, onCycleTimeUpdate])

  const handleServerNameBlur = useCallback(() => {
    if (serverDisplayName !== config.server.name) {
      onServerUpdate({ name: serverDisplayName })
    }
  }, [serverDisplayName, config.server.name, onServerUpdate])

  const handleApplicationUriBlur = useCallback(() => {
    if (applicationUri !== config.server.applicationUri) {
      onServerUpdate({ applicationUri })
    }
  }, [applicationUri, config.server.applicationUri, onServerUpdate])

  const handleProductUriBlur = useCallback(() => {
    if (productUri !== config.server.productUri) {
      onServerUpdate({ productUri })
    }
  }, [productUri, config.server.productUri, onServerUpdate])

  const handleEndpointPathBlur = useCallback(() => {
    if (endpointPath !== config.server.endpointPath) {
      onServerUpdate({ endpointPath })
    }
  }, [endpointPath, config.server.endpointPath, onServerUpdate])

  return (
    <div className='flex flex-col gap-6'>
      {/* Server Configuration Section */}
      <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Server Configuration</h3>

        {/* Enable Server Toggle */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Enable Server</Label>
          <label className='relative inline-flex cursor-pointer items-center'>
            <input
              type='checkbox'
              checked={config.server.enabled}
              onChange={(e) => onServerUpdate({ enabled: e.target.checked })}
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
            {config.server.enabled ? 'Server will start when PLC runs' : 'Server is disabled'}
          </span>
        </div>

        {/* Server Name */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Server Name</Label>
          <div className='w-64'>
            <InputWithRef
              type='text'
              value={serverDisplayName}
              onChange={(e) => setServerDisplayName(e.target.value)}
              onBlur={handleServerNameBlur}
              placeholder='OpenPLC OPC UA Server'
              className={inputStyles}
            />
          </div>
        </div>

        {/* Bind Address */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Network Interface</Label>
          <div className='w-64'>
            <Select value={config.server.bindAddress} onValueChange={(value) => onServerUpdate({ bindAddress: value })}>
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

        {/* Port */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Port</Label>
          <div className='w-64'>
            <InputWithRef
              type='number'
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onBlur={handlePortBlur}
              placeholder='4840'
              min='1'
              max='65535'
              className={inputStyles}
            />
          </div>
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>Default: 4840</span>
        </div>

        {/* Endpoint Path */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Endpoint Path</Label>
          <div className='w-64'>
            <InputWithRef
              type='text'
              value={endpointPath}
              onChange={(e) => setEndpointPath(e.target.value)}
              onBlur={handleEndpointPathBlur}
              placeholder='/openplc/opcua'
              className={inputStyles}
            />
          </div>
        </div>
      </div>

      {/* Application Identity Section */}
      <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Application Identity</h3>
        <p className='text-xs text-neutral-600 dark:text-neutral-400'>
          Configure the OPC-UA application identity URIs. These are used by clients to identify the server.
        </p>

        {/* Application URI */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Application URI</Label>
          <div className='w-80'>
            <InputWithRef
              type='text'
              value={applicationUri}
              onChange={(e) => setApplicationUri(e.target.value)}
              onBlur={handleApplicationUriBlur}
              placeholder='urn:openplc:opcua:server'
              className={inputStyles}
            />
          </div>
        </div>

        {/* Product URI */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Product URI</Label>
          <div className='w-80'>
            <InputWithRef
              type='text'
              value={productUri}
              onChange={(e) => setProductUri(e.target.value)}
              onBlur={handleProductUriBlur}
              placeholder='urn:openplc:runtime'
              className={inputStyles}
            />
          </div>
        </div>
      </div>

      {/* Timing Configuration Section */}
      <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Timing Configuration</h3>

        {/* Cycle Time */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Cycle Time (ms)</Label>
          <div className='w-64'>
            <InputWithRef
              type='number'
              value={cycleTime}
              onChange={(e) => setCycleTime(e.target.value)}
              onBlur={handleCycleTimeBlur}
              placeholder='100'
              min='10'
              max='10000'
              className={inputStyles}
            />
          </div>
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>
            Update frequency for OPC-UA variables (10-10000ms)
          </span>
        </div>
      </div>

      {/* Namespace Configuration Section */}
      <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>Namespace Configuration</h3>

        {/* Namespace URI */}
        <div className='flex items-center gap-4'>
          <Label className='w-32 whitespace-nowrap text-xs text-neutral-950 dark:text-white'>Namespace URI</Label>
          <div className='w-80'>
            <InputWithRef
              type='text'
              value={config.addressSpace.namespaceUri}
              readOnly
              className={cn(inputStyles, 'bg-neutral-50 dark:bg-neutral-900')}
            />
          </div>
        </div>
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>
          The namespace URI for OpenPLC variables in the OPC-UA address space
        </p>
      </div>
    </div>
  )
}
