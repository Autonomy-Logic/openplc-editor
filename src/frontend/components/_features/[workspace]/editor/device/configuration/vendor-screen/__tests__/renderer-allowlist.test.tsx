import { openPLCStoreBase } from '@root/frontend/store'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import type { ScreenSection } from '../index'
import { SectionRenderer } from '../section-renderer'

/**
 * A vendor package is untrusted input, so the renderer dispatches through
 * allowlists rather than falling back. Two properties matter and are pinned
 * here: an unrecognised layout or field type draws NOTHING — not a placeholder,
 * not a text input — and, because it is never drawn, it can never put a value
 * into `vendorScreenData` and from there into the plugin config the device is
 * configured with.
 */

function renderSection(section: Partial<ScreenSection>) {
  return render(
    <SectionRenderer
      section={{ id: 'sec', title: 'Section', layout: 'form', ...section } as ScreenSection}
      moduleSystem={null}
    />,
  )
}

function vendorScreenData(): Record<string, unknown> {
  return openPLCStoreBase.getState().deviceDefinitions.configuration.vendorScreenData ?? {}
}

describe('vendor screen renderer allowlists', () => {
  beforeEach(() => {
    openPLCStoreBase.getState().deviceActions.setVendorScreenData('sec', {})
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

  it.each(['file', 'script', 'color', 'textarea', ''])(
    'renders nothing for the unknown field type %j',
    (type) => {
      renderSection({
        layout: 'form',
        fields: [{ id: 'hostile', label: 'Should not appear', type }],
      })

      expect(screen.queryByText('Should not appear')).toBeNull()
    },
  )

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
    // The refused field never entered the value map, so it cannot ride into
    // the generated plugin config alongside the ones that did.
    expect(Object.keys(stored)).not.toContain('hostile')
  })

  it('ignores a field with no usable id', () => {
    renderSection({
      layout: 'form',
      fields: [{ label: 'No id', type: 'text' }, { id: 'ok', label: 'Fine', type: 'text' }],
    })

    expect(screen.queryByText('No id')).toBeNull()
    expect(screen.getByText('Fine')).toBeTruthy()
  })
})
