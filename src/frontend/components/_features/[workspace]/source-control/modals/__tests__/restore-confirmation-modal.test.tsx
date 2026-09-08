/**
 * The confirmation for an operation that rewrites the working tree and cannot be
 * undone. What is worth protecting is what it says when the restore does NOT happen:
 * this modal stays open on a failure, so with nothing written in it the reader is
 * looking at the same confirmation they already pressed and cannot tell whether their
 * project was rewritten.
 */

import { render, screen } from '@testing-library/react'

import { RestoreConfirmationModal } from '../restore-confirmation-modal'

/** `@testing-library/jest-dom` is not wired into this project, so read the property. */
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })

const PROPS = {
  isOpen: true,
  isLoading: false,
  commitHash: '4ec31d5abc',
  commitMessage: 'probe comment in State_to_num',
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
}

describe('RestoreConfirmationModal', () => {
  it('says why the restore failed, in the dialog that is still open', () => {
    render(<RestoreConfirmationModal {...PROPS} error='Autonomy Edge answered 409.' />)

    // `getByText` throws when it is not there, which is the assertion.
    screen.getByText('Autonomy Edge answered 409.')
    // Still a confirmation, not an error screen: the reader can retry or back out.
    expect(button('Restore').disabled).toBe(false)
  })

  it('shows nothing extra when there is no failure to report', () => {
    render(<RestoreConfirmationModal {...PROPS} />)

    expect(screen.queryByText(/answered/)).toBeNull()
    screen.getByText(/Restore to This Version/)
  })

  it('names the commit it is about to restore, short hash and message', () => {
    render(<RestoreConfirmationModal {...PROPS} />)

    screen.getByText('4ec31d5')
    screen.getByText(/probe comment in State_to_num/)
  })

  it('locks both ways out while the restore is running', () => {
    render(<RestoreConfirmationModal {...PROPS} isLoading />)

    expect(button('Cancel').disabled).toBe(true)
    expect(button('Restoring...').disabled).toBe(true)
  })

  it('renders nothing when closed', () => {
    const { container } = render(<RestoreConfirmationModal {...PROPS} isOpen={false} />)

    expect(container.firstChild).toBeNull()
  })
})
