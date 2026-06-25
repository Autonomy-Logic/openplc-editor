import { fireEvent, render, screen } from '@testing-library/react'

import type { NetworkInterface } from '@root/middleware/shared/ports/ethercat-types'

import { InterfaceSelector } from '../interface-selector'

const interfaces: NetworkInterface[] = [
  { name: 'eth0', description: 'Ethernet adapter' },
  { name: 'eth1', description: 'Second Ethernet' },
  { name: 'wlan0', description: 'Wireless adapter' },
]

const renderSelector = (overrides?: Partial<React.ComponentProps<typeof InterfaceSelector>>) =>
  render(
    <InterfaceSelector
      interfaces={interfaces}
      selectedInterface=''
      onSelectInterface={() => {}}
      isLoading={false}
      error={null}
      {...overrides}
    />,
  )

// Radix DropdownMenu's trigger opens on Enter — drive it with a keydown so the
// test stays dependency-free and deterministic across both repos' runners
// (jsdom's PointerEvent support varies between Jest and Vitest).
const openDropdown = () => {
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
}

// Each adapter renders as `name — description` (the GenericComboboxCell option label).
const adapterOption = (name: string) => screen.getByText(new RegExp(`^${name} —`))

describe('InterfaceSelector', () => {
  it('lists every scanned interface when the dropdown opens', () => {
    renderSelector()
    openDropdown()

    expect(adapterOption('eth0')).toBeTruthy()
    expect(adapterOption('eth1')).toBeTruthy()
    expect(adapterOption('wlan0')).toBeTruthy()
  })

  it('does NOT filter the adapter list as the user types (disableFilter)', () => {
    renderSelector()
    openDropdown()

    // Type text that, under a filtering combobox, would have hidden eth0/eth1.
    fireEvent.change(screen.getByPlaceholderText('eth0'), { target: { value: 'wlan' } })

    // All adapters remain visible — the scan list is never narrowed.
    expect(adapterOption('eth0')).toBeTruthy()
    expect(adapterOption('eth1')).toBeTruthy()
    expect(adapterOption('wlan0')).toBeTruthy()
  })

  it('still allows entering a custom interface name not in the scan', () => {
    const onSelectInterface = vi.fn()
    renderSelector({ onSelectInterface })
    openDropdown()

    const input = screen.getByPlaceholderText('eth0')
    fireEvent.change(input, { target: { value: 'enp3s0' } })

    // The custom-value affordance is present...
    expect(screen.getByText('Use custom interface')).toBeTruthy()
    // ...and Enter commits the typed value verbatim through onSelectInterface.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectInterface).toHaveBeenCalledWith('enp3s0')
  })

  it('shows a loading message and no adapters while a scan is in flight', () => {
    renderSelector({ isLoading: true })
    openDropdown()

    expect(screen.getByText('Loading interfaces...')).toBeTruthy()
    expect(screen.queryByText(/^eth0 —/)).toBeNull()
  })
})
