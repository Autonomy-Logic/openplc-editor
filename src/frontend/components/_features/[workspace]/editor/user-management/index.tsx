import { PencilIcon } from '@root/frontend/assets/icons/interface/Pencil'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { RefreshIcon } from '@root/frontend/assets/icons/interface/Refresh'
import { TrashCanIcon } from '@root/frontend/assets/icons/interface/TrashCan'
import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { Modal, ModalContent, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { RuntimeUserModal, type RuntimeUserModalSubmit } from '@root/frontend/components/_organisms/modals/runtime-user-modal'
import { useOpenPLCStore } from '@root/frontend/store'
import type { RuntimeUser, UpdateUserParams } from '@root/middleware/shared/ports/runtime-port'
import { useRuntime } from '@root/middleware/shared/providers'
import { useCallback, useEffect, useState } from 'react'

type EditTarget = { user: RuntimeUser; isSelf: boolean }

const UserManagementEditor = () => {
  const runtime = useRuntime()
  const connectionStatus = useOpenPLCStore((s) => s.runtimeConnection.connectionStatus)
  const setRuntimeConnectionStatus = useOpenPLCStore((s) => s.deviceActions.setRuntimeConnectionStatus)
  const setRuntimeJwtToken = useOpenPLCStore((s) => s.deviceActions.setRuntimeJwtToken)

  const [users, setUsers] = useState<RuntimeUser[]>([])
  const [currentUser, setCurrentUser] = useState<RuntimeUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RuntimeUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isAdmin = currentUser?.role === 'admin'

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const [listResult, meResult] = await Promise.all([runtime.listUsers(), runtime.whoAmI()])
    if (!listResult.success) {
      setLoadError(listResult.error || 'Failed to load users')
      setUsers([])
    } else {
      // Guard against a non-array payload (e.g. the runtime's existence-only
      // {"msg":"Users found"} reply when the token is no longer valid), which
      // would otherwise crash the table on `users.map`.
      setUsers(Array.isArray(listResult.users) ? listResult.users : [])
    }
    if (meResult.success && meResult.user) {
      setCurrentUser(meResult.user)
    }
    setLoading(false)
  }, [runtime])

  useEffect(() => {
    // Reload whenever the screen mounts or the connection is (re)established.
    if (connectionStatus === 'connected') {
      void refresh()
    }
  }, [connectionStatus, refresh])

  const handleCreate = async ({ username, password, role }: RuntimeUserModalSubmit): Promise<string | null> => {
    if (!password) return 'Password is required'
    const result = await runtime.createUser({ username, password, role })
    if (!result.success) return result.error || 'Failed to create user'
    toast({ title: 'User created', description: `"${username}" was created.`, variant: 'default' })
    void refresh()
    return null
  }

  const handleEdit = async (values: RuntimeUserModalSubmit): Promise<string | null> => {
    if (!editTarget) return 'No user selected'
    const params: UpdateUserParams = {}
    if (values.usernameChanged) params.username = values.username
    if (values.passwordChanged) {
      params.password = values.password
      if (values.currentPassword) params.currentPassword = values.currentPassword
    }
    if (values.roleChanged) params.role = values.role
    const changingOwnPassword = editTarget.isSelf && values.passwordChanged
    const result = await runtime.updateUser(editTarget.user.id, params)
    if (!result.success) return result.error || 'Failed to update user'

    if (changingOwnPassword) {
      // The runtime invalidates your token when you change your own password,
      // so drop the local session and force a fresh login with the new one.
      await runtime.clearCredentials()
      setRuntimeJwtToken(null)
      setRuntimeConnectionStatus('disconnected')
      toast({
        title: 'Password changed',
        description: 'You have been signed out. Reconnect with your new password.',
        variant: 'default',
      })
      return null
    }

    toast({ title: 'User updated', description: `"${values.username}" was updated.`, variant: 'default' })
    void refresh()
    return null
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await runtime.deleteUser(deleteTarget.id)
    setDeleting(false)
    if (!result.success) {
      toast({ title: 'Delete failed', description: result.error || 'Failed to delete user', variant: 'fail' })
      return
    }
    toast({ title: 'User deleted', description: `"${deleteTarget.username}" was deleted.`, variant: 'default' })
    setDeleteTarget(null)
    void refresh()
  }

  const canEditRow = (user: RuntimeUser) => isAdmin || user.id === currentUser?.id
  const canDeleteRow = (user: RuntimeUser) => isAdmin && user.id !== currentUser?.id

  // When not connected (e.g. after changing your own password signs you out),
  // show a neutral placeholder instead of the table + actions — those would
  // hit the runtime unauthenticated and, worse, could render a non-array list.
  if (connectionStatus !== 'connected') {
    return (
      <div className='flex h-full w-full select-none flex-col items-center justify-center gap-2 p-8 text-center'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-white'>User Management</h2>
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>
          You are not connected to a runtime. Connect to the runtime to manage its users.
        </p>
      </div>
    )
  }

  return (
    <div className='flex h-full w-full select-none flex-col overflow-auto p-8'>
      <div className='mb-6 flex items-start justify-between'>
        <div>
          <h2 className='text-xl font-semibold text-neutral-1000 dark:text-white'>User Management</h2>
          <p className='mt-1 text-sm text-neutral-600 dark:text-neutral-400'>
            Manage the accounts that can log in to this runtime.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={() => void refresh()}
            title='Refresh'
            className='flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-850'
          >
            <RefreshIcon className='h-4 w-4' />
          </button>
          {isAdmin && (
            <button
              type='button'
              onClick={() => setCreateOpen(true)}
              className='flex h-9 items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              {/* PlusIcon strokes `inherit`; without a stroke color it renders
                  invisibly and its empty box pushed the label off-center. */}
              <PlusIcon className='h-4 w-4 stroke-current' />
              <span className='leading-none'>New User</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className='text-sm text-neutral-500'>Loading users…</p>
      ) : loadError ? (
        <p className='text-sm text-red-600 dark:text-red-400'>{loadError}</p>
      ) : (
        <div className='overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800'>
          <table className='w-full border-collapse text-sm'>
            <thead>
              <tr className='border-b border-neutral-200 bg-neutral-50 text-left dark:border-neutral-800 dark:bg-neutral-900'>
                <th className='px-4 py-2 font-medium text-neutral-700 dark:text-neutral-300'>Username</th>
                <th className='px-4 py-2 font-medium text-neutral-700 dark:text-neutral-300'>Role</th>
                <th className='w-24 px-4 py-2 text-right font-medium text-neutral-700 dark:text-neutral-300'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id
                return (
                  <tr
                    key={user.id}
                    className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-850'
                  >
                    <td className='px-4 py-2 text-neutral-850 dark:text-neutral-200'>
                      {user.username}
                      {isSelf && <span className='ml-2 text-xs text-neutral-400'>(you)</span>}
                    </td>
                    <td className='px-4 py-2 capitalize text-neutral-700 dark:text-neutral-300'>{user.role}</td>
                    <td className='px-4 py-2'>
                      <div className='flex items-center justify-end gap-2'>
                        {canEditRow(user) && (
                          <button
                            type='button'
                            title='Edit user'
                            onClick={() => setEditTarget({ user, isSelf })}
                            className='flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-850'
                          >
                            {/* pointer-events-none so the button's `title` tooltip wins
                                over the icon SVG's own <title> ("Pencil Icon"). */}
                            <PencilIcon className='pointer-events-none h-4 w-4' />
                          </button>
                        )}
                        {canDeleteRow(user) && (
                          <button
                            type='button'
                            title='Delete user'
                            onClick={() => setDeleteTarget(user)}
                            className='flex h-7 w-7 items-center justify-center rounded-md text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                          >
                            <TrashCanIcon className='pointer-events-none h-4 w-4 stroke-current' />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {users.length === 0 && <p className='px-4 py-3 text-sm text-neutral-500'>No users found.</p>}
        </div>
      )}

      {/* Create modal (admin only) */}
      {isAdmin && (
        <RuntimeUserModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode='create'
          title='New User'
          submitLabel='Create user'
          showRole
          initialRole='user'
          onSubmit={handleCreate}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <RuntimeUserModal
          open={!!editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null)
          }}
          mode='edit'
          title={editTarget.isSelf ? 'Edit your account' : `Edit user — ${editTarget.user.username}`}
          submitLabel='Save'
          initialUsername={editTarget.user.username}
          initialRole={editTarget.user.role}
          // Only admins can change roles, and never their own (prevents self-lockout);
          // the runtime enforces this too.
          showRole={isAdmin && !editTarget.isSelf}
          requireCurrentPassword={editTarget.isSelf}
          onSubmit={handleEdit}
        />
      )}

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <ModalContent className='flex w-[360px] select-none flex-col rounded-lg p-6'>
          <ModalTitle className='mb-2 text-lg font-semibold'>Delete user</ModalTitle>
          <p className='mb-6 text-sm text-neutral-600 dark:text-neutral-400'>
            "{deleteTarget?.username}" will no longer be able to log in to the runtime. This cannot be undone.
          </p>
          <div className='flex justify-end gap-3'>
            <button
              type='button'
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className='rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => void handleDelete()}
              disabled={deleting}
              className='rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50'
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}

export { UserManagementEditor }
