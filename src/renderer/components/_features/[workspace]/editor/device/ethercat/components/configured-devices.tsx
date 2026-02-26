import { MinusIcon, PlusIcon } from '@root/renderer/assets/icons'
import TableActions from '@root/renderer/components/_atoms/table-actions'
import type {
  ConfiguredEtherCATDevice,
  ESIRepositoryItemLight,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  PersistedChannelInfo,
  PersistedPdo,
  SDOConfigurationEntry,
} from '@root/types/ethercat/esi-types'
import { useCallback, useState } from 'react'

import { ConfiguredDeviceRow } from './configured-device-row'

type EnrichDeviceData = {
  channelInfo?: PersistedChannelInfo[]
  rxPdos?: PersistedPdo[]
  txPdos?: PersistedPdo[]
  slaveType?: string
  sdoConfigurations?: SDOConfigurationEntry[]
}

type ConfiguredDevicesProps = {
  devices: ConfiguredEtherCATDevice[]
  repository: ESIRepositoryItemLight[]
  onAddDevice: () => void
  onRemoveDevice: (deviceId: string) => void
  onUpdateDevice: (deviceId: string, config: EtherCATSlaveConfig) => void
  projectPath: string
  onUpdateChannelMappings: (deviceId: string, mappings: EtherCATChannelMapping[]) => void
  onEnrichDevice: (deviceId: string, data: EnrichDeviceData) => void
  onUpdateSdoConfigurations: (deviceId: string, configs: SDOConfigurationEntry[]) => void
  usedAddresses: Set<string>
}

/**
 * Configured Devices Component
 *
 * Displays the list of configured EtherCAT devices with add/remove functionality.
 */
const ConfiguredDevices = ({
  devices,
  repository,
  onAddDevice,
  onRemoveDevice,
  onUpdateDevice,
  projectPath,
  onUpdateChannelMappings,
  onEnrichDevice,
  onUpdateSdoConfigurations,
  usedAddresses,
}: ConfiguredDevicesProps) => {
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set())
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const handleToggleExpand = useCallback((deviceId: string) => {
    setExpandedDevices((prev) => {
      const next = new Set(prev)
      if (next.has(deviceId)) {
        next.delete(deviceId)
      } else {
        next.add(deviceId)
      }
      return next
    })
  }, [])

  const handleRemoveSelected = useCallback(() => {
    if (selectedDeviceId) {
      onRemoveDevice(selectedDeviceId)
      setSelectedDeviceId(null)
    }
  }, [selectedDeviceId, onRemoveDevice])

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {/* Header with actions */}
      <div className='mb-2 flex items-center justify-between'>
        <h3 className='text-sm font-medium text-neutral-950 dark:text-neutral-100'>
          Configured Devices {devices.length > 0 && `(${devices.length})`}
        </h3>
        <TableActions
          actions={[
            {
              ariaLabel: 'Add Device',
              onClick: onAddDevice,
              icon: <PlusIcon className='h-4 w-4 stroke-brand' />,
              id: 'add-device-button',
            },
            {
              ariaLabel: 'Remove Device',
              onClick: handleRemoveSelected,
              disabled: !selectedDeviceId,
              icon: <MinusIcon className='h-4 w-4 stroke-brand' />,
              id: 'remove-device-button',
            },
          ]}
          buttonProps={{
            className:
              'rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed',
          }}
        />
      </div>

      {/* Devices table */}
      <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full table-fixed'>
          <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
            <tr>
              <th className='w-8 px-2 py-2'></th>
              <th className='w-[20%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Name
              </th>
              <th className='w-[20%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Type
              </th>
              <th className='w-[10%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Position
              </th>
              <th className='w-[15%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Channels (In/Out)
              </th>
              <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Source</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={6} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                  No devices configured. Click the + button to add a device from the repository, or use the Discovery
                  tab to scan and add devices.
                </td>
              </tr>
            ) : (
              devices.map((device) => (
                <ConfiguredDeviceRow
                  key={device.id}
                  device={device}
                  repository={repository}
                  isExpanded={expandedDevices.has(device.id)}
                  onToggleExpand={() => handleToggleExpand(device.id)}
                  isSelected={selectedDeviceId === device.id}
                  onSelect={() => setSelectedDeviceId(device.id)}
                  onUpdateDevice={(config) => onUpdateDevice(device.id, config)}
                  projectPath={projectPath}
                  onUpdateChannelMappings={(mappings) => onUpdateChannelMappings(device.id, mappings)}
                  onEnrichDevice={(data) => onEnrichDevice(device.id, data)}
                  onUpdateSdoConfigurations={(configs) => onUpdateSdoConfigurations(device.id, configs)}
                  usedAddresses={usedAddresses}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export { ConfiguredDevices }
