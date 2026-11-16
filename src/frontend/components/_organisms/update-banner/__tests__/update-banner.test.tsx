/**
 * The update banner (DOPE-486): what it says in each state, and what its two
 * buttons do.
 */
import { fireEvent, render, screen } from '@testing-library/react'

import type { AppUpdateStatus } from '../../../../../middleware/shared/ports/app-update-port'
import { UpdateBanner } from '..'

type Shown = Exclude<AppUpdateStatus, { state: 'none' }>

function renderBanner(update: Shown) {
  const onUpdate = jest.fn()
  const onDismiss = jest.fn()
  render(<UpdateBanner update={update} onUpdate={onUpdate} onDismiss={onDismiss} />)
  return { onUpdate, onDismiss }
}

describe('UpdateBanner', () => {
  it('says a new version is available and offers Update', () => {
    const { onUpdate } = renderBanner({ state: 'available', version: '4.3.3' })
    expect(screen.getByText('A new version of OpenPLC Editor is available: 4.3.3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('shows the progress while downloading, with nothing to click but the X', () => {
    renderBanner({ state: 'downloading', version: '4.3.3', percent: 42 })
    expect(screen.getByText('Downloading OpenPLC Editor 4.3.3… 42%')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })

  it('once downloaded, offers to open the installer again', () => {
    const { onUpdate } = renderBanner({ state: 'downloaded', version: '4.3.3' })
    expect(screen.getByText('OpenPLC Editor 4.3.3 is downloaded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Installer' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('the X dismisses it', () => {
    const { onDismiss, onUpdate } = renderBanner({ state: 'available', version: '4.3.3' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
