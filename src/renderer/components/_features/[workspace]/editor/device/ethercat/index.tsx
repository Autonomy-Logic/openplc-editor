import { ArrowIcon } from '@root/renderer/assets/icons'
import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { useOpenPLCStore } from '@root/renderer/store'
import type { EtherCATDevice, NetworkInterface } from '@root/types/ethercat'
import type {
  ConfiguredEtherCATDevice,
  ESIDeviceRef,
  ESIDeviceSummary,
  ESIRepositoryItemLight,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  ScannedDeviceMatch,
} from '@root/types/ethercat/esi-types'
import type { EtherCATMasterConfig } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { createDefaultSlaveConfig } from '@root/utils/ethercat/device-config-defaults'
import { countMatchedDevices, getBestMatchQuality, matchDevicesToRepository } from '@root/utils/ethercat/device-matcher'
import { enrichDeviceData } from '@root/utils/ethercat/enrich-device-data'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { ConfiguredDevices } from './components/configured-devices'
import { DeviceBrowserModal } from './components/device-browser-modal'
import { DiscoveredDeviceTable } from './components/discovered-device-table'
import { ESIRepository } from './components/esi-repository'
import { InterfaceSelector } from './components/interface-selector'

type EditorTab = 'repository' | 'discovery' | 'configured'

/**
 * EtherCAT Device Editor
 *
 * Provides interface for:
 * - Managing ESI file repository (Repository tab)
 * - Scanning for EtherCAT devices and matching with repository (Discovery tab)
 * - Viewing and configuring added devices (Configured Devices tab)
 */
const EtherCATEditor = () => {
  const { editor, runtimeConnection, project, projectActions } = useOpenPLCStore()

  const deviceName = editor.type === 'plc-remote-device' ? editor.meta.name : ''
  const projectPath = project.meta.path

  // Runtime connection state
  const { connectionStatus, jwtToken, ipAddress } = runtimeConnection
  const isConnectedToRuntime = connectionStatus === 'connected' && ipAddress !== null && jwtToken !== null

  // Tab state
  const [activeTab, setActiveTab] = useState<EditorTab>('repository')

  // Repository state (now lightweight)
  const [repository, setRepository] = useState<ESIRepositoryItemLight[]>([])
  const [isLoadingRepository, setIsLoadingRepository] = useState(false)
  const [repositoryError, setRepositoryError] = useState<string | null>(null)
  const [repositoryLoadRetry, setRepositoryLoadRetry] = useState(0)
  const repositoryLoadedRef = useRef(false)

  // Configured devices from Zustand store
  const remoteDevice = useMemo(() => {
    return project.data.remoteDevices?.find((d) => d.name === deviceName)
  }, [project.data.remoteDevices, deviceName])

  const configuredDevices = useMemo(() => {
    return (remoteDevice?.ethercatConfig?.devices ?? []) as ConfiguredEtherCATDevice[]
  }, [remoteDevice])

  const masterConfig = useMemo(() => {
    return (
      remoteDevice?.ethercatConfig?.masterConfig ?? {
        networkInterface: 'eth0',
        cycleTimeUs: 1000,
        watchdogTimeoutCycles: 3,
      }
    )
  }, [remoteDevice])

  const syncDevicesToStore = useCallback(
    (devices: ConfiguredEtherCATDevice[]) => {
      projectActions.updateEthercatConfig(deviceName, { masterConfig, devices })
    },
    [deviceName, projectActions, masterConfig],
  )

  const handleUpdateMasterConfig = useCallback(
    (updates: Partial<EtherCATMasterConfig>) => {
      const newMasterConfig = { ...masterConfig, ...updates }
      projectActions.updateEthercatConfig(deviceName, {
        masterConfig: newMasterConfig,
        devices: configuredDevices,
      })
    },
    [deviceName, projectActions, masterConfig, configuredDevices],
  )

  const [isDeviceBrowserOpen, setIsDeviceBrowserOpen] = useState(false)

  // Network interfaces state
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([])
  const [selectedInterface, setSelectedInterface] = useState<string>('')
  const [isLoadingInterfaces, setIsLoadingInterfaces] = useState(false)
  const [interfaceError, setInterfaceError] = useState<string | null>(null)

  // EtherCAT service status
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null)
  const [serviceMessage, setServiceMessage] = useState<string>('')

  // Scan state
  const [scannedDevices, setScannedDevices] = useState<EtherCATDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanMessage, setScanMessage] = useState<string>('')
  const [scanTimeMs, setScanTimeMs] = useState<number | null>(null)

  // Discovery selection state
  const [selectedScannedDevices, setSelectedScannedDevices] = useState<Set<number>>(new Set())

  // Matched devices (scanned devices with repository matches)
  const deviceMatches = useMemo<ScannedDeviceMatch[]>(() => {
    return matchDevicesToRepository(scannedDevices, repository)
  }, [scannedDevices, repository])

  const matchCounts = useMemo(() => countMatchedDevices(deviceMatches), [deviceMatches])

  // Check EtherCAT service status when connected to runtime
  const checkServiceStatus = useCallback(async () => {
    if (!isConnectedToRuntime || !ipAddress || !jwtToken) {
      setServiceAvailable(null)
      setServiceMessage('')
      return
    }

    try {
      const result = await window.bridge.etherCATGetStatus(ipAddress, jwtToken)
      if (result.success && result.data) {
        setServiceAvailable(result.data.available)
        setServiceMessage(result.data.message)
      } else {
        setServiceAvailable(false)
        setServiceMessage(result.error || 'Failed to check service status')
      }
    } catch (error) {
      setServiceAvailable(false)
      setServiceMessage(String(error))
    }
  }, [isConnectedToRuntime, ipAddress, jwtToken])

  // Fetch network interfaces from runtime
  const fetchInterfaces = useCallback(async () => {
    if (!isConnectedToRuntime || !ipAddress || !jwtToken) {
      setInterfaces([])
      setInterfaceError('Not connected to runtime')
      return
    }

    setIsLoadingInterfaces(true)
    setInterfaceError(null)

    try {
      const result = await window.bridge.etherCATGetInterfaces(ipAddress, jwtToken)
      if (result.success && result.data) {
        setInterfaces(result.data)
        if (result.data.length > 0 && !selectedInterface) {
          setSelectedInterface(result.data[0].name)
        }
      } else {
        setInterfaces([])
        setInterfaceError(result.error || 'Failed to fetch interfaces')
      }
    } catch (error) {
      setInterfaces([])
      setInterfaceError(String(error))
    } finally {
      setIsLoadingInterfaces(false)
    }
  }, [isConnectedToRuntime, ipAddress, jwtToken, selectedInterface])

  // Scan for EtherCAT devices
  const scanDevices = useCallback(async () => {
    if (!isConnectedToRuntime || !ipAddress || !jwtToken || !selectedInterface) {
      setScanError('Please select a network interface')
      return
    }

    setIsScanning(true)
    setScanError(null)
    setScanMessage('')
    setScannedDevices([])
    setSelectedScannedDevices(new Set())
    setScanTimeMs(null)

    try {
      const result = await window.bridge.etherCATScan(ipAddress, jwtToken, {
        interface: selectedInterface,
        timeout_ms: 5000,
      })

      if (result.success && result.data) {
        setScannedDevices(result.data.devices)
        setScanMessage(result.data.message)
        setScanTimeMs(result.data.scan_time_ms)

        if (result.data.status !== 'success') {
          setScanError(`Scan completed with status: ${result.data.status}`)
        }
      } else {
        setScanError(result.error || 'Scan failed')
      }
    } catch (error) {
      setScanError(String(error))
    } finally {
      setIsScanning(false)
    }
  }, [isConnectedToRuntime, ipAddress, jwtToken, selectedInterface])

  // Load ESI repository from cache (v2) or migrate (v1)
  useEffect(() => {
    const loadRepository = async () => {
      if (!projectPath || repositoryLoadedRef.current) return

      setIsLoadingRepository(true)
      setRepositoryError(null)

      try {
        const result = await window.bridge.esiLoadRepositoryLight(projectPath)

        if (result.success && result.items) {
          setRepository(result.items)
          repositoryLoadedRef.current = true
        } else if (result.needsMigration) {
          // One-time migration from v1 to v2
          const migrationResult = await window.bridge.esiMigrateRepository(projectPath)
          if (migrationResult.success && migrationResult.items) {
            setRepository(migrationResult.items)
            repositoryLoadedRef.current = true
          } else {
            setRepositoryError(migrationResult.error || 'Failed to migrate repository')
          }
        } else if (result.error) {
          setRepositoryError(result.error)
        } else {
          repositoryLoadedRef.current = true
        }
      } catch (error) {
        console.error('Failed to load ESI repository:', error)
        setRepositoryError(String(error))
      } finally {
        setIsLoadingRepository(false)
      }
    }

    void loadRepository()
  }, [projectPath, repositoryLoadRetry])

  // Check service status and fetch interfaces when runtime connection changes
  useEffect(() => {
    if (isConnectedToRuntime) {
      void checkServiceStatus()
      void fetchInterfaces()
    } else {
      setServiceAvailable(null)
      setInterfaces([])
      setScannedDevices([])
      setSelectedInterface('')
    }
  }, [isConnectedToRuntime, checkServiceStatus, fetchInterfaces])

  // Initialize ethercatConfig in store if missing
  useEffect(() => {
    if (remoteDevice && !remoteDevice.ethercatConfig) {
      projectActions.updateEthercatConfig(deviceName, {
        masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000, watchdogTimeoutCycles: 3 },
        devices: [],
      })
    }
  }, [remoteDevice, deviceName, projectActions])

  // Handle device selection from scan
  const handleSelectScannedDevice = useCallback((position: number, selected: boolean) => {
    setSelectedScannedDevices((prev) => {
      const next = new Set(prev)
      if (selected) {
        next.add(position)
      } else {
        next.delete(position)
      }
      return next
    })
  }, [])

  // Handle select all scanned devices
  const handleSelectAllScanned = useCallback(
    (selected: boolean) => {
      if (selected) {
        // Select only devices with matches
        const selectable = deviceMatches
          .filter((dm) => getBestMatchQuality(dm.matches) !== 'none')
          .map((dm) => dm.device.position)
        setSelectedScannedDevices(new Set(selectable))
      } else {
        setSelectedScannedDevices(new Set())
      }
    },
    [deviceMatches],
  )

  // Add selected scanned devices to configured devices
  const handleAddSelectedFromScan = useCallback(async () => {
    const newDevices: ConfiguredEtherCATDevice[] = []

    for (const position of selectedScannedDevices) {
      const match = deviceMatches.find((dm) => dm.device.position === position)
      if (!match || match.matches.length === 0) continue

      // Use the best match (first one, which is sorted by quality)
      const bestMatch = match.matches[0]
      const repoItem = repository.find((r) => r.id === bestMatch.repositoryItemId)
      if (!repoItem) continue

      // Enrich with full ESI data
      let enriched = {}
      const result = await window.bridge.esiLoadDeviceFull(
        projectPath,
        bestMatch.repositoryItemId,
        bestMatch.deviceIndex,
      )
      if (result.success && result.device) {
        enriched = enrichDeviceData(result.device)
      }

      newDevices.push({
        id: uuidv4(),
        position: match.device.position,
        name: match.device.name,
        esiDeviceRef: {
          repositoryItemId: bestMatch.repositoryItemId,
          deviceIndex: bestMatch.deviceIndex,
        },
        vendorId: repoItem.vendor.id,
        productCode: bestMatch.esiDevice.type.productCode,
        revisionNo: bestMatch.esiDevice.type.revisionNo,
        addedFrom: 'scan',
        config: createDefaultSlaveConfig(),
        channelMappings: [],
        ...enriched,
      })
    }

    if (newDevices.length > 0) {
      syncDevicesToStore([...configuredDevices, ...newDevices])
      setSelectedScannedDevices(new Set())
      setActiveTab('configured')
    }
  }, [selectedScannedDevices, deviceMatches, repository, configuredDevices, syncDevicesToStore, projectPath])

  // Handle adding device from browser modal
  const handleAddDeviceFromBrowser = useCallback(
    async (ref: ESIDeviceRef, device: ESIDeviceSummary, repoItem: ESIRepositoryItemLight) => {
      // Enrich with full ESI data
      let enriched = {}
      const result = await window.bridge.esiLoadDeviceFull(projectPath, ref.repositoryItemId, ref.deviceIndex)
      if (result.success && result.device) {
        enriched = enrichDeviceData(result.device)
      }

      const newDevice: ConfiguredEtherCATDevice = {
        id: uuidv4(),
        name: device.name,
        esiDeviceRef: ref,
        vendorId: repoItem.vendor.id,
        productCode: device.type.productCode,
        revisionNo: device.type.revisionNo,
        addedFrom: 'repository',
        config: createDefaultSlaveConfig(),
        channelMappings: [],
        ...enriched,
      }
      syncDevicesToStore([...configuredDevices, newDevice])
    },
    [configuredDevices, syncDevicesToStore, projectPath],
  )

  // Handle removing a configured device
  const handleRemoveDevice = useCallback(
    (deviceId: string) => {
      syncDevicesToStore(configuredDevices.filter((d) => d.id !== deviceId))
    },
    [configuredDevices, syncDevicesToStore],
  )

  // Handle updating a configured device's configuration
  const handleUpdateDevice = useCallback(
    (deviceId: string, config: EtherCATSlaveConfig) => {
      syncDevicesToStore(configuredDevices.map((d) => (d.id === deviceId ? { ...d, config } : d)))
    },
    [configuredDevices, syncDevicesToStore],
  )

  // Handle updating a configured device's channel mappings
  const handleUpdateChannelMappings = useCallback(
    (deviceId: string, channelMappings: EtherCATChannelMapping[]) => {
      syncDevicesToStore(configuredDevices.map((d) => (d.id === deviceId ? { ...d, channelMappings } : d)))
    },
    [configuredDevices, syncDevicesToStore],
  )

  // Handle enriching a device with persisted ESI data (backward compat for old projects)
  const handleEnrichDevice = useCallback(
    (deviceId: string, data: Partial<ConfiguredEtherCATDevice>) => {
      syncDevicesToStore(configuredDevices.map((d) => (d.id === deviceId ? { ...d, ...data } : d)))
    },
    [configuredDevices, syncDevicesToStore],
  )

  return (
    <div aria-label='EtherCAT editor container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      {/* Header */}
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>EtherCAT Device: {deviceName}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: EtherCAT</p>
      </div>

      {/* Master Settings */}
      <div className='mb-4 flex flex-wrap items-end gap-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900'>
        <span className='text-xs font-semibold text-neutral-700 dark:text-neutral-300'>Master Settings</span>
        <div className='flex flex-col gap-1'>
          <span className='text-xs text-neutral-600 dark:text-neutral-400'>Network Interface</span>
          {isConnectedToRuntime && interfaces.length > 0 ? (
            <div className='flex items-center gap-2'>
              <Select
                value={masterConfig.networkInterface}
                onValueChange={(value) => handleUpdateMasterConfig({ networkInterface: value })}
              >
                <SelectTrigger
                  withIndicator
                  placeholder='Select interface'
                  className='flex h-[26px] w-full min-w-[180px] max-w-[260px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-700 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                  {interfaces.map((iface) => (
                    <SelectItem
                      key={iface.name}
                      value={iface.name}
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer flex-col items-start justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {iface.name}
                      </span>
                      {iface.description && (
                        <span className='text-start font-caption text-[10px] font-normal text-neutral-500 dark:text-neutral-400'>
                          {iface.description}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={() => void fetchInterfaces()}
                disabled={isLoadingInterfaces}
                className={cn(
                  'flex h-[26px] w-[26px] items-center justify-center rounded-md border border-neutral-300 bg-white transition-colors',
                  'hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:hover:bg-neutral-800',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
                title='Refresh interfaces'
              >
                <ArrowIcon
                  size='sm'
                  className={cn('rotate-180 stroke-brand transition-transform', isLoadingInterfaces && 'animate-spin')}
                />
              </button>
            </div>
          ) : (
            <InputWithRef
              type='text'
              value={masterConfig.networkInterface}
              onChange={(e) => handleUpdateMasterConfig({ networkInterface: e.target.value })}
              placeholder='eth0'
              className='h-[26px] w-36 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
            />
          )}
          <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
            {isConnectedToRuntime && interfaces.length > 0
              ? 'Select from runtime interfaces'
              : 'Interface name on the runtime host (e.g. eth0, enp3s0)'}
          </span>
        </div>
        <div className='flex flex-col gap-1'>
          <span className='text-xs text-neutral-600 dark:text-neutral-400'>Cycle Time (us)</span>
          <InputWithRef
            type='number'
            value={masterConfig.cycleTimeUs}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val)) handleUpdateMasterConfig({ cycleTimeUs: val })
            }}
            min={100}
            max={100000}
            className='h-[26px] w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
          />
          <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
            EtherCAT bus cycle time in microseconds
          </span>
        </div>
        <div className='flex flex-col gap-1'>
          <span className='text-xs text-neutral-600 dark:text-neutral-400'>Watchdog Timeout (cycles)</span>
          <InputWithRef
            type='number'
            value={masterConfig.watchdogTimeoutCycles ?? 3}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val)) handleUpdateMasterConfig({ watchdogTimeoutCycles: val })
            }}
            min={1}
            max={100}
            className='h-[26px] w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
          />
          <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
            Missed cycles before watchdog triggers
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className='mb-4 flex border-b border-neutral-200 dark:border-neutral-700'>
        <button
          onClick={() => setActiveTab('repository')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'repository'
              ? 'border-b-2 border-brand text-brand'
              : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          Repository
          {repository.length > 0 && (
            <span className='ml-1 rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700'>
              {repository.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('discovery')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'discovery'
              ? 'border-b-2 border-brand text-brand'
              : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          Discovery
          {scannedDevices.length > 0 && (
            <span className='ml-1 rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700'>
              {scannedDevices.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('configured')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'configured'
              ? 'border-b-2 border-brand text-brand'
              : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          Configured Devices
          {configuredDevices.length > 0 && (
            <span className='bg-brand/20 ml-1 rounded-full px-1.5 py-0.5 text-xs text-brand'>
              {configuredDevices.length}
            </span>
          )}
        </button>
      </div>

      {/* Repository Tab */}
      {activeTab === 'repository' && (
        <>
          {repositoryError && (
            <div className='mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
              <p className='text-sm text-red-700 dark:text-red-300'>Failed to load repository: {repositoryError}</p>
              <button
                onClick={() => {
                  setRepositoryError(null)
                  repositoryLoadedRef.current = false
                  setRepositoryLoadRetry((c) => c + 1)
                }}
                className='text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300'
              >
                Retry
              </button>
            </div>
          )}
          <ESIRepository
            repository={repository}
            onRepositoryChange={setRepository}
            projectPath={projectPath}
            isLoading={isLoadingRepository}
          />
        </>
      )}

      {/* Discovery Tab */}
      {activeTab === 'discovery' && (
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Not connected state */}
          {!isConnectedToRuntime && (
            <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700'>
              <div className='text-center'>
                <p className='text-sm font-medium text-neutral-700 dark:text-neutral-300'>Not connected to runtime</p>
                <p className='mt-1 text-xs text-neutral-500 dark:text-neutral-400'>
                  Connect to the OpenPLC Runtime to scan for EtherCAT devices.
                </p>
              </div>
            </div>
          )}

          {/* Service not available state */}
          {isConnectedToRuntime && serviceAvailable === false && (
            <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20'>
              <div className='text-center'>
                <p className='text-sm font-medium text-yellow-700 dark:text-yellow-300'>
                  EtherCAT Discovery Service Not Available
                </p>
                <p className='mt-1 max-w-md text-xs text-yellow-600 dark:text-yellow-400'>{serviceMessage}</p>
              </div>
            </div>
          )}

          {/* Connected state */}
          {isConnectedToRuntime && serviceAvailable !== false && (
            <>
              {/* Interface Selection and Scan Controls */}
              <div className='mb-4 flex flex-wrap items-end gap-4'>
                <InterfaceSelector
                  interfaces={interfaces}
                  selectedInterface={selectedInterface}
                  onSelectInterface={setSelectedInterface}
                  isLoading={isLoadingInterfaces}
                  error={interfaceError}
                  onRefresh={() => void fetchInterfaces()}
                />

                <button
                  onClick={() => void scanDevices()}
                  disabled={isScanning || !selectedInterface}
                  className={cn(
                    'flex h-[30px] items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
                    'bg-brand text-white hover:bg-brand-medium-dark',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {isScanning ? (
                    <>
                      <ArrowIcon size='sm' className='animate-spin stroke-white' />
                      Scanning...
                    </>
                  ) : (
                    'Scan'
                  )}
                </button>

                {scanTimeMs !== null && (
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                    Completed in {scanTimeMs}ms{scanMessage ? ` — ${scanMessage}` : ''}
                  </span>
                )}
              </div>

              {/* Error/Status Messages */}
              {scanError && (
                <div className='mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
                  <p className='text-sm text-red-700 dark:text-red-300'>{scanError}</p>
                </div>
              )}

              {/* Match summary */}
              {deviceMatches.length > 0 && (
                <div className='mb-4 flex items-center justify-between'>
                  <div className='flex items-center gap-4'>
                    <span className='text-sm text-neutral-700 dark:text-neutral-300'>
                      Found {matchCounts.total} device(s):
                    </span>
                    <span className='text-xs text-green-600 dark:text-green-400'>{matchCounts.exact} exact</span>
                    <span className='text-xs text-yellow-600 dark:text-yellow-400'>{matchCounts.partial} partial</span>
                    <span className='text-xs text-red-600 dark:text-red-400'>{matchCounts.none} no match</span>
                  </div>
                  {selectedScannedDevices.size > 0 && (
                    <button
                      onClick={() => void handleAddSelectedFromScan()}
                      className='rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-medium-dark'
                    >
                      Add Selected ({selectedScannedDevices.size})
                    </button>
                  )}
                </div>
              )}

              {/* Discovered Devices Table */}
              <DiscoveredDeviceTable
                deviceMatches={deviceMatches}
                selectedDevices={selectedScannedDevices}
                onSelectDevice={handleSelectScannedDevice}
                onSelectAll={handleSelectAllScanned}
                isScanning={isScanning}
              />
            </>
          )}
        </div>
      )}

      {/* Configured Devices Tab */}
      {activeTab === 'configured' && (
        <ConfiguredDevices
          devices={configuredDevices}
          repository={repository}
          onAddDevice={() => setIsDeviceBrowserOpen(true)}
          onRemoveDevice={handleRemoveDevice}
          onUpdateDevice={handleUpdateDevice}
          projectPath={projectPath}
          onUpdateChannelMappings={handleUpdateChannelMappings}
          onEnrichDevice={handleEnrichDevice}
        />
      )}

      {/* Device Browser Modal */}
      <DeviceBrowserModal
        isOpen={isDeviceBrowserOpen}
        onClose={() => setIsDeviceBrowserOpen(false)}
        onSelectDevice={(...args) => void handleAddDeviceFromBrowser(...args)}
        repository={repository}
      />
    </div>
  )
}

export { EtherCATEditor }
