import { ArrowIcon } from '@root/renderer/assets/icons'
import { Checkbox } from '@root/renderer/components/_atoms/checkbox'
import { InputWithRef } from '@root/renderer/components/_atoms/input'
import type {
  ConfiguredEtherCATDevice,
  ESIChannel,
  ESICoEObject,
  ESIDeviceSummary,
  ESIRepositoryItemLight,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  PersistedChannelInfo,
  PersistedPdo,
  SDOConfigurationEntry,
} from '@root/types/ethercat/esi-types'
import { cn } from '@root/utils'
import { enrichDeviceData } from '@root/utils/ethercat/enrich-device-data'
import { generateDefaultChannelMappings, pdoToChannels } from '@root/utils/ethercat/esi-parser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChannelMappingTable } from './channel-mapping-table'
import { SdoParametersTable } from './sdo-parameters-table'

type EnrichDeviceData = {
  channelInfo?: PersistedChannelInfo[]
  rxPdos?: PersistedPdo[]
  txPdos?: PersistedPdo[]
  slaveType?: string
  sdoConfigurations?: SDOConfigurationEntry[]
}

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

const inputClassName =
  'h-[26px] w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'

const disabledInputClassName = 'cursor-not-allowed opacity-50'

/**
 * Configured Device Row Component
 *
 * Displays a configured EtherCAT device with expandable details and configuration form.
 */
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
  // Resolve the ESI device summary from repository
  const esiDevice = useMemo<ESIDeviceSummary | null>(() => {
    const repoItem = repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
    if (!repoItem) return null
    return repoItem.devices[device.esiDeviceRef.deviceIndex] || null
  }, [repository, device.esiDeviceRef])

  const repoItem = useMemo(() => {
    return repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
  }, [repository, device.esiDeviceRef.repositoryItemId])

  const ioSummary = esiDevice ? `${esiDevice.inputChannelCount} / ${esiDevice.outputChannelCount}` : '-'

  const config = device.config

  // Compute addresses used by other devices (excluding this device's own mappings)
  const externalAddresses = useMemo(() => {
    const filtered = new Set(usedAddresses)
    for (const mapping of device.channelMappings) {
      filtered.delete(mapping.iecLocation)
    }
    return filtered
  }, [usedAddresses, device.channelMappings])

  // Channel loading state
  const [channels, setChannels] = useState<ESIChannel[]>([])
  const [coeObjects, setCoeObjects] = useState<ESICoEObject[] | undefined>(undefined)
  const [isLoadingChannels, setIsLoadingChannels] = useState(false)
  const [channelLoadError, setChannelLoadError] = useState<string | null>(null)
  const fullDeviceLoadedRef = useRef(false)

  // Load full device data when expanded
  useEffect(() => {
    if (!isExpanded || fullDeviceLoadedRef.current) return

    const loadFullDevice = async () => {
      setIsLoadingChannels(true)
      setChannelLoadError(null)

      try {
        const result = await window.bridge.esiLoadDeviceFull(
          projectPath,
          device.esiDeviceRef.repositoryItemId,
          device.esiDeviceRef.deviceIndex,
        )

        if (result.success && result.device) {
          const deviceChannels = pdoToChannels(result.device)
          setChannels(deviceChannels)
          setCoeObjects(result.device.coeObjects)
          fullDeviceLoadedRef.current = true

          // Generate default mappings if none exist
          if (device.channelMappings.length === 0 && deviceChannels.length > 0) {
            onUpdateChannelMappings(generateDefaultChannelMappings(deviceChannels, externalAddresses))
          }

          // Enrich if data is missing (backward compat for projects created before enrichment)
          const needsEnrichment =
            !device.channelInfo ||
            !device.rxPdos ||
            !device.txPdos ||
            (device.sdoConfigurations === undefined && result.device.coeObjects?.length)
          if (needsEnrichment) {
            onEnrichDevice(enrichDeviceData(result.device))
          }
        } else {
          setChannelLoadError(result.error || 'Failed to load device data')
        }
      } catch (error) {
        setChannelLoadError(String(error))
      } finally {
        setIsLoadingChannels(false)
      }
    }

    void loadFullDevice()
  }, [
    isExpanded,
    projectPath,
    device.esiDeviceRef,
    device.channelMappings.length,
    device.channelInfo,
    device.rxPdos,
    device.txPdos,
    onUpdateChannelMappings,
    onEnrichDevice,
    externalAddresses,
  ])

  const handleAliasChange = useCallback(
    (channelId: string, alias: string) => {
      const updated = device.channelMappings.map((m) => (m.channelId === channelId ? { ...m, alias } : m))
      onUpdateChannelMappings(updated)
    },
    [device.channelMappings, onUpdateChannelMappings],
  )

  /**
   * Update a nested section of the config.
   */
  const updateConfig = useCallback(
    <K extends keyof EtherCATSlaveConfig>(section: K, updates: Partial<EtherCATSlaveConfig[K]>) => {
      onUpdateDevice({
        ...config,
        [section]: { ...config[section], ...updates },
      })
    },
    [config, onUpdateDevice],
  )

  /**
   * Parse a number input value, returning the parsed int or undefined if invalid.
   */
  const parseNumericInput = (value: string, min = 0): number | undefined => {
    const parsed = parseInt(value, 10)
    if (isNaN(parsed) || parsed < min) return undefined
    return parsed
  }

  return (
    <>
      {/* Main row */}
      <tr
        onClick={onSelect}
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
                <div className='flex flex-col gap-4'>
                  {/* Startup Checks */}
                  <div>
                    <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Startup Checks</h6>
                    <div className='flex flex-wrap gap-x-6 gap-y-2'>
                      <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                        <Checkbox
                          checked={config.startupChecks.checkVendorId}
                          onCheckedChange={(checked) =>
                            updateConfig('startupChecks', { checkVendorId: checked === true })
                          }
                        />
                        Verify Vendor ID
                      </label>
                      <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                        <Checkbox
                          checked={config.startupChecks.checkProductCode}
                          onCheckedChange={(checked) =>
                            updateConfig('startupChecks', { checkProductCode: checked === true })
                          }
                        />
                        Verify Product Code
                      </label>
                      <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                        <Checkbox
                          checked={config.startupChecks.checkRevisionNumber}
                          onCheckedChange={(checked) =>
                            updateConfig('startupChecks', { checkRevisionNumber: checked === true })
                          }
                        />
                        Verify Revision
                      </label>
                      <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                        <Checkbox
                          checked={config.startupChecks.downloadPdoConfig}
                          onCheckedChange={(checked) =>
                            updateConfig('startupChecks', { downloadPdoConfig: checked === true })
                          }
                        />
                        Download PDO Config
                      </label>
                    </div>
                  </div>

                  {/* Addressing */}
                  <div>
                    <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Addressing</h6>
                    <div className='flex flex-wrap items-center gap-x-6 gap-y-2'>
                      <div className='flex items-center gap-2'>
                        <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                          EtherCAT Address
                        </span>
                        <InputWithRef
                          type='number'
                          value={config.addressing.ethercatAddress}
                          onChange={(e) => {
                            const val = parseNumericInput(e.target.value)
                            if (val !== undefined) updateConfig('addressing', { ethercatAddress: val })
                          }}
                          min={0}
                          max={65535}
                          className={inputClassName}
                        />
                        <span className='text-xs text-neutral-400 dark:text-neutral-500'>0 = auto</span>
                      </div>
                      <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                        <Checkbox
                          checked={config.addressing.optionalSlave}
                          onCheckedChange={(checked) => updateConfig('addressing', { optionalSlave: checked === true })}
                        />
                        Optional Slave
                      </label>
                    </div>
                  </div>

                  {/* Timeouts */}
                  <div>
                    <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Timeouts</h6>
                    <div className='grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3'>
                      <div className='flex items-center gap-2'>
                        <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                          SDO (ms)
                        </span>
                        <InputWithRef
                          type='number'
                          value={config.timeouts.sdoTimeoutMs}
                          onChange={(e) => {
                            const val = parseNumericInput(e.target.value)
                            if (val !== undefined) updateConfig('timeouts', { sdoTimeoutMs: val })
                          }}
                          min={0}
                          className={inputClassName}
                        />
                      </div>
                      <div className='flex items-center gap-2'>
                        <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                          I&#8594;P (ms)
                        </span>
                        <InputWithRef
                          type='number'
                          value={config.timeouts.initToPreOpTimeoutMs}
                          onChange={(e) => {
                            const val = parseNumericInput(e.target.value)
                            if (val !== undefined) updateConfig('timeouts', { initToPreOpTimeoutMs: val })
                          }}
                          min={0}
                          className={inputClassName}
                        />
                      </div>
                      <div className='flex items-center gap-2'>
                        <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                          P&#8594;S/S&#8594;O (ms)
                        </span>
                        <InputWithRef
                          type='number'
                          value={config.timeouts.safeOpToOpTimeoutMs}
                          onChange={(e) => {
                            const val = parseNumericInput(e.target.value)
                            if (val !== undefined) updateConfig('timeouts', { safeOpToOpTimeoutMs: val })
                          }}
                          min={0}
                          className={inputClassName}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Watchdog */}
                  <div>
                    <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Watchdog</h6>
                    <div className='flex flex-col gap-2'>
                      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                          <Checkbox
                            checked={config.watchdog.smWatchdogEnabled}
                            onCheckedChange={(checked) =>
                              updateConfig('watchdog', { smWatchdogEnabled: checked === true })
                            }
                          />
                          SM Watchdog
                        </label>
                        <div className='flex items-center gap-2'>
                          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                            Time (ms)
                          </span>
                          <InputWithRef
                            type='number'
                            value={config.watchdog.smWatchdogMs}
                            disabled={!config.watchdog.smWatchdogEnabled}
                            onChange={(e) => {
                              const val = parseNumericInput(e.target.value)
                              if (val !== undefined) updateConfig('watchdog', { smWatchdogMs: val })
                            }}
                            min={0}
                            className={cn(inputClassName, !config.watchdog.smWatchdogEnabled && disabledInputClassName)}
                          />
                        </div>
                      </div>
                      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                          <Checkbox
                            checked={config.watchdog.pdiWatchdogEnabled}
                            onCheckedChange={(checked) =>
                              updateConfig('watchdog', { pdiWatchdogEnabled: checked === true })
                            }
                          />
                          PDI Watchdog
                        </label>
                        <div className='flex items-center gap-2'>
                          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                            Time (ms)
                          </span>
                          <InputWithRef
                            type='number'
                            value={config.watchdog.pdiWatchdogMs}
                            disabled={!config.watchdog.pdiWatchdogEnabled}
                            onChange={(e) => {
                              const val = parseNumericInput(e.target.value)
                              if (val !== undefined) updateConfig('watchdog', { pdiWatchdogMs: val })
                            }}
                            min={0}
                            className={cn(
                              inputClassName,
                              !config.watchdog.pdiWatchdogEnabled && disabledInputClassName,
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Distributed Clocks (DC) */}
                  <div>
                    <h6 className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                      Distributed Clocks (DC)
                    </h6>
                    <div className='flex flex-col gap-2'>
                      {/* DC Enable + Sync Unit Cycle */}
                      <div className='flex flex-wrap items-center gap-x-6 gap-y-2'>
                        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                          <Checkbox
                            checked={config.distributedClocks.dcEnabled}
                            onCheckedChange={(checked) =>
                              updateConfig('distributedClocks', { dcEnabled: checked === true })
                            }
                          />
                          Enable DC
                        </label>
                        <div className='flex items-center gap-2'>
                          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                            Sync Unit Cycle (us)
                          </span>
                          <InputWithRef
                            type='number'
                            value={config.distributedClocks.dcSyncUnitCycleUs}
                            disabled={!config.distributedClocks.dcEnabled}
                            onChange={(e) => {
                              const val = parseNumericInput(e.target.value)
                              if (val !== undefined) updateConfig('distributedClocks', { dcSyncUnitCycleUs: val })
                            }}
                            min={0}
                            className={cn(
                              inputClassName,
                              !config.distributedClocks.dcEnabled && disabledInputClassName,
                            )}
                          />
                          <span className='text-xs text-neutral-400 dark:text-neutral-500'>0 = master cycle</span>
                        </div>
                      </div>

                      {/* SYNC0 row */}
                      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 pl-4'>
                        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                          <Checkbox
                            checked={config.distributedClocks.dcSync0Enabled}
                            disabled={!config.distributedClocks.dcEnabled}
                            onCheckedChange={(checked) =>
                              updateConfig('distributedClocks', { dcSync0Enabled: checked === true })
                            }
                          />
                          SYNC0
                        </label>
                        <div className='flex items-center gap-2'>
                          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                            Cycle (us)
                          </span>
                          <InputWithRef
                            type='number'
                            value={config.distributedClocks.dcSync0CycleUs}
                            disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled}
                            onChange={(e) => {
                              const val = parseNumericInput(e.target.value)
                              if (val !== undefined) updateConfig('distributedClocks', { dcSync0CycleUs: val })
                            }}
                            min={0}
                            className={cn(
                              inputClassName,
                              (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled) &&
                                disabledInputClassName,
                            )}
                          />
                        </div>
                        <div className='flex items-center gap-2'>
                          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                            Shift (us)
                          </span>
                          <InputWithRef
                            type='number'
                            value={config.distributedClocks.dcSync0ShiftUs}
                            disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled}
                            onChange={(e) => {
                              const val = parseNumericInput(e.target.value)
                              if (val !== undefined) updateConfig('distributedClocks', { dcSync0ShiftUs: val })
                            }}
                            min={0}
                            className={cn(
                              inputClassName,
                              (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync0Enabled) &&
                                disabledInputClassName,
                            )}
                          />
                        </div>
                      </div>

                      {/* SYNC1 row */}
                      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 pl-4'>
                        <label className='flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300'>
                          <Checkbox
                            checked={config.distributedClocks.dcSync1Enabled}
                            disabled={!config.distributedClocks.dcEnabled}
                            onCheckedChange={(checked) =>
                              updateConfig('distributedClocks', { dcSync1Enabled: checked === true })
                            }
                          />
                          SYNC1
                        </label>
                        <div className='flex items-center gap-2'>
                          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                            Cycle (us)
                          </span>
                          <InputWithRef
                            type='number'
                            value={config.distributedClocks.dcSync1CycleUs}
                            disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled}
                            onChange={(e) => {
                              const val = parseNumericInput(e.target.value)
                              if (val !== undefined) updateConfig('distributedClocks', { dcSync1CycleUs: val })
                            }}
                            min={0}
                            className={cn(
                              inputClassName,
                              (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled) &&
                                disabledInputClassName,
                            )}
                          />
                        </div>
                        <div className='flex items-center gap-2'>
                          <span className='whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400'>
                            Shift (us)
                          </span>
                          <InputWithRef
                            type='number'
                            value={config.distributedClocks.dcSync1ShiftUs}
                            disabled={!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled}
                            onChange={(e) => {
                              const val = parseNumericInput(e.target.value)
                              if (val !== undefined) updateConfig('distributedClocks', { dcSync1ShiftUs: val })
                            }}
                            min={0}
                            className={cn(
                              inputClassName,
                              (!config.distributedClocks.dcEnabled || !config.distributedClocks.dcSync1Enabled) &&
                                disabledInputClassName,
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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

                {isLoadingChannels && (
                  <div className='flex items-center gap-2 py-4 text-sm text-neutral-500 dark:text-neutral-400'>
                    <ArrowIcon size='sm' className='animate-spin stroke-neutral-400' />
                    Loading CoE data...
                  </div>
                )}

                {!isLoadingChannels && device.sdoConfigurations && device.sdoConfigurations.length > 0 && (
                  <SdoParametersTable
                    sdoConfigurations={device.sdoConfigurations}
                    onUpdateSdoConfigurations={onUpdateSdoConfigurations}
                  />
                )}

                {!isLoadingChannels && device.sdoConfigurations && device.sdoConfigurations.length === 0 && (
                  <p className='py-4 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                    No configurable SDO parameters found in this device&apos;s CoE dictionary.
                  </p>
                )}

                {!isLoadingChannels && !device.sdoConfigurations && coeObjects && coeObjects.length > 0 && (
                  <div className='flex flex-col items-center gap-2 py-4'>
                    <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                      CoE Object Dictionary available. Auto-configure startup parameters?
                    </p>
                    <button
                      onClick={() => onEnrichDevice(enrichDeviceData({ coeObjects } as never))}
                      className='rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-medium-dark'
                    >
                      Auto-configure from ESI defaults
                    </button>
                  </div>
                )}

                {!isLoadingChannels && !device.sdoConfigurations && !coeObjects && (
                  <p className='py-4 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                    No CoE Object Dictionary available for this device.
                  </p>
                )}
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

                {isLoadingChannels && (
                  <div className='flex items-center gap-2 py-4 text-sm text-neutral-500 dark:text-neutral-400'>
                    <ArrowIcon size='sm' className='animate-spin stroke-neutral-400' />
                    Loading channels...
                  </div>
                )}

                {channelLoadError && (
                  <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'>
                    {channelLoadError}
                  </div>
                )}

                {!isLoadingChannels && !channelLoadError && channels.length === 0 && (
                  <p className='py-4 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                    No channels available for this device.
                  </p>
                )}

                {!isLoadingChannels && !channelLoadError && channels.length > 0 && (
                  <ChannelMappingTable
                    channels={channels}
                    mappings={device.channelMappings}
                    onAliasChange={handleAliasChange}
                  />
                )}
              </div>
            </td>
          </tr>
        </>
      )}
    </>
  )
}

export { ConfiguredDeviceRow }
