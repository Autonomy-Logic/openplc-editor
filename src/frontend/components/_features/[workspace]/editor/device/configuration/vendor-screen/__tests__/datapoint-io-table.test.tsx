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

import { UR20_16DI_16DO } from '@root/__fixtures__/device-editor-datapoints/ur20-16di-16do'
import WEIDMULLER_SCREEN from '@root/__fixtures__/weidmuller-screens/io-configuration.json'
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
    moduleSystem: null,
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
  return render(<VendorScreenRenderer screenDefinition={WEIDMULLER_SCREEN} moduleSystem={null} />, {
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

describe('datapoint-io-table section', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD, VPP_BOARD]]) })
    store.getState().deviceActions.setDeviceBoard(BOARD)
    applyConfiguratorSnapshot(store, TARGET, { archive: 'ab'.repeat(64), ...UR20_16DI_16DO })
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
          layout: 'datapoint-io-table',
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

  it('sets an alias on any channel and remembers it by datapoint id', () => {
    renderScreen()
    const target = ioEntries()[20]

    commitAlias(target.channelName, target.slot, 'valve_open')

    const stored = ioEntries().find((entry) => entry.datapointId === target.datapointId)
    expect(stored?.alias).toBe('valve_open')
    expect(stored?.iecAddress).toBe(target.iecAddress)
    expect(ioEntries().filter((entry) => entry.alias === 'valve_open')).toHaveLength(1)
    expect(store.getState().iecAliasMemory[`vpp-datapoint:${target.datapointId}`]).toBe('valve_open')
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
    const kept = ioEntries().find((entry) => entry.datapointId?.startsWith(DI_MODULE.guid))
    const dropped = ioEntries().find((entry) => entry.datapointId?.startsWith(DO_MODULE.guid))
    if (!kept || !dropped) throw new Error('fixture has no channel in one of its modules')
    commitAlias(kept.channelName, kept.slot, 'kept_alias')
    commitAlias(dropped.channelName, dropped.slot, 'dropped_alias')

    act(() => {
      const applied = applyConfiguratorSnapshot(store, TARGET, {
        archive: 'cd'.repeat(64),
        deviceSetup: { ...UR20_16DI_16DO.deviceSetup, devices: [DI_MODULE] },
        dataPoints: UR20_16DI_16DO.dataPoints.filter((point) => point.id.startsWith(DI_MODULE.guid)),
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

    expect(screen.getByText(/No modules configured\. Add modules in the I\/O Configurator/)).toBeTruthy()
  })
})
