import { ArrowIcon } from '@root/renderer/assets/icons'
import { useOpenPLCStore } from '@root/renderer/store'
import type { EtherCATDevice, NetworkInterface } from '@root/types/ethercat'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { DeviceScanTable } from './components/device-scan-table'
import { InterfaceSelector } from './components/interface-selector'

/**
 * EtherCAT Device Editor
 *
 * Provides interface for:
 * - Selecting network interface for EtherCAT communication
 * - Scanning for EtherCAT devices on the selected interface
 * - Displaying discovered devices with their properties
 */
const EtherCATEditor = () => {
  const { editor, runtimeConnection } = useOpenPLCStore()

  const deviceName = editor.type === 'plc-remote-device' ? editor.meta.name : ''

  // Runtime connection state
  const { connectionStatus, jwtToken, ipAddress } = runtimeConnection
  const isConnectedToRuntime = connectionStatus === 'connected' && ipAddress !== null && jwtToken !== null

  // Network interfaces state
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([])
  const [selectedInterface, setSelectedInterface] = useState<string>('')
  const [isLoadingInterfaces, setIsLoadingInterfaces] = useState(false)
  const [interfaceError, setInterfaceError] = useState<string | null>(null)

  // EtherCAT service status
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null)
  const [serviceMessage, setServiceMessage] = useState<string>('')

  // Scan state
  const [devices, setDevices] = useState<EtherCATDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanMessage, setScanMessage] = useState<string>('')
  const [scanTimeMs, setScanTimeMs] = useState<number | null>(null)

  // Selected device for details
  const [selectedDevicePosition, setSelectedDevicePosition] = useState<number | null>(null)

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
        // Auto-select first interface if available
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
    setDevices([])
    setSelectedDevicePosition(null)

    try {
      const result = await window.bridge.etherCATScan(ipAddress, jwtToken, {
        interface: selectedInterface,
        timeout_ms: 5000,
      })

      if (result.success && result.data) {
        setDevices(result.data.devices)
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

  // Check service status and fetch interfaces when runtime connection changes
  useEffect(() => {
    if (isConnectedToRuntime) {
      void checkServiceStatus()
      void fetchInterfaces()
    } else {
      setServiceAvailable(null)
      setInterfaces([])
      setDevices([])
      setSelectedInterface('')
    }
  }, [isConnectedToRuntime, checkServiceStatus, fetchInterfaces])

  // Get selected device details
  const selectedDevice = useMemo(() => {
    if (selectedDevicePosition === null) return null
    return devices.find((d) => d.position === selectedDevicePosition) || null
  }, [devices, selectedDevicePosition])

  // Render not connected state
  if (!isConnectedToRuntime) {
    return (
      <div aria-label='EtherCAT editor container' className='flex h-full w-full flex-col overflow-hidden p-4'>
        <div className='mb-4'>
          <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>
            EtherCAT Device: {deviceName}
          </h2>
          <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: EtherCAT</p>
        </div>
        <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700'>
          <div className='text-center'>
            <p className='text-sm font-medium text-neutral-700 dark:text-neutral-300'>Not connected to runtime</p>
            <p className='mt-1 text-xs text-neutral-500 dark:text-neutral-400'>
              Connect to the OpenPLC Runtime to scan for EtherCAT devices.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Render service not available state
  if (serviceAvailable === false) {
    return (
      <div aria-label='EtherCAT editor container' className='flex h-full w-full flex-col overflow-hidden p-4'>
        <div className='mb-4'>
          <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>
            EtherCAT Device: {deviceName}
          </h2>
          <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: EtherCAT</p>
        </div>
        <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20'>
          <div className='text-center'>
            <p className='text-sm font-medium text-yellow-700 dark:text-yellow-300'>
              EtherCAT Discovery Service Not Available
            </p>
            <p className='mt-1 max-w-md text-xs text-yellow-600 dark:text-yellow-400'>{serviceMessage}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div aria-label='EtherCAT editor container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      {/* Header */}
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>EtherCAT Device: {deviceName}</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>Protocol: EtherCAT</p>
      </div>

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
            'Scan Devices'
          )}
        </button>

        {scanTimeMs !== null && (
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>Scan completed in {scanTimeMs}ms</span>
        )}
      </div>

      {/* Error/Status Messages */}
      {scanError && (
        <div className='mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
          <p className='text-sm text-red-700 dark:text-red-300'>{scanError}</p>
        </div>
      )}

      {scanMessage && !scanError && (
        <div className='mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-900/20'>
          <p className='text-sm text-green-700 dark:text-green-300'>{scanMessage}</p>
        </div>
      )}

      {/* Devices Table */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='mb-2'>
          <h3 className='text-sm font-medium text-neutral-950 dark:text-neutral-100'>
            Discovered Devices {devices.length > 0 && `(${devices.length})`}
          </h3>
        </div>

        <DeviceScanTable
          devices={devices}
          selectedPosition={selectedDevicePosition}
          onSelectDevice={setSelectedDevicePosition}
          isScanning={isScanning}
        />
      </div>

      {/* Selected Device Details */}
      {selectedDevice && (
        <div className='mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900'>
          <h4 className='mb-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'>
            Device Details: {selectedDevice.name}
          </h4>
          <div className='grid grid-cols-2 gap-x-8 gap-y-1 text-xs md:grid-cols-4'>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Position:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>{selectedDevice.position}</span>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Vendor ID:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>0x{selectedDevice.vendor_id.toString(16)}</span>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Product Code:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>
                0x{selectedDevice.product_code.toString(16)}
              </span>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Revision:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>0x{selectedDevice.revision.toString(16)}</span>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Serial:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>{selectedDevice.serial_number || 'N/A'}</span>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>State:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>{selectedDevice.state}</span>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>CoE Support:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>{selectedDevice.has_coe ? 'Yes' : 'No'}</span>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>I/O:</span>{' '}
              <span className='text-neutral-700 dark:text-neutral-300'>
                {selectedDevice.input_bytes}B in / {selectedDevice.output_bytes}B out
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { EtherCATEditor }
