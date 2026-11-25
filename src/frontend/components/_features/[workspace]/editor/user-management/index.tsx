import { PencilIcon } from '@root/frontend/assets/icons/interface/Pencil'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { RefreshIcon } from '@root/frontend/assets/icons/interface/Refresh'
import { TrashCanIcon } from '@root/frontend/assets/icons/interface/TrashCan'
import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { Modal, ModalContent, ModalTitle } from '@root/frontend/components/_molecules/modal'
import {
  RuntimeUserModal,
  type RuntimeUserModalSubmit,
} from '@root/frontend/components/_organisms/modals/runtime-user-modal'
import { refreshRuntimeAccount, updateOwnRuntimeAccount } from '@root/frontend/services/runtime-account'
import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import type { RuntimeUser, UpdateUserParams } from '@root/middleware/shared/ports/runtime-port'
import { useRuntime } from '@root/middleware/shared/providers'
import {
  assignableRuntimeRoles,
  DEFAULT_NEW_ACCOUNT_ROLE,
  RUNTIME_ROLE_LABELS,
  toRuntimeWireRole,
} from '@root/middleware/shared/utils/runtime-users/roles'
import { runtimeUserRefusal } from '@root/middleware/shared/utils/runtime-users/wire'
import { useCallback, useEffect, useState } from 'react'

type EditTarget = { user: RuntimeUser; isSelf: boolean }

const actionButtonClass =
  'flex h-9 items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-medium-dark'

const UserManagementEditor = () => {
  const store = useOpenPLCStoreApi()
  const runtime = useRuntime()
  const connectionStatus = useOpenPLCStore((s) => s.runtimeConnection.connectionStatus)
  const runtimeVersion = useOpenPLCStore((s) => s.runtimeConnection.runtimeVersion)

  const [users, setUsers] = useState<RuntimeUser[]>([])
  const [currentUser, setCurrentUser] = useState<RuntimeUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [listNotice, setListNotice] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RuntimeUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const role = currentUser?.role ?? null
  const roleOptions = assignableRuntimeRoles(runtimeVersion)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setListNotice(null)
    const me = await refreshRuntimeAccount(store, runtime)
    setCurrentUser(me)
    const listResult = await runtime.listUsers()
    if (listResult.success) {
      setUsers(listResult.users ?? [])
    } else if (me) {
      setListNotice(runtimeUserRefusal('list', listResult.error, me.role))
      setUsers([me])
    } else {
      setLoadError(runtimeUserRefusal('list', listResult.error, null))
      setUsers([])
    }
    setLoading(false)
  }, [store, runtime])

  useEffect(() => {
    if (connectionStatus === 'connected') {
      void refresh()
    }
  }, [connectionStatus, refresh])

  const handleCreate = async ({ username, password, role: picked }: RuntimeUserModalSubmit): Promise<string | null> => {
    if (!password) return 'Password is required'
    const wireRole = toRuntimeWireRole(picked ?? DEFAULT_NEW_ACCOUNT_ROLE, runtimeVersion)
    const result = await runtime.createUser({ username, password, role: wireRole })
    if (!result.success) return runtimeUserRefusal('create', result.error, role)
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
    if (values.roleChanged && values.role) params.role = toRuntimeWireRole(values.role, runtimeVersion)
    const result = editTarget.isSelf
      ? await updateOwnRuntimeAccount(store, runtime, editTarget.user.id, params)
      : await runtime.updateUser(editTarget.user.id, params)
    if (!result.success) return runtimeUserRefusal(values.usernameChanged ? 'rename' : 'update', result.error, role)

    if (editTarget.isSelf && values.passwordChanged) {
      toast({ title: 'Password changed', description: 'You are still signed in.', variant: 'default' })
    } else {
      toast({ title: 'User updated', description: `"${values.username}" was updated.`, variant: 'default' })
    }
    void refresh()
    return null
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await runtime.deleteUser(deleteTarget.id)
    setDeleting(false)
    if (!result.success) {
      toast({
        title: 'Delete failed',
        description: runtimeUserRefusal('delete', result.error, role),
        variant: 'fail',
      })
      return
    }
    toast({ title: 'User deleted', description: `"${deleteTarget.username}" was deleted.`, variant: 'default' })
    setDeleteTarget(null)
    void refresh()
  }

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
          <button type='button' onClick={() => setCreateOpen(true)} className={actionButtonClass}>
            {/* PlusIcon strokes `inherit`; without a stroke color it renders
                invisibly and its empty box pushed the label off-center. */}
            <PlusIcon className='h-4 w-4 stroke-current' />
            <span className='leading-none'>New User</span>
          </button>
        </div>
      </div>

      {loading ? (
        <p className='text-sm text-neutral-500'>Loading users…</p>
      ) : loadError ? (
        <p className='text-sm text-red-600 dark:text-red-400'>{loadError}</p>
      ) : (
        <>
          {listNotice !== null && (
            <p role='status' className='mb-3 text-sm text-neutral-600 dark:text-neutral-400'>
              {listNotice}.
            </p>
          )}
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
                    <tr key={user.id} className='border-b border-neutral-100 last:border-b-0 dark:border-neutral-850'>
                      <td className='px-4 py-2 text-neutral-850 dark:text-neutral-200'>
                        {user.username}
                        {isSelf && <span className='ml-2 text-xs text-neutral-400'>(you)</span>}
                      </td>
                      <td className='px-4 py-2 text-neutral-700 dark:text-neutral-300'>
                        {RUNTIME_ROLE_LABELS[user.role]}
                      </td>
                      <td className='px-4 py-2'>
                        <div className='flex items-center justify-end gap-2'>
                          <button
                            type='button'
                            title='Edit user'
                            aria-label={`Edit ${user.username}`}
                            onClick={() => setEditTarget({ user, isSelf })}
                            className='flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-850'
                          >
                            {/* pointer-events-none so the button's `title` tooltip wins
                                over the icon SVG's own <title> ("Pencil Icon"). */}
                            <PencilIcon className='pointer-events-none h-4 w-4' />
                          </button>
                          <button
                            type='button'
                            title='Delete user'
                            aria-label={`Delete ${user.username}`}
                            onClick={() => setDeleteTarget(user)}
                            className='flex h-7 w-7 items-center justify-center rounded-md text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                          >
                            <TrashCanIcon className='pointer-events-none h-4 w-4 stroke-current' />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {users.length === 0 && <p className='px-4 py-3 text-sm text-neutral-500'>No users found.</p>}
          </div>
        </>
      )}

      <RuntimeUserModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode='create'
        title='New User'
        submitLabel='Create user'
        showRole
        roleOptions={roleOptions}
        initialRole={DEFAULT_NEW_ACCOUNT_ROLE}
        onSubmit={handleCreate}
      />

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
          showRole
          roleOptions={roleOptions}
          requireCurrentPassword={editTarget.isSelf}
          onSubmit={handleEdit}
        />
      )}

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
