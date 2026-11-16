import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from '@jest/globals'

import { SlotDetailPane } from '../components/slot-detail'

function TallContent({ label }: { label: string }) {
  return <div style={{ height: 2000 }}>{label}</div>
}

describe('SlotDetailPane', () => {
  afterEach(cleanup)

  it('scrolls back to the top when the slot it shows changes', () => {
    const { rerender } = render(
      <SlotDetailPane scrollResetKey={0}>
        <TallContent label='slot 1' />
      </SlotDetailPane>,
    )
    const pane = screen.getByText('slot 1').parentElement as HTMLDivElement
    pane.scrollTop = 687
    expect(pane.scrollTop).toBe(687)

    rerender(
      <SlotDetailPane scrollResetKey={1}>
        <TallContent label='slot 2' />
      </SlotDetailPane>,
    )

    expect(pane.scrollTop).toBe(0)
  })

  it('keeps the scroll position while the same slot stays selected', () => {
    const { rerender } = render(
      <SlotDetailPane scrollResetKey={3}>
        <TallContent label='slot 4' />
      </SlotDetailPane>,
    )
    const pane = screen.getByText('slot 4').parentElement as HTMLDivElement
    pane.scrollTop = 120

    rerender(
      <SlotDetailPane scrollResetKey={3}>
        <TallContent label='slot 4 again' />
      </SlotDetailPane>,
    )

    expect(pane.scrollTop).toBe(120)
  })
})
