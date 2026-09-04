/**
 * Runtime Status (RTOP-283).
 *
 * One screen for "what is this device and how is it doing". It carries the
 * scan-cycle, EtherCAT and plugin statistics that used to sit at the bottom of
 * the device Configuration screen -- they were never configuration, and they
 * were only reachable by scrolling past a pin-mapping table.
 *
 * The header adds what the device reports about itself, and the version-change
 * action. That action appears only when a bootloader is present: on a native
 * install or an orchestrator-managed vPLC there is nothing on the device that
 * could perform a swap, and offering a button that cannot work is worse than
 * offering none.
 */

import type { TimingStats } from '@root/middleware/shared/ports/types'
import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useState } from 'react'

import { useOpenPLCStore } from '../../../../../../store'
import { EtherCATStats } from '../../../../../_molecules/ethercat-stats'
import { PluginStatsPanel } from '../../../../../_molecules/plugin-stats-panel'
import { ScanCycleStats } from '../../../../../_molecules/scan-cycle-stats'
import { ChangeVersionModal } from './change-version-modal'

type DeviceInfo = {
  hostname?: string
  architecture?: string
  kernel?: string
  system?: string
  containerized?: boolean
  updatePolicy?: string
}

type BootloaderInfo = {
  present: boolean
  version?: string
  state?: string
  recovery?: boolean
  reason?: string
}

const RuntimeStatusEditor = () => {
  const runtime = useRuntime()

  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const runtimeVersion = useOpenPLCStore((state) => state.runtimeConnection.runtimeVersion)
  const ipAddress = useOpenPLCStore((state) => state.runtimeConnection.ipAddress)
  const timingStats = useOpenPLCStore((state): TimingStats | null => state.runtimeConnection.timingStats)
  const storedCredentials = useOpenPLCStore((state) => state.runtimeConnection.storedCredentials)
  const setIncludeTimingStatsInPolling = useOpenPLCStore(
    (state): ((include: boolean) => void) => state.deviceActions.setIncludeTimingStatsInPolling,
  )
  const setIncludeEthercatStatsInPolling = useOpenPLCStore(
    (state): ((include: boolean) => void) => state.deviceActions.setIncludeEthercatStatsInPolling,
  )

  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [bootloader, setBootloader] = useState<BootloaderInfo>({ present: false })
  const [changeOpen, setChangeOpen] = useState(false)

  const connected = connectionStatus === 'connected'

  /**
   * Ask the device about itself.
   *
   * The bootloader probe is expected to fail on most devices, so a failure is
   * recorded as "no bootloader" rather than surfaced as an error. Signing in
   * reuses the credentials the operator already gave the runtime: the two
   * services read one user database, so there is nothing more to ask for.
   */
  const refresh = useCallback(async () => {
    if (!connected) return

    const info = await runtime.getDeviceInfo()
    setDeviceInfo(info.success ? (info.data ?? null) : null)

    const capabilities = await runtime.bootloader.getCapabilities()
    if (!capabilities.success) {
      setBootloader({ present: false })
      return
    }

    const next: BootloaderInfo = {
      present: true,
      version: capabilities.data.bootloaderVersion,
      state: capabilities.data.state,
      recovery: capabilities.data.recovery,
    }

    if (storedCredentials) {
      const signIn = await runtime.bootloader.login(storedCredentials.username, storedCredentials.password)
      if (signIn.success) {
        const status = await runtime.bootloader.getStatus()
        if (status.success) {
          next.state = status.data.state
          next.recovery = status.data.recovery ?? next.recovery
          next.reason = status.data.reason
        }
      }
    }
    setBootloader(next)
  }, [connected, runtime, storedCredentials])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Ask the global poller for the statistics this screen shows, and stop when
   * leaving it.
   *
   * These toggles moved here from the Configuration screen along with the
   * statistics themselves: the screen that displays data is the one that
   * should be asking a device for it.
   */
  useEffect(() => {
    setIncludeTimingStatsInPolling(true)
    setIncludeEthercatStatsInPolling(true)
    return () => {
      setIncludeTimingStatsInPolling(false)
      setIncludeEthercatStatsInPolling(false)
    }
  }, [setIncludeTimingStatsInPolling, setIncludeEthercatStatsInPolling])

  if (!connected) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>
          Connect to a runtime to see its status.
        </p>
      </div>
    )
  }

  return (
    <div
      aria-label='Runtime status container'
      className='flex h-full w-full flex-col gap-6 overflow-auto p-6'
      id='runtime-status-container'
    >
      <header className='flex flex-col gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800'>
        <div className='flex items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h2 className='select-none text-lg font-medium text-neutral-950 dark:text-white'>Runtime Status</h2>
            <p className='text-sm text-neutral-500 dark:text-neutral-400'>
              {deviceInfo?.hostname ? `${deviceInfo.hostname} · ` : ''}
              {ipAddress ?? 'unknown address'}
            </p>
          </div>

          {/* Only when the device can actually do it. */}
          {bootloader.present && (
            <button
              className='shrink-0 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white'
              onClick={() => setChangeOpen(true)}
              type='button'
            >
              Change runtime version
            </button>
          )}
        </div>

        {bootloader.recovery && (
          <div
            className='rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950'
            role='alert'
          >
            <p className='text-sm font-medium text-amber-900 dark:text-amber-200'>
              The runtime is not running. The device is in recovery.
            </p>
            {bootloader.reason && (
              <p className='mt-1 text-xs text-amber-800 dark:text-amber-300'>{bootloader.reason}</p>
            )}
            <p className='mt-1 text-xs text-amber-800 dark:text-amber-300'>
              Install a different version to recover it.
            </p>
          </div>
        )}

        <dl className='grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-3'>
          <InfoField label='Runtime version' value={runtimeVersion} />
          <InfoField label='Architecture' value={deviceInfo?.architecture} />
          <InfoField label='Kernel' value={deviceInfo?.kernel} />
          <InfoField label='Host' value={deviceInfo?.hostname} />
          <InfoField
            label='Deployment'
            // An absent flag is not a claim of "Native". Belt and braces with
            // the schema guard: a runtime may report a subset of these fields,
            // and the one thing this must never do is assert a deployment
            // shape it was not told about.
            value={describeDeployment(deviceInfo?.containerized)}
          />
          <InfoField label='Updates' value={describePolicy(deviceInfo?.updatePolicy)} />
          {bootloader.present && <InfoField label='Bootloader' value={bootloader.version} />}
        </dl>
      </header>

      <div className='flex w-full flex-col gap-6'>
        {timingStats ? (
          <ScanCycleStats timingStats={timingStats} />
        ) : (
          <p className='text-sm text-neutral-500 dark:text-neutral-400'>
            No scan-cycle statistics yet. They appear once a program is running.
          </p>
        )}
        <EtherCATStats />
        <PluginStatsPanel pluginStats={timingStats?.plugin_stats} />
      </div>

      <ChangeVersionModal
        currentVersion={runtimeVersion}
        onFinished={() => void refresh()}
        onOpenChange={setChangeOpen}
        open={changeOpen}
      />
    </div>
  )
}

const InfoField = ({ label, value }: { label: string; value?: string | null }) => (
  <div className='flex flex-col'>
    <dt className='text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>{label}</dt>
    <dd className='text-sm text-neutral-900 dark:text-neutral-100'>{value || '—'}</dd>
  </div>
)

/**
 * Say who may change the version, in words rather than an enum.
 *
 * "managed" is the orchestrator case and the wording points the operator at
 * openplc-web rather than leaving them looking for a button that is not there.
 */
const describePolicy = (policy?: string): string | undefined => {
  switch (policy) {
    case 'self':
      return 'From this editor'
    case 'managed':
      return 'Managed by orchestrator'
    case 'manual':
      return 'Command line only'
    case 'none':
      return 'Provided by the device vendor'
    default:
      return undefined
  }
}


/** Only says what the device reported; silence stays silence. */
const describeDeployment = (containerized: boolean | undefined): string | undefined => {
  if (containerized === undefined) return undefined
  return containerized ? 'Container' : 'Native'
}

export { RuntimeStatusEditor }
