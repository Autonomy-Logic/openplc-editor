import { describe, expect, it } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'

import type { EditSessionSummary } from '../../../../../middleware/shared/ports/edit-session-port'
import { ClosedElsewhereDialog, ConflictDialog, StaleCopyDialog } from '..'

const desktop: EditSessionSummary = {
  id: 'desktop-session',
  clientKind: 'desktop',
  clientLabel: 'OpenPLC Editor on Windows',
  openedAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
}

function renderConflict(overrides: Partial<Parameters<typeof ConflictDialog>[0]> = {}) {
  const onCloseOther = jest.fn()
  const onCloseThis = jest.fn()
  const onCancelCloseThis = jest.fn()
  render(
    <ConflictDialog
      projectName='Bottling line'
      current={{ label: 'Chrome on macOS', kind: 'web' }}
      currentSessionId='mine'
      otherSessions={[desktop]}
      busySessionId={null}
      failed={false}
      onCloseOther={onCloseOther}
      onCloseThis={onCloseThis}
      onCancelCloseThis={onCancelCloseThis}
      {...overrides}
    />,
  )
  return { onCloseOther, onCloseThis }
}

describe('ConflictDialog', () => {
  it('explains the problem and that saving is paused', () => {
    renderConflict()

    expect(screen.getByText('This project is open in more than one place')).toBeTruthy()
    expect(screen.getByText(/is open in 2 places with your account/)).toBeTruthy()
    expect(screen.getByText('saving is paused')).toBeTruthy()
  })

  it('lists this window and every other session', () => {
    renderConflict()

    expect(screen.getByText('Chrome on macOS')).toBeTruthy()
    expect(screen.getByText(/This window/)).toBeTruthy()
    expect(screen.getByText('OpenPLC Editor on Windows')).toBeTruthy()
    expect(screen.getByText(/Desktop editor/)).toBeTruthy()
  })

  it('closes the session the user picks', () => {
    const { onCloseOther, onCloseThis } = renderConflict()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onCloseOther).toHaveBeenCalledWith('desktop-session')

    fireEvent.click(screen.getByRole('button', { name: 'Close this one' }))
    expect(onCloseThis).toHaveBeenCalled()
  })

  it('disables every action while one close is in flight', () => {
    renderConflict({ busySessionId: 'desktop-session' })

    expect(screen.getByRole('button', { name: 'Closing…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Close this one' }).hasAttribute('disabled')).toBe(true)
  })

  it('says when a close did not reach the server', () => {
    renderConflict({ failed: true })

    expect(screen.getByRole('alert').textContent).toMatch(/could not be closed/)
  })

  it('asks before discarding unsaved changes in this window', () => {
    const onCloseThis = jest.fn()
    const onCancelCloseThis = jest.fn()
    renderConflict({ confirmingCloseThis: true, onCloseThis, onCancelCloseThis })

    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Keep this window' }))
    expect(onCancelCloseThis).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close and discard changes' }))
    expect(onCloseThis).toHaveBeenCalled()
  })

  it('cannot be dismissed with Escape', () => {
    renderConflict()

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.getByText('This project is open in more than one place')).toBeTruthy()
  })
})

describe('StaleCopyDialog', () => {
  it('explains that this copy is out of date and reloads it on request', () => {
    const onReload = jest.fn()
    render(<StaleCopyDialog projectName='Bottling line' reloading={false} failed={false} onReload={onReload} />)

    expect(screen.getByText('This project changed in another place')).toBeTruthy()
    expect(screen.getByText(/saving it is blocked/)).toBeTruthy()
    expect(screen.getByText(/not saved will be lost/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reload project' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('disables the reload while it runs, and says when it failed', () => {
    const onReload = jest.fn()
    const { rerender } = render(
      <StaleCopyDialog projectName='Bottling line' reloading failed={false} onReload={onReload} />,
    )
    expect(screen.getByRole('button', { name: 'Reloading…' }).hasAttribute('disabled')).toBe(true)

    rerender(<StaleCopyDialog projectName='Bottling line' reloading={false} failed onReload={onReload} />)
    expect(screen.getByRole('alert').textContent).toMatch(/could not be reloaded/)
  })

  it('cannot be dismissed with Escape', () => {
    render(<StaleCopyDialog projectName='Bottling line' reloading={false} failed={false} onReload={jest.fn()} />)

    fireEvent.keyDown(screen.getByTestId('project-edit-session-stale'), { key: 'Escape' })

    expect(screen.getByTestId('project-edit-session-stale')).toBeTruthy()
  })
})

describe('ClosedElsewhereDialog', () => {
  it('explains why this copy was closed and leaves the project on request', () => {
    const onLeave = jest.fn()
    render(<ClosedElsewhereDialog projectName='Bottling line' onLeave={onLeave} />)

    expect(screen.getByText('This project was closed here')).toBeTruthy()
    expect(screen.getByText(/were not kept/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Leave project' }))
    expect(onLeave).toHaveBeenCalled()
  })
})
