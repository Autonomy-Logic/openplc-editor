import { applyConfiguratorSnapshot } from '@root/frontend/services/apply-configurator-snapshot'
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { getMemoryState } from '@root/frontend/utils/toast'
import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo, IoMappingEntry, PLCVariable } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import { manifestModuleFromCapture } from '@root/__fixtures__/device-editor-datapoints/manifest-module'
import { UR20_16DI_16DO } from '@root/__fixtures__/device-editor-datapoints/ur20-16di-16do'
import MAPPING_SCREEN from '@root/__fixtures__/weidmuller-screens/io-mapping.json'
import { VendorScreenRenderer } from '../index'
import { notifyDroppedAliases } from '../notify-dropped-aliases'
import { SectionRenderer } from '../section-renderer'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const BOARD = 'UC20-M3000'

const VPP_BOARD: BoardInfo = {
  compiler: 'openplc-compiler',
  core: 'openplc',
  preview: 'generic.png',
  specs: {},
  vpp: {
    packageId: 'com.weidmuller.ucontrol',
    vendor: 'Weidmüller',
    deviceId: 'uc20-m3000',
    packagePath: '/packages/com.weidmuller.ucontrol',
    screens: {},
    moduleSystem: {
      enabled: true,
      maxSlots: 64,
      modules: [
        manifestModuleFromCapture(UR20_16DI_16DO, 0, { id: 'ur20-16di-p', name: 'UR20-16DI-P' }),
        manifestModuleFromCapture(UR20_16DI_16DO, 1, { id: 'ur20-16do-p', name: 'UR20-16DO-P' }),
        {
          id: 'ur20-1sm-like',
          name: 'UR20-1SM-like',
          typeId: 'cafe0001',
          processImage: { inputBytes: 3, outputBytes: 0 },
          io: { digitalInputs: 1, digitalOutputs: 0, analogInputs: 1, analogOutputs: 0 },
          addressMapping: {
            channels: [
              { name: 'SmCJ+', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW', wire: { byte: 0 } },
              {
                name: 'txtValue_0.3',
                type: 'digitalInput',
                dataType: 'BOOL',
                addressPrefix: '%IX',
                wire: { byte: 2, bit: 3 },
              },
            ],
          },
        },
      ],
    },
  },
}

const PORTS: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort(),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort(),
  device: stubPort<DevicePort>({ getVendorDocumentUrl: () => null }),
  orchestrator: stubPort(),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  capabilities: EDITOR_CAPABILITIES,
}

const TARGET = { configuratorKey: 'configurator', controller: BOARD, bundleVersion: '3.5.22' }
const [DI_MODULE, DO_MODULE] = UR20_16DI_16DO.deviceSetup.devices

let store: OpenPLCStore

function ioEntries(): IoMappingEntry[] {
  const mapping = store.getState().deviceDefinitions.configuration.vendorScreenData?.['io-mapping']
  return mapping && typeof mapping === 'object' && 'entries' in mapping && Array.isArray(mapping.entries)
    ? mapping.entries
    : []
}

function stationState() {
  return JSON.stringify({
    vendorScreenData: store.getState().deviceDefinitions.configuration.vendorScreenData,
    project: store.getState().project.data,
  })
}

function renderScreen() {
  return render(<VendorScreenRenderer screenDefinition={MAPPING_SCREEN} moduleSystem={null} />, {
    wrapper: createStoreWrapper(store, PORTS),
  })
}

function aliasInput(channelName: string, slot: number): HTMLInputElement {
  const input = screen.getByLabelText(`Alias of ${channelName} in slot ${slot}`)
  if (!(input instanceof HTMLInputElement)) throw new Error('alias cell is not an input')
  return input
}

function commitAlias(channelName: string, slot: number, alias: string) {
  const input = aliasInput(channelName, slot)
  fireEvent.change(input, { target: { value: alias } })
  fireEvent.blur(input)
}

function seedGlobal(variable: PLCVariable) {
  const current = store.getState().project
  store.getState().projectActions.setProject({
    ...current,
    data: {
      ...current.data,
      configurations: {
        ...current.data.configurations,
        resource: { ...current.data.configurations.resource, globalVariables: [variable] },
      },
    },
  })
}

describe('io-table section with source device-setup', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD, VPP_BOARD]]) })
    store.getState().deviceActions.setDeviceBoard(BOARD)
    applyConfiguratorSnapshot(store, TARGET, { archive: 'ab'.repeat(64), deviceSetup: UR20_16DI_16DO.deviceSetup })
  })

  afterEach(cleanup)

  it('lists exactly the modules and channels the configurator reported, with their addresses', () => {
    renderScreen()

    expect(screen.getByRole('region', { name: `Slot 1 ${DI_MODULE.name}` })).toBeTruthy()
    expect(screen.getByRole('region', { name: `Slot 2 ${DO_MODULE.name}` })).toBeTruthy()
    expect(screen.getAllByLabelText(/^Alias of /)).toHaveLength(32)
    for (const entry of ioEntries()) expect(screen.getAllByText(entry.iecAddress).length).toBeGreaterThan(0)
  })

  it('scrolls the channels in their own region, with the slot and column headers pinned', () => {
    renderScreen()

    const channels = screen.getByRole('region', { name: 'I/O Mapping channels' })
    expect(channels.className).toContain('overflow-y-auto')
    const slot = within(channels).getByRole('region', { name: `Slot 1 ${DI_MODULE.name}` })
    expect(slot.querySelector('header')?.className).toContain('sticky')
    for (const header of within(slot).getAllByRole('columnheader')) expect(header.className).toContain('sticky')
  })

  it.each([
    ['Clear All', /clear all/i],
    ['Add module', /add module/i],
    ['Remove module', /remove module/i],
    ['the slot picker', /-- empty --/i],
  ])('does not render %s', (_control, label) => {
    renderScreen()

    expect(screen.queryByText(label)).toBeNull()
    expect(screen.queryByRole('button', { name: label })).toBeNull()
  })

  it('renders no drag handles, mode selects or parameter inputs: the only inputs are aliases', () => {
    const { container } = renderScreen()

    expect(container.querySelectorAll('[draggable="true"], [aria-roledescription="sortable"]')).toHaveLength(0)
    expect(container.querySelectorAll('select, [role="combobox"], [role="listbox"]')).toHaveLength(0)
    const inputs = Array.from(container.querySelectorAll('input, textarea'))
    expect(inputs).toHaveLength(32)
    for (const input of inputs) expect(input.getAttribute('aria-label')).toMatch(/^Alias of /)
  })

  it('ignores local actions a package declares on the section', () => {
    render(
      <SectionRenderer
        section={{
          id: 'io-mapping',
          title: 'I/O Mapping',
          layout: 'io-table',
          source: 'device-setup',
          actions: [{ id: 'clear', label: 'Clear All Slots', kind: 'local', action: 'clear-module-slots' }],
        }}
        moduleSystem={null}
      />,
      { wrapper: createStoreWrapper(store, PORTS) },
    )

    expect(screen.queryByText('Clear All Slots')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('gives none of the seven station-editing actions an entry point: every interaction leaves state unchanged', () => {
    const { container } = renderScreen()
    const before = stationState()

    for (const button of Array.from(container.querySelectorAll('button'))) fireEvent.click(button)
    for (const select of Array.from(container.querySelectorAll('select'))) {
      fireEvent.change(select, { target: { value: '' } })
    }
    const rows = Array.from(container.querySelectorAll('tbody tr, section'))
    expect(rows.length).toBeGreaterThan(1)
    fireEvent.dragStart(rows[0])
    fireEvent.dragOver(rows[1])
    fireEvent.drop(rows[1])
    fireEvent.dragEnd(rows[0])
    for (const row of rows) {
      fireEvent.keyDown(row, { key: 'Delete' })
      fireEvent.keyDown(row, { key: 'Backspace' })
    }

    expect(stationState()).toBe(before)
  })

  it('sets an alias on any channel and remembers it by module, slot and channel', () => {
    renderScreen()
    const target = ioEntries()[20]

    commitAlias(target.channelName, target.slot, 'valve_open')

    const stored = ioEntries().find((entry) => entry.slot === target.slot && entry.channelName === target.channelName)
    expect(stored?.alias).toBe('valve_open')
    expect(stored?.iecAddress).toBe(target.iecAddress)
    expect(ioEntries().filter((entry) => entry.alias === 'valve_open')).toHaveLength(1)
    expect(store.getState().iecAliasMemory[`vpp:ur20-16do-p:2:${target.channelName}`]).toBe('valve_open')
  })

  it('rejects a project-wide collision with a toast and writes nothing', () => {
    renderScreen()
    const [first, second] = ioEntries()
    commitAlias(first.channelName, first.slot, 'motor_on')
    const before = stationState()

    commitAlias(second.channelName, second.slot, 'motor_on')

    expect(stationState()).toBe(before)
    expect(getMemoryState().toasts[0]?.title).toBe('Alias already in use')
    expect(aliasInput(second.channelName, second.slot).value).toBe('')
  })

  it('renames every variable bound to the previous alias', () => {
    renderScreen()
    const target = ioEntries()[3]
    commitAlias(target.channelName, target.slot, 'start_btn')
    seedGlobal({
      name: 'start',
      class: 'global',
      type: { definition: 'base-type', value: 'BOOL' },
      location: 'start_btn',
      documentation: '',
    })

    commitAlias(target.channelName, target.slot, 'start_button')

    expect(store.getState().project.data.configurations.resource.globalVariables[0].location).toBe('start_button')
  })

  it('follows a configurator change: kept aliases stay, dropped ones go and are reported', () => {
    renderScreen()
    const kept = ioEntries().find((entry) => entry.slot === 1)
    const dropped = ioEntries().find((entry) => entry.slot === 2)
    if (!kept || !dropped) throw new Error('fixture has no channel in one of its modules')
    commitAlias(kept.channelName, kept.slot, 'kept_alias')
    commitAlias(dropped.channelName, dropped.slot, 'dropped_alias')

    act(() => {
      const applied = applyConfiguratorSnapshot(store, TARGET, {
        archive: 'cd'.repeat(64),
        deviceSetup: { ...UR20_16DI_16DO.deviceSetup, devices: [DI_MODULE] },
      })
      notifyDroppedAliases(applied.dropped)
    })

    expect(screen.queryByRole('region', { name: `Slot 2 ${DO_MODULE.name}` })).toBeNull()
    expect(screen.getAllByLabelText(/^Alias of /)).toHaveLength(16)
    expect(aliasInput(kept.channelName, kept.slot).value).toBe('kept_alias')
    expect(screen.queryByDisplayValue('dropped_alias')).toBeNull()
    expect(getMemoryState().toasts[0]?.description).toMatch(/dropped_alias/)
  })

  it('says how to start when the configurator has reported no modules', () => {
    store = createTestStore()
    renderScreen()

    expect(screen.getByText(/No modules configured\. Add modules in Backplane Configuration/)).toBeTruthy()
  })

  it('writes nothing when it mounts, even with module slots and no mapping stored', () => {
    act(() => store.getState().deviceActions.setVendorScreenData('io-mapping', { entries: [] }))
    const before = stationState()

    renderScreen()

    expect(stationState()).toBe(before)
    expect(screen.queryAllByLabelText(/^Alias of /)).toHaveLength(0)
  })

  it('lists a module whose type is not in the catalogue, with no channels', () => {
    const unknown = { guid: 'g-unknown', name: 'UR20_8AI_1', typeId: 'deadbeef' }
    act(() => {
      applyConfiguratorSnapshot(store, TARGET, {
        archive: 'cd'.repeat(64),
        deviceSetup: { ...UR20_16DI_16DO.deviceSetup, devices: [unknown, DI_MODULE] },
      })
    })
    renderScreen()

    const slot = screen.getByRole('region', { name: 'Slot 1 UR20_8AI_1' })
    expect(within(slot).getByText('Not in catalogue')).toBeTruthy()
    expect(within(slot).getByText(/Module type deadbeef is not in this package's catalogue/)).toBeTruthy()
    expect(within(slot).queryAllByLabelText(/^Alias of /)).toHaveLength(0)
    const known = screen.getByRole('region', { name: `Slot 2 ${DI_MODULE.name}` })
    expect(within(known).queryByText('Not in catalogue')).toBeNull()
    expect(within(known).getAllByLabelText(/^Alias of /)).toHaveLength(16)
  })

  it('takes aliases on channel names with dots and signs', () => {
    act(() => {
      applyConfiguratorSnapshot(store, TARGET, {
        archive: 'ef'.repeat(64),
        deviceSetup: {
          ...UR20_16DI_16DO.deviceSetup,
          devices: [{ guid: 'g-sm', name: 'UR20_1SM_1', typeId: 'cafe0001' }],
        },
      })
    })
    renderScreen()

    commitAlias('SmCJ+', 1, 'cold_junction')
    commitAlias('txtValue_0.3', 1, 'limit_switch')

    expect(ioEntries().map((entry) => [entry.channelName, entry.alias])).toEqual([
      ['SmCJ+', 'cold_junction'],
      ['txtValue_0.3', 'limit_switch'],
    ])
    expect(store.getState().iecAliasMemory['vpp:ur20-1sm-like:1:txtValue_0.3']).toBe('limit_switch')
  })

  it('draws nothing for an io-table source it does not know', () => {
    const { container } = render(
      <SectionRenderer
        section={{ id: 'io-mapping', title: 'I/O Mapping', layout: 'io-table', source: 'datapoints' }}
        moduleSystem={null}
      />,
      { wrapper: createStoreWrapper(store, PORTS) },
    )

    expect(container.querySelector('table')).toBeNull()
    expect(screen.queryAllByLabelText(/^Alias of /)).toHaveLength(0)
  })
})
