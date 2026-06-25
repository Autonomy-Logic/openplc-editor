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

describe('InterfaceSelector', () => {
  it('lists every scanned interface when the dropdown opens', () => {
    renderSelector()
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('eth0')).toBeTruthy()
    expect(screen.getByText('eth1')).toBeTruthy()
    expect(screen.getByText('wlan0')).toBeTruthy()
  })

  it('does NOT filter the adapter list as the user types', () => {
    renderSelector()
    fireEvent.click(screen.getByRole('button'))

    // Type text that, under the old behavior, would have hidden eth0/eth1.
    fireEvent.change(screen.getByPlaceholderText('eth0'), { target: { value: 'wlan' } })

    // All adapters remain visible — the scan list is never narrowed.
    expect(screen.getByText('eth0')).toBeTruthy()
    expect(screen.getByText('eth1')).toBeTruthy()
    expect(screen.getByText('wlan0')).toBeTruthy()
  })

  it('still allows entering a custom interface name not in the scan', () => {
    const onSelectInterface = vi.fn()
    renderSelector({ onSelectInterface })
    fireEvent.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('eth0')
    fireEvent.change(input, { target: { value: 'enp3s0' } })

    // The "Use ..." affordance for a custom value is present...
    expect(screen.getByText('Use "enp3s0"')).toBeTruthy()
    // ...and Enter commits the custom value.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectInterface).toHaveBeenCalledWith('enp3s0')
  })
})
