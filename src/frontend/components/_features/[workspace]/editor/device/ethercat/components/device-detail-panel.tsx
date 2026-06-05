import * as Tabs from '@radix-ui/react-tabs'
import { useDeviceConfiguration } from '@root/frontend/hooks/use-device-configuration'
import { cn } from '@root/frontend/utils/cn'
import type {
  ConfiguredEtherCATDevice,
  EnrichDeviceData,
  ESIDeviceSummary,
  ESIRepositoryItemLight,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import { useMemo, useState } from 'react'

import { ChannelMappingsSection, DeviceConfigurationForm, SdoParametersSection } from './device-configuration-form'

type DeviceDetailPanelProps = {
  device: ConfiguredEtherCATDevice
  repository: ESIRepositoryItemLight[]
  projectPath: string
  usedAddresses: Set<string>
  onUpdateDevice: (config: EtherCATSlaveConfig) => void
  onUpdateChannelMappings: (mappings: EtherCATChannelMapping[]) => void
  onEnrichDevice: (data: EnrichDeviceData) => void
  onUpdateSdoConfigurations: (configs: SDOConfigurationEntry[]) => void
}

type DeviceDetailTab = 'info' | 'configuration' | 'startup-params' | 'channel-mappings'

const TabItem = ({ value, label, isActive }: { value: string; label: string; isActive: boolean }) => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'px-4 py-2 font-caption !text-xs font-medium transition-colors',
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

const DeviceDetailPanel = ({
  device,
  repository,
  projectPath,
  usedAddresses,
  onUpdateDevice,
  onUpdateChannelMappings,
  onEnrichDevice,
  onUpdateSdoConfigurations,
}: DeviceDetailPanelProps) => {
  const [activeTab, setActiveTab] = useState<DeviceDetailTab>('info')

  const esiDevice = useMemo<ESIDeviceSummary | null>(() => {
    const repoItem = repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
    if (!repoItem) return null
    return repoItem.devices[device.esiDeviceRef.deviceIndex] || null
  }, [repository, device.esiDeviceRef])

  const repoItem = useMemo(() => {
    return repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
  }, [repository, device.esiDeviceRef.repositoryItemId])

  const externalAddresses = useMemo(() => {
    const filtered = new Set(usedAddresses)
    for (const mapping of device.channelMappings) {
      filtered.delete(mapping.iecLocation)
    }
    return filtered
  }, [usedAddresses, device.channelMappings])

  const { channels, coeObjects, isLoadingChannels, channelLoadError, handleAliasChange, updateConfig } =
    useDeviceConfiguration({
      device,
      projectPath,
      externalAddresses,
      onUpdateDevice,
      onUpdateChannelMappings,
      onEnrichDevice,
    })

  return (
    <div className='flex h-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'>
      {/* Device header */}
      <div className='border-b border-neutral-200 px-4 py-3 dark:border-neutral-800'>
        <h3 className='text-sm font-semibold text-neutral-950 dark:text-neutral-100'>{device.name}</h3>
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>
          {esiDevice?.name || 'Unknown'} — Position {device.position ?? '-'}
        </p>
      </div>

      {/* Sub-tabs */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as DeviceDetailTab)}
        className='flex min-h-0 flex-1 flex-col overflow-hidden'
      >
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='info' label='Device Info' isActive={activeTab === 'info'} />
          <TabItem value='configuration' label='Configuration' isActive={activeTab === 'configuration'} />
          <TabItem value='startup-params' label='Startup Parameters' isActive={activeTab === 'startup-params'} />
          <TabItem value='channel-mappings' label='Channel Mappings' isActive={activeTab === 'channel-mappings'} />
        </Tabs.List>

        {/* Device Info Tab */}
        <Tabs.Content
          value='info'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <div className='grid grid-cols-2 gap-x-6 gap-y-3 text-xs'>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Vendor</span>
                <span className='text-neutral-700 dark:text-neutral-300'>{repoItem?.vendor.name || 'Unknown'}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Vendor ID</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.vendorId}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Product Code</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.productCode}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Revision</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.revisionNo}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>ESI File</span>
                <span className='text-neutral-700 dark:text-neutral-300'>{repoItem?.filename || 'Not found'}</span>
              </div>
              {esiDevice?.groupName && (
                <div className='flex flex-col gap-0.5'>
                  <span className='font-medium text-neutral-500 dark:text-neutral-400'>Group</span>
                  <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.groupName}</span>
                </div>
              )}
              {esiDevice && (
                <>
                  <div className='flex flex-col gap-0.5'>
                    <span className='font-medium text-neutral-500 dark:text-neutral-400'>Input Channels</span>
                    <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.inputChannelCount}</span>
                  </div>
                  <div className='flex flex-col gap-0.5'>
                    <span className='font-medium text-neutral-500 dark:text-neutral-400'>Output Channels</span>
                    <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.outputChannelCount}</span>
                  </div>
                </>
              )}
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Source</span>
                <span
                  className={cn(
                    'inline-block w-fit rounded px-1.5 py-0.5 text-xs font-medium',
                    device.addedFrom === 'scan'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                  )}
                >
                  {device.addedFrom === 'scan' ? 'Scan' : 'Manual'}
                </span>
              </div>
            </div>
          </div>
        </Tabs.Content>

        {/* Configuration Tab */}
        <Tabs.Content
          value='configuration'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <div className='flex flex-col gap-5'>
              <DeviceConfigurationForm config={device.config} updateConfig={updateConfig} />
            </div>
          </div>
        </Tabs.Content>

        {/* Startup Parameters Tab */}
        <Tabs.Content
          value='startup-params'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex min-h-0 flex-1 flex-col overflow-auto p-4'>
            <SdoParametersSection
              isLoading={isLoadingChannels}
              loadError={channelLoadError}
              sdoConfigurations={device.sdoConfigurations}
              coeObjects={coeObjects}
              onUpdateSdoConfigurations={onUpdateSdoConfigurations}
            />
          </div>
        </Tabs.Content>

        {/* Channel Mappings Tab */}
        <Tabs.Content
          value='channel-mappings'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex min-h-0 flex-1 flex-col overflow-auto p-4'>
            <ChannelMappingsSection
              isLoading={isLoadingChannels}
              loadError={channelLoadError}
              channels={channels}
              mappings={device.channelMappings}
              onAliasChange={handleAliasChange}
            />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

export { DeviceDetailPanel }
