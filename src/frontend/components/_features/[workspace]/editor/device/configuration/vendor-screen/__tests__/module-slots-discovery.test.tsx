import type { PluginCommandOutcome } from '@root/backend/shared/utils/vpp/screen-actions'
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import type { ModuleSystem, ScreenSection } from '../index'
import { ModuleSlotsLayout } from '../layouts/module-slots-layout'

/**
 * Module auto-detection end to end inside the layout: the click sends the
 * command, the answer opens a confirmation, and only an explicit yes writes.
 */

const BOARD = 'SLM-RP4'

const io = { digitalInputs: 0, digitalOutputs: 0, analogInputs: 8, analogOutputs: 0 }
// Every module exposes a channel named CH1, so a carried alias would be visible on a replaced slot.
const addressMapping = {
  baseAddressType: 'auto',
  channels: [{ name: 'CH1', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW' }],
}
const MODULE_SYSTEM: NonNullable<ModuleSystem> = {
  enabled: true,
  maxSlots: 15,
  discoverySupported: true,
  modules: [
    { id: 'slm-ai-8-v', name: 'SLM-AI-8-V', hwId: '0x34A055EB', io, addressMapping },
    { id: 'slm-thm-4', name: 'SLM-THM-4', hwId: '0x34608CE1', io, addressMapping },
    { id: 'slm-acdci-8np-rly8', name: 'SLM-ACDCI-8NP-RLY8', hwId: '0x24A500E1', io, addressMapping },
  ],
}

const SECTION: ScreenSection = {
  id: 'backplane',
  title: 'Backplane Configuration',
  layout: 'module-slots',
  maxSlots: 15,
  stackable: true,
  moduleSource: 'manifest',
  persistence: 'module-configuration',
  actions: [
    {
      id: 'detect_modules',
      label: 'Auto-Detect Modules',
      type: 'command',
      command: 'discover_modules',
      requiresConnection: true,
      confirm: 'The current backplane configuration will be replaced by the modules found.',
      resultMapping: { path: 'modules', slotField: 'slot', moduleIdField: 'hwId' },
    },
  ],
}

const THERMOCOUPLE = { tc_type: 'K', burnout: 'upscale', units: 'F', ch3_enabled: false }

let store: OpenPLCStore
let sent: unknown[]

function ports(answer: PluginCommandOutcome): PlatformPorts {
  sent = []
  return {
    runtime: {
      sendPluginCommand: (args: unknown) => {
        sent.push(args)
        return Promise.resolve(answer)
      },
    },
    device: { getPreviewImage: () => Promise.resolve('') },
    capabilities: {},
  } as unknown as PlatformPorts
}

function moduleConfig(): { slots?: (string | null)[]; slotsConfig?: Record<string, unknown> } {
  const vsd = store.getState().deviceDefinitions.configuration.vendorScreenData ?? {}
  return (vsd['module-configuration'] ?? {}) as { slots?: (string | null)[]; slotsConfig?: Record<string, unknown> }
}

function renderLayout(
  answer: PluginCommandOutcome,
  moduleSystem: NonNullable<ModuleSystem> = MODULE_SYSTEM,
  section: ScreenSection = SECTION,
) {
  return render(<ModuleSlotsLayout section={section} moduleSystem={moduleSystem} />, {
    wrapper: createStoreWrapper(store, ports(answer)),
  })
}

function aliases(): Record<number, string> {
  const vsd = store.getState().deviceDefinitions.configuration.vendorScreenData ?? {}
  const entries = (vsd['io-mapping'] as { entries?: Array<{ slot: number; alias: string }> } | undefined)?.entries ?? []
  return Object.fromEntries(entries.map((e) => [e.slot, e.alias]))
}

function seedAliases() {
  const entry = (slot: number, moduleId: string, alias: string) => ({
    slot,
    moduleId,
    moduleName: moduleId,
    channelName: 'CH1',
    channelType: 'analogInput',
    dataType: 'INT',
    iecAddress: '',
    alias,
  })
  store.getState().deviceActions.setVendorScreenData('io-mapping', {
    entries: [entry(1, 'slm-thm-4', 'oven_temp'), entry(2, 'slm-ai-8-v', 'tank_level'), entry(3, 'slm-ai-8-v', 'flow')],
  })
}

const FOUND: PluginCommandOutcome = {
  ok: true,
  data: {
    modules: [
      { slot: 1, hwId: '0x34608CE1' },
      { slot: 2, hwId: '0x24A500E1' },
    ],
    count: 2,
  },
}

describe('ModuleSlotsLayout module auto-detection', () => {
  beforeEach(() => {
    store = createTestStore()
    const board = { compiler: 'openplc-compiler', core: '', preview: '', specs: {}, vpp: { pluginName: 'synergy' } }
    store.getState().deviceActions.setAvailableOptions({
      availableBoards: new Map([[BOARD, board as unknown as BoardInfo]]),
    })
    store.getState().deviceActions.setDeviceBoard(BOARD)
    store.getState().deviceActions.setVendorScreenData('module-configuration', {
      slots: ['slm-thm-4', 'slm-ai-8-v', 'slm-ai-8-v'],
      slotsConfig: { '1': THERMOCOUPLE, '2': { range: '0-5V' }, '3': { range: '0-10V' } },
    })
    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
  })

  afterEach(cleanup)

  it('is disabled while disconnected', () => {
    store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
    renderLayout(FOUND)

    const button = screen.getByRole('button', { name: 'Auto-Detect Modules' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(sent).toEqual([])
  })

  it('is hidden when the device does not support discovery', () => {
    renderLayout(FOUND, { ...MODULE_SYSTEM, discoverySupported: false })

    expect(screen.queryByRole('button', { name: 'Auto-Detect Modules' })).toBeNull()
  })

  it('detects nothing on mount and sends to the config template plugin on click', async () => {
    renderLayout(FOUND)
    expect(sent).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() => expect(screen.getByTestId('vpp-discovery-changes')).toBeTruthy())
    expect(sent).toEqual([{ plugin: 'synergy', command: 'discover_modules', params: {} }])
  })

  it('changes nothing when the user cancels', async () => {
    const before = JSON.stringify(moduleConfig())
    renderLayout(FOUND)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByTestId('vpp-discovery-changes')).toBeNull())
    expect(JSON.stringify(moduleConfig())).toBe(before)
  })

  it('lists what will change and applies it on yes, keeping matched settings', async () => {
    renderLayout(FOUND)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))
    const list = await screen.findByTestId('vpp-discovery-changes')
    expect(list.textContent).toContain('SLM-THM-4, unchanged (settings kept)')
    expect(list.textContent).toContain('SLM-AI-8-V replaced by SLM-ACDCI-8NP-RLY8 (default settings, aliases cleared)')
    expect(list.textContent).toContain('SLM-AI-8-V removed')
    expect(screen.getByText('The current backplane configuration will be replaced by the modules found.')).toBeTruthy()
    expect(screen.getByText('Replace Backplane Configuration?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Replace configuration' }))

    await waitFor(() => expect(moduleConfig().slots?.slice(0, 3)).toEqual(['slm-thm-4', 'slm-acdci-8np-rly8', null]))
    expect(JSON.stringify(moduleConfig().slotsConfig)).toBe(JSON.stringify({ '1': THERMOCOUPLE }))
  })

  it('shows the device refusal and changes nothing', async () => {
    const before = JSON.stringify(moduleConfig())
    renderLayout({ ok: false, error: 'Stop the PLC before detecting modules.' })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() => expect(screen.getByText('Stop the PLC before detecting modules.')).toBeTruthy())
    expect(screen.queryByTestId('vpp-discovery-changes')).toBeNull()
    expect(JSON.stringify(moduleConfig())).toBe(before)
  })

  it('refuses an unknown module without opening the dialog', async () => {
    const before = JSON.stringify(moduleConfig())
    renderLayout({ ok: true, data: { modules: [{ slot: 1, hwId: '0xDEADBEEF' }], count: 1 } })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-detect_modules').textContent).toContain('slot 1 (0xDEADBEEF)'),
    )
    expect(screen.queryByTestId('vpp-discovery-changes')).toBeNull()
    expect(JSON.stringify(moduleConfig())).toBe(before)
  })

  it('titles the dialog after the section', async () => {
    renderLayout(FOUND, MODULE_SYSTEM, { ...SECTION, title: 'Rack' })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    expect(await screen.findByText('Replace Rack?')).toBeTruthy()
  })

  it('keeps aliases of unchanged slots and clears those of a replaced slot on auto-detect', async () => {
    seedAliases()
    renderLayout(FOUND)
    await waitFor(() => expect(aliases()).toEqual({ 1: 'oven_temp', 2: 'tank_level', 3: 'flow' }))

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace configuration' }))

    await waitFor(() => expect(aliases()).toEqual({ 1: 'oven_temp', 2: '' }))
  })

  it('clears the alias of a replaced slot whose stored entry carries no module id', async () => {
    store.getState().deviceActions.setVendorScreenData('io-mapping', {
      entries: [1, 2].map((slot) => ({
        slot,
        moduleName: '',
        channelName: 'CH1',
        channelType: 'analogInput',
        dataType: 'INT',
        iecAddress: '',
        alias: slot === 1 ? 'oven_temp' : 'tank_level',
      })),
    })
    renderLayout(FOUND)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace configuration' }))

    await waitFor(() => expect(moduleConfig().slots?.[1]).toBe('slm-acdci-8np-rly8'))
    await waitFor(() => expect(aliases()).toEqual({ 1: 'oven_temp', 2: '' }))
  })

  it('applies nothing when the configuration changes while the confirmation is open', async () => {
    renderLayout(FOUND)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))
    const confirm = await screen.findByRole('button', { name: 'Replace configuration' })
    store.getState().deviceActions.setVendorScreenData('module-configuration', {
      slots: ['slm-thm-4', 'slm-acdci-8np-rly8', 'slm-thm-4'],
      slotsConfig: { '1': THERMOCOUPLE },
    })
    const changed = JSON.stringify(moduleConfig())
    fireEvent.click(confirm)

    await waitFor(() => expect(screen.queryByTestId('vpp-discovery-changes')).toBeNull())
    expect(JSON.stringify(moduleConfig())).toBe(changed)
  })

  it('clears the aliases of a slot whose module is changed by hand, as auto-detect does', async () => {
    seedAliases()
    renderLayout(FOUND)
    await waitFor(() => expect(aliases()).toEqual({ 1: 'oven_temp', 2: 'tank_level', 3: 'flow' }))

    fireEvent.click(screen.getByRole('button', { name: /^Slot 2/ }))
    const trigger = screen.getAllByRole('button').find((b) => b.getAttribute('aria-haspopup') === 'menu')
    if (!trigger) throw new Error('module picker not found')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: 'SLM-ACDCI-8NP-RLY8' }))

    await waitFor(() => expect(moduleConfig().slots?.[1]).toBe('slm-acdci-8np-rly8'))
    await waitFor(() => expect(aliases()).toEqual({ 1: 'oven_temp', 2: '', 3: 'flow' }))
  })

  it('applies a gapped answer on a section that is not stackable', async () => {
    const physical: ScreenSection = { ...SECTION, stackable: false, maxSlots: 4 }
    renderLayout(
      {
        ok: true,
        data: {
          modules: [
            { slot: 1, hwId: '0x34608CE1' },
            { slot: 3, hwId: '0x34A055EB' },
          ],
        },
      },
      MODULE_SYSTEM,
      physical,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace configuration' }))

    await waitFor(() => expect(moduleConfig().slots).toEqual(['slm-thm-4', null, 'slm-ai-8-v', null]))
    expect(moduleConfig().slotsConfig).toEqual({ '1': THERMOCOUPLE, '3': { range: '0-10V' } })
  })

  it('refuses a gapped answer on a stackable section', async () => {
    const before = JSON.stringify(moduleConfig())
    renderLayout({ ok: true, data: { modules: [{ slot: 2, hwId: '0x34A055EB' }] } })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() => expect(screen.getByTestId('vpp-action-result-detect_modules').textContent).toContain('no gaps'))
    expect(JSON.stringify(moduleConfig())).toBe(before)
  })
})
