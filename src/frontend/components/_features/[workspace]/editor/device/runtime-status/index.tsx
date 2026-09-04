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
import { useOrchestrator, useRuntime } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useState } from 'react'

import { useOpenPLCStore } from '../../../../../../store'
import { EtherCATStats } from '../../../../../_molecules/ethercat-stats'
import { PluginStatsPanel } from '../../../../../_molecules/plugin-stats-panel'
import { ScanCycleStats } from '../../../../../_molecules/scan-cycle-stats'
import { ChangeVersionModal } from './change-version-modal'

/** What the bootloader reports about the machine; every field may be absent. */
type DeviceInfo = {
  hostname?: string
  architecture?: string
  kernel?: string
  system?: string
  cpus?: number
  memoryBytes?: number
  dockerVersion?: string
  /**
   * Version of the orchestrator agent, when the facts came from one rather
   * than from a bootloader. Named so the header can say which it is looking
   * at instead of implying a bootloader that is not there.
   */
  agentVersion?: string
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
  const setRuntimeVersion = useOpenPLCStore((state) => state.deviceActions.setRuntimeVersion)
  const ipAddress = useOpenPLCStore((state) => state.runtimeConnection.ipAddress)
  const selectedDevice = useOpenPLCStore((state) => state.runtimeConnection.selectedDevice)
  // Used only when no bootloader answers, which under an orchestrator is
  // always: a vPLC has no bootloader container beside it.
  const orchestrator = useOrchestrator()
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
   * Everything here comes from the bootloader, which is the only component
   * present on every device this screen can act on. The runtime was the
   * obvious place to ask and the wrong one: a device running any released
   * runtime has no endpoint to answer, so the header stayed empty on precisely
   * the devices an operator opens this screen to look at.
   *
   * The probe is expected to fail on most devices -- a native install or an
   * orchestrator-managed vPLC has no bootloader -- so a failure is recorded as
   * "no bootloader" rather than surfaced as an error. Signing in reuses the
   * credentials the operator already gave the runtime: the two services read
   * one user database, so there is nothing more to ask for.
   */
  /**
   * Host facts from the orchestrator agent, for a device with no bootloader.
   *
   * Deliberately a different shape of answer: the agent describes the HOST
   * running the vPLC, not the container, and it cannot report a kernel version
   * (Edge's response type drops the field the agent sends) or an
   * architecture. What it does give is enough to stop the header being empty,
   * which is what it was for every orchestrator-managed device.
   */
  const hostInfoFromOrchestrator = useCallback(async (): Promise<DeviceInfo | null> => {
    const orchestratorId = selectedDevice?.orchestratorId
    if (!orchestratorId || !orchestrator.getOrchestratorHostInfo) return null

    const host = await orchestrator.getOrchestratorHostInfo(orchestratorId)
    if (!host) return null

    const cpus = host.cpu !== undefined ? Number(host.cpu) : undefined
    // The agent reports total RAM in MB; the header formats bytes.
    const megabytes = host.memory !== undefined ? Number(host.memory) : undefined
    return {
      hostname: host.name,
      system: host.os,
      cpus: Number.isFinite(cpus) ? cpus : undefined,
      memoryBytes: Number.isFinite(megabytes) ? (megabytes as number) * 1024 * 1024 : undefined,
      agentVersion: host.agentVersion,
    }
  }, [orchestrator, selectedDevice?.orchestratorId])

  const refresh = useCallback(async () => {
    // Disconnected clears everything. The component stays mounted while
    // disconnected, and returning early without clearing left the PREVIOUS
    // device's hostname, kernel and memory in the header -- so reconnecting to
    // a different device whose login is refused, or one with no stored
    // credentials, described a machine that was no longer there.
    if (!connected) {
      setDeviceInfo(null)
      // Idempotent on purpose. A fresh object here is a state change on every
      // call, and `refresh` re-runs whenever the runtime port's identity does
      // -- which is enough to spin: set state, re-render, refresh, set state.
      setBootloader((previous) => (previous.present ? { present: false } : previous))
      return
    }

    const capabilities = await runtime.bootloader.getCapabilities()
    if (!capabilities.success) {
      setBootloader({ present: false })

      // No bootloader is the NORMAL case in production: a device under an
      // orchestrator is a vPLC container with no bootloader beside it, so
      // there is nothing on 8445 to ask. The agent managing it knows the same
      // sort of facts about its host, and Edge exposes them -- so the header
      // reports those instead of sitting blank.
      setDeviceInfo(await hostInfoFromOrchestrator())
      return
    }
    // Cleared before the login below, so a failure there cannot leave stale
    // facts on screen.
    setDeviceInfo(null)

    const next: BootloaderInfo = {
      present: true,
      version: capabilities.data.bootloaderVersion,
      state: capabilities.data.state,
      recovery: capabilities.data.recovery,
    }

    if (storedCredentials) {
      const signIn = await runtime.bootloader.login(storedCredentials.username, storedCredentials.password)
      if (signIn.success) {
        const [status, info] = await Promise.all([
          runtime.bootloader.getStatus(),
          runtime.bootloader.getDeviceInfo(),
        ])
        if (status.success) {
          next.state = status.data.state
          next.recovery = status.data.recovery ?? next.recovery
          next.reason = status.data.reason
        }
        setDeviceInfo(info.success ? (info.data ?? null) : null)

        // The store's runtimeVersion is written once, at connect time, so
        // after installing v4.2.1 over v4.2.0 the header still said v4.2.0 --
        // and the picker offered v4.2.1 as installable while disabling
        // Install on the version that was no longer running. Both the status
        // and the capabilities reply carry the truth.
        const reported = status.success
          ? (status.data.runtimeVersion ?? capabilities.data.runtimeVersion)
          : capabilities.data.runtimeVersion
        // Compared against the store directly rather than the rendered
        // value: depending on runtimeVersion here would rebuild `refresh`
        // whenever it changed, re-running the effect that calls it.
        if (reported && reported !== useOpenPLCStore.getState().runtimeConnection.runtimeVersion) {
          setRuntimeVersion(reported)
        }
      }
    }
    setBootloader(next)
  }, [connected, runtime, storedCredentials, setRuntimeVersion, hostInfoFromOrchestrator])

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
              {describeDevice(deviceInfo?.hostname, selectedDevice?.deviceName, ipAddress)}
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
          {bootloader.present ? (
            <InfoField label='Bootloader' value={bootloader.version} />
          ) : (
            // Names the source, so a blank kernel/architecture reads as "the
            // agent does not report these" rather than "something is wrong".
            <InfoField label='Orchestrator agent' value={deviceInfo?.agentVersion} />
          )}
          <InfoField label='Host' value={deviceInfo?.hostname} />
          <InfoField label='Operating system' value={deviceInfo?.system} />
          <InfoField label='Kernel' value={deviceInfo?.kernel} />
          <InfoField label='Architecture' value={deviceInfo?.architecture} />
          {/* CPU count is the one host fact with an operational consequence
              here: a scan task per core is the budget, and an operator sizing
              tasks needs the number in front of them. */}
          <InfoField label='CPU cores' value={deviceInfo?.cpus?.toString()} />
          <InfoField label='Memory' value={describeMemory(deviceInfo?.memoryBytes)} />
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
 * Name the device this screen is actually showing.
 *
 * `runtimeConnection.ipAddress` is NOT that address whenever a device is
 * reached through an orchestrator: it is the IP saved in the project's Device
 * configuration, which has no relationship to the device being displayed. On a
 * project carrying an old address, the header confidently labelled a device
 * with a machine somewhere else on the network.
 *
 * So the connected device's own name wins, and the direct-connection address
 * is used only when there is no orchestrator in the picture. The hostname the
 * machine reports for itself is added when it says something the identifier
 * does not.
 */
const describeDevice = (
  hostname: string | undefined,
  deviceName: string | undefined,
  ipAddress: string | null,
): string => {
  const identity = deviceName ?? ipAddress ?? undefined
  if (hostname && identity && hostname !== identity) return `${hostname} · ${identity}`
  return hostname ?? identity ?? 'unknown device'
}

/**
 * Total RAM, in the units a datasheet uses.
 *
 * Powers of 1024 rather than 1000: the daemon reports what the kernel sees, so
 * 1935417344 is the 2 GB a board is sold as, and rounding it to "1.9 GB" would
 * leave someone comparing it against the wrong number.
 */
const describeMemory = (bytes: number | undefined): string | undefined => {
  if (bytes === undefined || bytes <= 0) return undefined
  const gib = bytes / 1024 ** 3
  return gib >= 1 ? `${gib.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

export { RuntimeStatusEditor }
