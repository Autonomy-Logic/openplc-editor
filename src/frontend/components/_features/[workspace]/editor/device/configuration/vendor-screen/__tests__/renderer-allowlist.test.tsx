import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import type { ScreenSection } from '../index'
import { SectionRenderer } from '../section-renderer'

let store: OpenPLCStore

function renderSection(section: Partial<ScreenSection>) {
  return render(
    <SectionRenderer
      section={{ id: 'sec', title: 'Section', layout: 'form', ...section } as ScreenSection}
      moduleSystem={null}
    />,
    { wrapper: createStoreWrapper(store) },
  )
}

function vendorScreenData(): Record<string, unknown> {
  return store.getState().deviceDefinitions.configuration.vendorScreenData ?? {}
}

describe('vendor screen renderer allowlists', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().deviceActions.setVendorScreenData('sec', {})
  })

  afterEach(cleanup)

  it.each(['io-grid', 'terminal', '', 'FORM'])('renders nothing for the unknown layout %j', (layout) => {
    const { container } = renderSection({ layout, title: 'Should not appear' })

    expect(container.textContent).toBe('')
    expect(screen.queryByText(/not yet supported/i)).toBeNull()
  })

  it('renders a known layout', () => {
    renderSection({ layout: 'form', fields: [{ id: 'baud', label: 'Baud rate', type: 'number' }] })

    expect(screen.getByText('Baud rate')).toBeTruthy()
  })

  it('renders the uart-pin-map field type', () => {
    store.getState().deviceActions.setAvailableOptions({
      availableBoards: new Map([
        [
          'Mega',
          { compiler: 'arduino-cli', core: 'arduino:avr', preview: '', specs: {}, serialPorts: ['Serial', 'Serial1'] },
        ],
      ]),
    })
    store.getState().deviceActions.setDeviceBoard('Mega')
    store.getState().deviceActions.setVendorScreenData('sec', {})

    renderSection({
      layout: 'form',
      fields: [{ id: 'rs485_en_pins', label: 'RS-485 EN Pin', type: 'uart-pin-map', optionsRef: 'board.serialPorts' }],
    })

    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })

  it.each(['file', 'script', 'color', 'textarea', ''])('renders nothing for the unknown field type %j', (type) => {
    renderSection({
      layout: 'form',
      fields: [{ id: 'hostile', label: 'Should not appear', type }],
    })

    expect(screen.queryByText('Should not appear')).toBeNull()
  })

  it('does not persist a value for a field it refused to render', () => {
    renderSection({
      layout: 'form',
      fields: [
        { id: 'hostile', label: 'Hostile', type: 'script', default: 'rm -rf /' },
        { id: 'baud', label: 'Baud rate', type: 'number', default: 9600 },
      ],
    })

    fireEvent.change(screen.getByDisplayValue('9600'), { target: { value: '115200' } })

    const stored = vendorScreenData().sec as Record<string, unknown>
    expect(stored).toMatchObject({ baud: 115200 })
    expect(Object.keys(stored)).not.toContain('hostile')
  })

  it('ignores a field with no usable id', () => {
    renderSection({
      layout: 'form',
      fields: [
        { label: 'No id', type: 'text' },
        { id: 'ok', label: 'Fine', type: 'text' },
      ],
    })

    expect(screen.queryByText('No id')).toBeNull()
    expect(screen.getByText('Fine')).toBeTruthy()
  })
})
