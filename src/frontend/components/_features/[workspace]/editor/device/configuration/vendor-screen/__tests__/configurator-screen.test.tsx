import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import type { ScreenSection } from '../index'
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
  compiler: 'runtime_v4',
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

const SECTION: ScreenSection = {
  id: 'configurator',
  title: 'I/O Configurator',
  layout: 'vendor-document',
  document: 'configurator/index.html',
  bundleVersion: '3.5.22',
  controllers: { [BOARD]: 'UC20-M3000', 'UC20-M4000': 'UC20-M4000', 'UC20-WL2000': 'UC20-WL2000' },
}

let store: OpenPLCStore

function portsWith(url: string | null): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort<DevicePort>({ getVendorDocumentUrl: () => url }),
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
}

function renderSection(
  section: ScreenSection,
  url: string | null = 'vpp-doc://com.weidmuller.ucontrol/configurator/index.html',
) {
  return render(<SectionRenderer section={section} moduleSystem={null} />, {
    wrapper: createStoreWrapper(store, portsWith(url)),
  })
}

describe('vendor-document section', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD, VPP_BOARD]]) })
    store.getState().deviceActions.setDeviceBoard(BOARD)
  })

  afterEach(cleanup)

  it('embeds the package document in a sandbox without same-origin', () => {
    renderSection(SECTION)

    const iframe = screen.getByTitle('I/O Configurator')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    expect(iframe.getAttribute('src')).toBe('vpp-doc://com.weidmuller.ucontrol/configurator/index.html')
  })

  it('refuses a board the section does not map, naming the boards it supports', () => {
    renderSection({ ...SECTION, controllers: { 'UC20-M4000': 'UC20-M4000', 'UC20-WL2000': 'UC20-WL2000' } })

    expect(screen.queryByTitle('I/O Configurator')).toBeNull()
    expect(screen.getByText(/works only with these devices: UC20-M4000, UC20-WL2000/)).toBeTruthy()
  })

  it('says so when the host cannot serve package documents', () => {
    renderSection(SECTION, null)

    expect(screen.queryByTitle('I/O Configurator')).toBeNull()
    expect(screen.getByText('The I/O Configurator is not available in this host yet.')).toBeTruthy()
  })

  it('boots a fresh guest when the stored archive is replaced from outside it, as "Don\'t save" does', () => {
    renderSection(SECTION)
    const first = screen.getByTitle('I/O Configurator')

    act(() => store.getState().deviceActions.setVendorScreenData('io-mapping', { entries: [] }))
    expect(screen.getByTitle('I/O Configurator')).toBe(first)

    act(() =>
      store.getState().deviceActions.restoreVendorScreenSlice(['configurator'], {
        configurator: { archive: 'saved', controller: BOARD, bundleVersion: '3.5.22' },
      }),
    )
    expect(screen.getByTitle('I/O Configurator')).not.toBe(first)
  })

  it.each([
    ['document', { document: undefined }],
    ['bundleVersion', { bundleVersion: '' }],
    ['controllers', { controllers: ['UC20-M3000'] }],
  ])('renders nothing when %s is missing or malformed', (_field, override) => {
    renderSection({ ...SECTION, ...override })

    expect(screen.queryByTitle('I/O Configurator')).toBeNull()
    expect(screen.queryByText(/I\/O Configurator/)).toBeNull()
  })
})
