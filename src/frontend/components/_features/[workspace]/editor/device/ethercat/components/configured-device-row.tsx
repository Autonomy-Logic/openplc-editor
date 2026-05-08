import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
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
import { useMemo } from 'react'

import { ChannelMappingsSection, DeviceConfigurationForm, SdoParametersSection } from './device-configuration-form'

type ConfiguredDeviceRowProps = {
  device: ConfiguredEtherCATDevice
  repository: ESIRepositoryItemLight[]
  isExpanded: boolean
  onToggleExpand: () => void
  isSelected: boolean
  onSelect: () => void
  onUpdateDevice: (config: EtherCATSlaveConfig) => void
  projectPath: string
  onUpdateChannelMappings: (mappings: EtherCATChannelMapping[]) => void
  onEnrichDevice: (data: EnrichDeviceData) => void
  onUpdateSdoConfigurations: (configs: SDOConfigurationEntry[]) => void
  usedAddresses: Set<string>
}

const ConfiguredDeviceRow = ({
  device,
  repository,
  isExpanded,
  onToggleExpand,
  isSelected,
  onSelect,
  onUpdateDevice,
  projectPath,
  onUpdateChannelMappings,
  onEnrichDevice,
  onUpdateSdoConfigurations,
  usedAddresses,
}: ConfiguredDeviceRowProps) => {
  const esiDevice = useMemo<ESIDeviceSummary | null>(() => {
    const repoItem = repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
    if (!repoItem) return null
    return repoItem.devices[device.esiDeviceRef.deviceIndex] || null
  }, [repository, device.esiDeviceRef])

  const repoItem = useMemo(() => {
    return repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
  }, [repository, device.esiDeviceRef.repositoryItemId])

  const ioSummary = esiDevice ? `${esiDevice.inputChannelCount} / ${esiDevice.outputChannelCount}` : '-'

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
      enabled: isExpanded,
    })

  return (
    <>
      {/* Main row */}
      <tr
        tabIndex={0}
        role='row'
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        }}
        className={cn(
          'cursor-pointer border-b border-neutral-200 dark:border-neutral-800',
          isSelected && 'bg-brand/10 dark:bg-brand/20',
        )}
      >
        <td className='px-2 py-2'>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${device.name}`}
            className='flex items-center justify-center'
          >
            <ArrowIcon
              direction='right'
              className={cn('h-4 w-4 stroke-brand-light transition-all', isExpanded && 'rotate-270 stroke-brand')}
            />
          </button>
        </td>
        <td className='px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'>{device.name}</td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{esiDevice?.name || 'Unknown'}</td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>
          {device.position !== undefined ? device.position : '-'}
        </td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{ioSummary}</td>
        <td className='px-2 py-2'>
          <span
            className={cn(
              'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
              device.addedFrom === 'scan'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
            )}
          >
            {device.addedFrom === 'scan' ? 'Scan' : 'Manual'}
          </span>
        </td>
      </tr>

      {/* Expanded details */}
      {isExpanded && (
        <>
          {/* Device Info Section */}
          <tr className='border-b border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900/50'>
            <td className='px-2 py-2'></td>
            <td colSpan={5} className='px-2 py-2'>
              <div className='rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                <h5 className='mb-2 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>
                  Device Info
                </h5>
                <div className='grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4'>
                  <div>
                    <span className='text-neutral-500 dark:text-neutral-400'>Vendor:</span>{' '}
                    <span className='text-neutral-700 dark:text-neutral-300'>{repoItem?.vendor.name || 'Unknown'}</span>
                  </div>
                  <div>
                    <span className='text-neutral-500 dark:text-neutral-400'>Vendor ID:</span>{' '}
                    <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.vendorId}</span>
                  </div>
                  <div>
                    <span className='text-neutral-500 dark:text-neutral-400'>Product Code:</span>{' '}
                    <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.productCode}</span>
                  </div>
                  <div>
                    <span className='text-neutral-500 dark:text-neutral-400'>Revision:</span>{' '}
                    <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.revisionNo}</span>
                  </div>
                  <div>
                    <span className='text-neutral-500 dark:text-neutral-400'>ESI File:</span>{' '}
                    <span className='text-neutral-700 dark:text-neutral-300'>{repoItem?.filename || 'Not found'}</span>
                  </div>
                  {esiDevice?.groupName && (
                    <div>
                      <span className='text-neutral-500 dark:text-neutral-400'>Group:</span>{' '}
                      <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.groupName}</span>
                    </div>
                  )}
                  {esiDevice && (
                    <>
                      <div>
                        <span className='text-neutral-500 dark:text-neutral-400'>Input Channels:</span>{' '}
                        <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.inputChannelCount}</span>
                      </div>
                      <div>
                        <span className='text-neutral-500 dark:text-neutral-400'>Output Channels:</span>{' '}
                        <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.outputChannelCount}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </td>
          </tr>

          {/* Configuration Section */}
          <tr className='border-b border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900/50'>
            <td className='px-2 py-2'></td>
            <td colSpan={5} className='px-2 py-2'>
              <div className='rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                <h5 className='mb-3 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>
                  Configuration
                </h5>
                <DeviceConfigurationForm config={device.config} updateConfig={updateConfig} />
              </div>
            </td>
          </tr>

          {/* Startup Parameters (SDO) Section */}
          <tr className='border-b border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900/50'>
            <td className='px-2 py-2'></td>
            <td colSpan={5} className='px-2 py-2'>
              <div className='rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                <h5 className='mb-3 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>
                  Startup Parameters (SDO)
                </h5>
                <SdoParametersSection
                  isLoading={isLoadingChannels}
                  loadError={channelLoadError}
                  sdoConfigurations={device.sdoConfigurations}
                  coeObjects={coeObjects}
                  onUpdateSdoConfigurations={onUpdateSdoConfigurations}
                />
              </div>
            </td>
          </tr>

          {/* Channel Mappings Section */}
          <tr className='border-b border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900/50'>
            <td className='px-2 py-2'></td>
            <td colSpan={5} className='px-2 py-2'>
              <div className='rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                <h5 className='mb-3 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>
                  Channel Mappings
                </h5>
                <ChannelMappingsSection
                  isLoading={isLoadingChannels}
                  loadError={channelLoadError}
                  channels={channels}
                  mappings={device.channelMappings}
                  onAliasChange={handleAliasChange}
                />
              </div>
            </td>
          </tr>
        </>
      )}
    </>
  )
}

export { ConfiguredDeviceRow }
