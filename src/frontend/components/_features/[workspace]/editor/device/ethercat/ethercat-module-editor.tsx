import * as Tabs from '@radix-ui/react-tabs'
import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import type {
  ConfiguredEtherCATModule,
  ESIChannel,
  ESICoEObject,
  ESIModule,
  EtherCATChannelMapping,
  PersistedChannelInfo,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import { useEsi } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ChannelMappingsSection, SdoParametersSection } from './components/device-configuration-form'
import { ProcessDataTab } from './components/process-data-tab'

type ModuleDetailTab = 'channel-mappings' | 'info' | 'process-data' | 'startup-params'

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

interface EtherCATModuleEditorProps {
  busName: string
  deviceId: string
  moduleId: string
}

// Build ESIChannel rows the shared ChannelMappingTable expects, from the
// persisted channel info stored on the module. Fields the table does not read
// (pdoName, bitOffset, byteOffset) are filled with safe defaults.
const synthesizeChannels = (channelInfo: PersistedChannelInfo[] | undefined): ESIChannel[] =>
  (channelInfo ?? []).map((ci) => ({
    id: ci.channelId,
    direction: ci.direction,
    pdoIndex: ci.pdoIndex,
    pdoName: '',
    entryIndex: ci.entryIndex,
    entrySubIndex: ci.entrySubIndex,
    name: ci.name,
    dataType: ci.dataType,
    bitLen: ci.bitLen,
    bitOffset: 0,
    byteOffset: 0,
    iecType: ci.iecType,
  }))

/**
 * Standalone editor for one I/O module plugged into a modular EtherCAT coupler.
 * Opened from the project tree as the leaf under its coupler. Shows only the
 * module's own view — never the coupler's tabs.
 */
const EtherCATModuleEditor = ({ busName, deviceId, moduleId }: EtherCATModuleEditorProps) => {
  const store = useOpenPLCStoreApi()
  const { project, projectActions, workspaceActions } = useOpenPLCStore()
  const esi = useEsi()

  const [activeTab, setActiveTab] = useState<ModuleDetailTab>('channel-mappings')
  const [esiModule, setEsiModule] = useState<ESIModule | null>(null)
  const [isLoadingEsi, setIsLoadingEsi] = useState(true)
  const [esiError, setEsiError] = useState<string | null>(null)

  const remoteDevice = useMemo(
    () => project.data.remoteDevices?.find((d) => d.name === busName),
    [project.data.remoteDevices, busName],
  )

  const configuredDevices = useMemo(() => remoteDevice?.ethercatConfig?.devices ?? [], [remoteDevice])

  const device = useMemo(() => configuredDevices.find((d) => d.id === deviceId) ?? null, [configuredDevices, deviceId])

  const module = useMemo(
    () => (device?.modules ?? []).find((m) => m.id === moduleId) ?? null,
    [device?.modules, moduleId],
  )

  const deviceName = device?.name ?? ''
  const masterConfig = useMemo(
    () =>
      remoteDevice?.ethercatConfig?.masterConfig ?? {
        networkInterface: 'eth0',
        cycleTimeUs: 1000,
        watchdogTimeoutCycles: 3,
      },
    [remoteDevice],
  )

  const syncModuleToStore = useCallback(
    (next: ConfiguredEtherCATModule) => {
      if (!device) return
      const nextModules = (device.modules ?? []).map((m) => (m.id === moduleId ? next : m))
      const nextDevices = configuredDevices.map((d) => (d.id === deviceId ? { ...d, modules: nextModules } : d))
      projectActions.updateEthercatConfig(busName, { masterConfig, devices: nextDevices })
      const { sharedWorkspaceActions } = store.getState()
      if (deviceName) sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
      else workspaceActions.setEditingState('unsaved')
    },
    [
      busName,
      configuredDevices,
      device,
      deviceId,
      deviceName,
      masterConfig,
      moduleId,
      projectActions,
      store,
      workspaceActions,
    ],
  )

  // Resolve the ESI module. For an inline module (declared in the coupler's
  // own ESI) we read the coupler's full ESI and scan its `.modules`. For a
  // standalone module file, iterate the repo item's devices to find the one
  // carrying this ident.
  useEffect(() => {
    if (!esi || !module) return
    let cancelled = false
    setIsLoadingEsi(true)
    setEsiError(null)
    void (async () => {
      try {
        const target = module.esiModuleRef.moduleIdent.toLowerCase()
        const repoId = module.esiModuleRef.repositoryItemId
        const summary = await esi.loadRepositoryLight()
        if (cancelled) return
        if (!summary.success) {
          setEsiError(summary.error ?? 'Could not load ESI repository.')
          setIsLoadingEsi(false)
          return
        }
        const repoItem = summary.items.find((it) => it.id === repoId)
        if (!repoItem) {
          setEsiError('ESI file for this module is not in the repository.')
          setIsLoadingEsi(false)
          return
        }
        const deviceCount = repoItem.devices?.length ?? 0
        for (let i = 0; i < Math.max(deviceCount, 1); i++) {
          const r = await esi.loadDeviceFull(repoId, i)
          if (cancelled) return
          if (!r.success || !r.device) continue
          const match = r.device.modules?.find((m) => m.ident.toLowerCase() === target)
          if (match) {
            setEsiModule(match)
            setIsLoadingEsi(false)
            return
          }
        }
        setEsiError('Module definition not found in its ESI file.')
        setIsLoadingEsi(false)
      } catch (e) {
        if (cancelled) return
        setEsiError(e instanceof Error ? e.message : 'Failed to load ESI module.')
        setIsLoadingEsi(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [esi, module])

  const handleUpdateChannelMappings = useCallback(
    (channelMappings: EtherCATChannelMapping[]) => {
      if (!module) return
      syncModuleToStore({ ...module, channelMappings })
    },
    [module, syncModuleToStore],
  )

  const handleAliasChange = useCallback(
    (channelId: string, alias: string) => {
      if (!module) return
      const existing = module.channelMappings.find((m) => m.channelId === channelId)
      const next: EtherCATChannelMapping[] =
        existing !== undefined
          ? module.channelMappings.map((m) => (m.channelId === channelId ? { ...m, alias } : m))
          : [...module.channelMappings, { channelId, iecLocation: '', alias }]
      handleUpdateChannelMappings(next)
    },
    [module, handleUpdateChannelMappings],
  )

  const handleUpdateSdoConfigurations = useCallback(
    (sdoConfigurations: SDOConfigurationEntry[]) => {
      if (!module) return
      syncModuleToStore({ ...module, sdoConfigurations })
    },
    [module, syncModuleToStore],
  )

  const handleUpdatePdoAssigned = useCallback(
    (direction: 'rx' | 'tx', pdoIndex: string, assigned: boolean) => {
      if (!module) return
      const list = (direction === 'rx' ? module.rxPdos : module.txPdos) ?? []
      const nextList = list.map((p) => (p.index.toLowerCase() === pdoIndex.toLowerCase() ? { ...p, assigned } : p))
      syncModuleToStore(direction === 'rx' ? { ...module, rxPdos: nextList } : { ...module, txPdos: nextList })
    },
    [module, syncModuleToStore],
  )

  const channels = useMemo(() => synthesizeChannels(module?.channelInfo), [module?.channelInfo])
  const coeObjects: ESICoEObject[] | undefined = esiModule?.coeObjects

  // DOPE-704 E4: PdoAssign availability on a module tracks the containing slave's
  // CoE flag — the coupler's `0x1C1n` write is what reassigns module PDOs.
  const pdoAssignAvailable = device?.config.coeFlags?.pdoAssign === true

  if (!device || !module) {
    return (
      <div aria-label='EtherCAT module editor container' className='flex h-full w-full items-center justify-center p-6'>
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>Module not found in this project.</p>
      </div>
    )
  }

  return (
    <div aria-label='EtherCAT module editor container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-4 shrink-0'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>
          {module.name}
          <span className='ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400'>
            Slot {module.slot} · {module.ident}
          </span>
        </h2>
        <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>on {device.name}</p>
      </div>

      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ModuleDetailTab)}
        className='flex min-h-0 flex-1 flex-col overflow-hidden'
      >
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='channel-mappings' label='Channel Mappings' isActive={activeTab === 'channel-mappings'} />
          <TabItem value='info' label='Device Info' isActive={activeTab === 'info'} />
          <TabItem value='process-data' label='Process Data' isActive={activeTab === 'process-data'} />
          <TabItem value='startup-params' label='Startup Parameters' isActive={activeTab === 'startup-params'} />
        </Tabs.List>

        <Tabs.Content
          value='channel-mappings'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <ChannelMappingsSection
              isLoading={false}
              loadError={null}
              channels={channels}
              mappings={module.channelMappings}
              onAliasChange={handleAliasChange}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content
          value='info'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <div className='grid grid-cols-2 gap-x-6 gap-y-3 text-xs'>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Name</span>
                <span className='text-neutral-700 dark:text-neutral-300'>{module.name}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Slot</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{module.slot}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Ident</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{module.ident}</span>
              </div>
              {esiModule?.moduleClass && (
                <div className='flex flex-col gap-0.5'>
                  <span className='font-medium text-neutral-500 dark:text-neutral-400'>Class</span>
                  <span className='text-neutral-700 dark:text-neutral-300'>{esiModule.moduleClass}</span>
                </div>
              )}
              {esiModule?.description && (
                <div className='col-span-2 flex flex-col gap-0.5'>
                  <span className='font-medium text-neutral-500 dark:text-neutral-400'>Description</span>
                  <span className='text-neutral-700 dark:text-neutral-300'>{esiModule.description}</span>
                </div>
              )}
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Coupler</span>
                <span className='text-neutral-700 dark:text-neutral-300'>{device.name}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Bus</span>
                <span className='text-neutral-700 dark:text-neutral-300'>{busName}</span>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content
          value='process-data'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <ProcessDataTab
              rxPdos={module.rxPdos ?? []}
              txPdos={module.txPdos ?? []}
              pdoAssignAvailable={pdoAssignAvailable}
              onUpdatePdoAssigned={handleUpdatePdoAssigned}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content
          value='startup-params'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <SdoParametersSection
              isLoading={isLoadingEsi}
              loadError={esiError}
              sdoConfigurations={module.sdoConfigurations}
              coeObjects={coeObjects}
              onUpdateSdoConfigurations={handleUpdateSdoConfigurations}
            />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

export { EtherCATModuleEditor }
