import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { RuntimeUserModal, type RuntimeUserModalSubmit } from '../runtime-user-modal'

// Plain typed closures (instead of vi.fn generics) so the same test file is
// type-correct under both the editor's jest and the web's vitest runner.
let submitCalls: RuntimeUserModalSubmit[]
let submitReturn: string | null
let openChanges: boolean[]

const onSubmit = (values: RuntimeUserModalSubmit): Promise<string | null> => {
  submitCalls.push(values)
  return Promise.resolve(submitReturn)
}
const onOpenChange = (open: boolean) => {
  openChanges.push(open)
}

beforeEach(() => {
  submitCalls = []
  submitReturn = null
  openChanges = []
})

describe('RuntimeUserModal — password dirty tracking', () => {
  it('does NOT report a password change when the password field is untouched (edit mode)', async () => {
    render(
      <RuntimeUserModal
        open
        onOpenChange={onOpenChange}
        mode='edit'
        title='Edit user'
        submitLabel='Save'
        initialUsername='bob'
        onSubmit={onSubmit}
      />,
    )

    // Change only the username; leave the pre-filled password placeholder alone.
    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'bobby' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(submitCalls).toHaveLength(1))
    expect(submitCalls[0].usernameChanged).toBe(true)
    expect(submitCalls[0].passwordChanged).toBe(false)
    expect(submitCalls[0].password).toBeUndefined()
  })

  it('reports a password change once the field is edited (edit mode)', async () => {
    render(
      <RuntimeUserModal
        open
        onOpenChange={onOpenChange}
        mode='edit'
        title='Edit user'
        submitLabel='Save'
        initialUsername='bob'
        onSubmit={onSubmit}
      />,
    )

    const pass = screen.getByPlaceholderText('Enter password')
    const confirm = screen.getByPlaceholderText('Confirm password')
    // Focus clears the masked placeholder from both fields, then type a new one.
    fireEvent.focus(pass)
    fireEvent.change(pass, { target: { value: 'new-secret' } })
    fireEvent.change(confirm, { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(submitCalls).toHaveLength(1))
    expect(submitCalls[0].passwordChanged).toBe(true)
    expect(submitCalls[0].password).toBe('new-secret')
  })

  it('blocks submit when nothing changed (edit mode)', async () => {
    render(
      <RuntimeUserModal
        open
        onOpenChange={onOpenChange}
        mode='edit'
        title='Edit user'
        submitLabel='Save'
        initialUsername='bob'
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('No changes to save')
    expect(submitCalls).toHaveLength(0)
  })

  it('requires the current password to change your own password (self edit)', async () => {
    render(
      <RuntimeUserModal
        open
        onOpenChange={onOpenChange}
        mode='edit'
        title='Edit your account'
        submitLabel='Save'
        initialUsername='me'
        requireCurrentPassword
        onSubmit={onSubmit}
      />,
    )

    const pass = screen.getByPlaceholderText('Enter password')
    fireEvent.focus(pass)
    fireEvent.change(pass, { target: { value: 'new-secret' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByText('Save'))

    await screen.findByText('Your current password is required to change the password')
    expect(submitCalls).toHaveLength(0)
  })

  it('rejects mismatched passwords', async () => {
    render(
      <RuntimeUserModal
        open
        onOpenChange={onOpenChange}
        mode='create'
        title='New user'
        submitLabel='Create'
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'bob' } })
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'aaa' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'bbb' } })
    fireEvent.click(screen.getByText('Create'))

    await screen.findByText('Passwords do not match')
    expect(submitCalls).toHaveLength(0)
  })

  it('creates a user with the required fields and closes on success (create mode)', async () => {
    render(
      <RuntimeUserModal
        open
        onOpenChange={onOpenChange}
        mode='create'
        title='New user'
        submitLabel='Create'
        showRole
        initialRole='user'
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'bob' } })
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('Create'))

    await waitFor(() => expect(submitCalls).toHaveLength(1))
    expect(submitCalls[0]).toMatchObject({ username: 'bob', password: 'secret', role: 'user', passwordChanged: true })
    await waitFor(() => expect(openChanges).toContain(false))
  })
})
