import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { produce } from 'immer'

import { VendorScreenRenderer } from '../index'

/**
 * Hardware-agnostic round-trip for the VendorScreenRenderer. Exercises the
 * generic surface we promoted in RTOP-306:
 *
 *   - a form section and a table section share one vpp-extensions bucket via
 *     `storageId`;
 *   - `persistAs` maps snake_case field ids to the payload keys a downstream
 *     consumer expects;
 *   - `enabledWhen` gates the table section against the form's values;
 *   - the Variables source `variable-picker` draws from the project's
 *     exportable PLC variables.
 *
 * The screen definition and the emitter are declared inline; vendor-specific
 * end-to-end verification lives in the owning package's own tests
 * (`openplc-packages/scripts/lib/datahub-emitter.spec.ts` is where the real
 * `datahub.emit.js` is exercised against the shipped `screens/datahub.json`).
 * The editor must not reach across repo boundaries to test a vendor's assets.
 */

const PACKAGE_ID = 'com.test.vendor'
const BOARD = 'TEST-BOARD'

const INLINE_SCREEN = {
  sections: [
    {
      id: 'settings',
      title: 'Settings',
      layout: 'form',
      persistence: 'vpp-extensions',
      storageId: 'generic-screen',
      collapsible: true,
      collapsed: false,
      fields: [
        { id: 'enabled', label: 'Enable', type: 'boolean', default: false, persistAs: 'enabled' },
        { id: 'endpoint_url', label: 'Endpoint', type: 'text', persistAs: 'endpointUrl' },
        { id: 'auth_secret', label: 'Secret', type: 'password', persistAs: 'authSecret' },
      ],
    },
    {
      id: 'picks',
      title: 'Picks',
      layout: 'table',
      persistence: 'vpp-extensions',
      storageId: 'generic-screen',
      collapsible: true,
      collapsed: true,
      enabledWhen: {
        operator: 'and',
        conditions: [
          { condition: 'enabled', operator: 'equals', value: true },
          { condition: 'endpointUrl', operator: 'exists' },
          { condition: 'authSecret', operator: 'exists' },
        ],
      },
      source: 'variable-picker',
      search: { field: 'qualifier', placeholder: 'Filter...' },
      columns: [
        { id: 'qualifier', label: 'Qualifier', type: 'text', readonly: true },
        { id: 'type', label: 'Type', type: 'text', readonly: true },
        { id: 'access', label: 'Access', type: 'select', options: ['RO', 'RW'] },
      ],
    },
  ],
}

/** Toy emitter: mirrors the contract every runtime emitter must honour. */
function inlineEmitter(input: { data: unknown }): { files: Record<string, string>; errors: string[] } {
  const data = (input.data ?? {}) as {
    enabled?: boolean
    endpointUrl?: string
    authSecret?: string
    exports?: Array<{ qualifier: string; direction: 'RO' | 'RW' }>
  }
  if (data.enabled !== true) {
    return { files: { 'conf/generic.json': JSON.stringify({ enabled: false }, null, 2) }, errors: [] }
  }
  const errors: string[] = []
  if (!data.endpointUrl) errors.push('endpointUrl is required when enabled')
  if (!data.authSecret) errors.push('authSecret is required when enabled')
  const payload = {
    enabled: true,
    endpointUrl: data.endpointUrl ?? '',
    authSecret: data.authSecret ?? '',
    exports: (data.exports ?? []).slice(),
  }
  return { files: { 'conf/generic.json': JSON.stringify(payload, null, 2) }, errors }
}

function seedBoardWithPackage(target: OpenPLCStore) {
  target.setState(
    produce((state) => {
      state.deviceDefinitions.configuration.deviceBoard = BOARD
      state.deviceAvailableOptions.availableBoards.set(BOARD, {
        compiler: 'runtime_v4',
        core: 'openplc',
        preview: 'generic.png',
        specs: {},
        vpp: {
          packageId: PACKAGE_ID,
          vendor: 'Test',
          deviceId: 'test',
          packagePath: '/packages/com.test.vendor',
          screens: {},
          moduleSystem: null,
        },
      })
    }),
  )
}

function seedProgram(target: OpenPLCStore, variables: Array<{ name: string; type: string }>) {
  target.setState(
    produce((state) => {
      state.project.data.pous.push({
        name: 'Program0',
        pouType: 'program',
        interface: {
          variables: variables.map((v, i) => ({
            name: v.name,
            class: 'local',
            type: { definition: 'base-type', value: v.type },
            location: '',
            documentation: '',
            debug: false,
            initialValue: '',
            id: `v${i}`,
          })),
        },
        body: { language: 'st', value: '' },
        documentation: '',
      })
    }),
  )
}

function readPayload(target: OpenPLCStore): Record<string, unknown> | undefined {
  return target.getState().projectActions.getVppExtension(PACKAGE_ID, 'generic-screen') as
    | Record<string, unknown>
    | undefined
}

describe('VendorScreenRenderer — hardware-agnostic round-trip', () => {
  let store: OpenPLCStore

  beforeEach(() => {
    store = createTestStore()
    seedBoardWithPackage(store)
  })

  afterEach(cleanup)

  function expandPicksSection() {
    fireEvent.click(screen.getByText('Picks'))
  }

  it('renders both sections from the inline screen definition', () => {
    seedProgram(store, [{ name: 'v0', type: 'INT' }])
    render(<VendorScreenRenderer screenDefinition={INLINE_SCREEN} moduleSystem={null} />, {
      wrapper: createStoreWrapper(store),
    })

    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Picks')).toBeTruthy()
    expect(screen.getByText('Enable')).toBeTruthy()
    expect(screen.getByText('Endpoint')).toBeTruthy()
    expect(screen.getByText('Secret')).toBeTruthy()
  })

  it('flat-persists form fields through persistAs mapping (snake id → camel key)', () => {
    render(<VendorScreenRenderer screenDefinition={INLINE_SCREEN} moduleSystem={null} />, {
      wrapper: createStoreWrapper(store),
    })

    act(() => {
      fireEvent.click(screen.getByLabelText('Enable'))
      fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://hub' } })
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 's3cret' } })
    })

    expect(readPayload(store)).toEqual({
      enabled: true,
      endpointUrl: 'https://hub',
      authSecret: 's3cret',
    })
  })

  it('both sections write into the shared storageId bucket — nothing lands under section ids', () => {
    seedProgram(store, [{ name: 'v0', type: 'INT' }])
    render(<VendorScreenRenderer screenDefinition={INLINE_SCREEN} moduleSystem={null} />, {
      wrapper: createStoreWrapper(store),
    })
    act(() => {
      fireEvent.click(screen.getByLabelText('Enable'))
      fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://hub' } })
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 's3cret' } })
    })
    act(() => {
      expandPicksSection()
    })
    act(() => {
      fireEvent.click(screen.getByLabelText('Expose Program0.v0'))
    })

    expect(readPayload(store)).toMatchObject({
      enabled: true,
      endpointUrl: 'https://hub',
      authSecret: 's3cret',
      exports: [{ qualifier: 'Program0.v0', direction: 'RO' }],
    })
    const vppExts = store.getState().project.data.vppExtensions ?? {}
    expect(Object.keys(vppExts[PACKAGE_ID] ?? {})).toEqual(['generic-screen'])
  })

  it('table section stays locked until enabledWhen passes', () => {
    seedProgram(store, [{ name: 'v0', type: 'INT' }])
    render(<VendorScreenRenderer screenDefinition={INLINE_SCREEN} moduleSystem={null} />, {
      wrapper: createStoreWrapper(store),
    })
    act(() => {
      expandPicksSection()
    })

    // Toggle off, no fields: click is dropped.
    act(() => {
      fireEvent.click(screen.getByLabelText('Expose Program0.v0'))
    })
    expect(readPayload(store)?.exports).toBeUndefined()

    // Toggle on but endpointUrl / authSecret missing: still locked.
    act(() => {
      fireEvent.click(screen.getByLabelText('Enable'))
    })
    act(() => {
      fireEvent.click(screen.getByLabelText('Expose Program0.v0'))
    })
    expect(readPayload(store)?.exports).toBeUndefined()

    // Fill both: gate opens.
    act(() => {
      fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'u' } })
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 's' } })
    })
    act(() => {
      fireEvent.click(screen.getByLabelText('Expose Program0.v0'))
    })
    expect(readPayload(store)?.exports).toEqual([{ qualifier: 'Program0.v0', direction: 'RO' }])
  })

  it('round-trips the UI payload through a toy emitter — the shape every runtime emitter must handle', () => {
    seedProgram(store, [
      { name: 'speed', type: 'INT' },
      { name: 'temp', type: 'REAL' },
    ])
    render(<VendorScreenRenderer screenDefinition={INLINE_SCREEN} moduleSystem={null} />, {
      wrapper: createStoreWrapper(store),
    })

    act(() => {
      fireEvent.click(screen.getByLabelText('Enable'))
      fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://hub' } })
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 's3cret' } })
    })
    act(() => {
      expandPicksSection()
    })
    act(() => {
      fireEvent.click(screen.getByLabelText('Expose Program0.speed'))
    })
    act(() => {
      fireEvent.click(screen.getByLabelText('Expose Program0.temp'))
    })

    const result = inlineEmitter({ data: readPayload(store) })
    expect(result.errors).toEqual([])
    expect(JSON.parse(result.files['conf/generic.json'])).toEqual({
      enabled: true,
      endpointUrl: 'https://hub',
      authSecret: 's3cret',
      exports: [
        { qualifier: 'Program0.speed', direction: 'RO' },
        { qualifier: 'Program0.temp', direction: 'RO' },
      ],
    })
  })

  it('emits a disable payload when the toggle is off, even with stale fields in the bucket', () => {
    render(<VendorScreenRenderer screenDefinition={INLINE_SCREEN} moduleSystem={null} />, {
      wrapper: createStoreWrapper(store),
    })
    act(() => {
      store.getState().projectActions.setVppExtension(PACKAGE_ID, 'generic-screen', {
        enabled: false,
        endpointUrl: 'leftover',
        authSecret: 'leftover',
        exports: [{ qualifier: 'Program0.v0', direction: 'RO' }],
      })
    })

    const result = inlineEmitter({ data: readPayload(store) })
    expect(result.errors).toEqual([])
    expect(result.files['conf/generic.json']).toBe('{\n  "enabled": false\n}')
  })
})
