import { COMMERCIAL_LICENSE_DISCLAIMER } from '@root/middleware/shared/utils/licensing'
import { fireEvent, render, screen } from '@testing-library/react'

import { RuntimeCommercialLicenseStatus } from '../runtime-commercial-license-status'

const ID = `hw2:${'ab'.repeat(32)}`
const URL = `https://edge.example.com/buy?hardwareId=${encodeURIComponent(ID)}`

describe('RuntimeCommercialLicenseStatus', () => {
  it('shows GPLv3 with the disclaimer, the hardware ID and the purchase link', () => {
    const onBuy = jest.fn()
    render(
      <RuntimeCommercialLicenseStatus
        status='unlicensed'
        hardwareId={ID}
        buyUrl={URL}
        awaitingPurchase={false}
        onBuy={onBuy}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Runtime license status' }))
    expect(screen.getByText('GPLv3')).toBeTruthy()
    expect(screen.getByText(COMMERCIAL_LICENSE_DISCLAIMER)).toBeTruthy()
    expect(screen.getByText(ID)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Buy licences' }))
    expect(onBuy).toHaveBeenCalledTimes(1)
  })

  it('shows a commercial licence without a purchase link', () => {
    render(
      <RuntimeCommercialLicenseStatus
        status='licensed'
        hardwareId={ID}
        buyUrl={URL}
        awaitingPurchase={false}
        onBuy={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Runtime license status' }))
    expect(screen.getAllByText('Commercial license').length).toBeGreaterThan(0)
    expect(screen.queryByText(COMMERCIAL_LICENSE_DISCLAIMER)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Buy licences' })).toBeNull()
  })

  it('withholds the purchase link while a purchase is awaited', () => {
    render(
      <RuntimeCommercialLicenseStatus
        status='unlicensed'
        hardwareId={ID}
        buyUrl={URL}
        awaitingPurchase
        onBuy={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Runtime license status' }))
    expect(screen.getByText('Waiting for purchase…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Buy licences' })).toBeNull()
  })

  it('renders nothing when the status is unknown or a paid VPP speaks', () => {
    for (const status of ['unknown', 'vpp-flow', null] as const) {
      const { container, unmount } = render(
        <RuntimeCommercialLicenseStatus
          status={status}
          hardwareId={ID}
          buyUrl={URL}
          awaitingPurchase={false}
          onBuy={jest.fn()}
        />,
      )
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })
})
