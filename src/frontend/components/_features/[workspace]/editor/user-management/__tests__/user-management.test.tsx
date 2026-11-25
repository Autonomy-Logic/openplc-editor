import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type {
  CreateUserParams,
  ListUsersResult,
  RuntimeUser,
  UpdateUserParams,
} from '@root/middleware/shared/ports/runtime-port'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { UserManagementEditor } from '..'

const ADMIN: RuntimeUser = { id: 1, username: 'admin', role: 'admin' }
const ENGINEER: RuntimeUser = { id: 2, username: 'eng', role: 'engineer' }
const OPERATOR: RuntimeUser = { id: 3, username: 'op', role: 'operator' }

let store: OpenPLCStore
let me: RuntimeUser
let accounts: RuntimeUser[]
let listCalls: number
let created: CreateUserParams[]
let updated: Array<{ id: number; params: UpdateUserParams }>
let ownUpdates: Array<{ id: number; params: UpdateUserParams }>
let ownUpdateAnswer: { success: boolean; error?: string }
let createAnswer: { success: boolean; error?: string }
let listRefusal: string | null
let deleted: number[]

const ROLE_REFUSAL = '{"msg":"This account\'s role may not use this endpoint"}'

function renderScreen(runtimeVersion: string) {
  const { deviceActions } = store.getState()
  deviceActions.setRuntimeVersion(runtimeVersion)
  deviceActions.setRuntimeJwtToken('tok')
  deviceActions.setRuntimeConnectionStatus('connected')
  const ports = createTestPorts({
    capabilities: EDITOR_CAPABILITIES,
    runtime: {
      whoAmI: () => Promise.resolve({ success: true, user: me }),
      listUsers: () => {
        listCalls += 1
        return Promise.resolve<ListUsersResult>(
          listRefusal === null ? { success: true, users: accounts } : { success: false, error: listRefusal },
        )
      },
      createUser: (params) => {
        created.push(params)
        return Promise.resolve(createAnswer)
      },
      updateUser: (id, params) => {
        updated.push({ id, params })
        return Promise.resolve({ success: true })
      },
      updateOwnAccount: (id, params) => {
        ownUpdates.push({ id, params })
        return Promise.resolve(ownUpdateAnswer)
      },
      deleteUser: (id) => {
        deleted.push(id)
        return Promise.resolve({ success: true })
      },
    },
  })
  render(<UserManagementEditor />, { wrapper: createStoreWrapper(store, ports) })
}

function rowOf(username: string): HTMLElement {
  const cell = screen.getByText(username, { selector: 'td' })
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${username}`)
  return row
}

function fillNewPassword(current?: string) {
  const pass = screen.getByPlaceholderText('Enter password')
  fireEvent.focus(pass)
  fireEvent.change(pass, { target: { value: 'new-secret' } })
  fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'new-secret' } })
  if (current !== undefined) {
    fireEvent.change(screen.getByPlaceholderText('Enter your current password'), { target: { value: current } })
  }
}

beforeEach(() => {
  store = createTestStore()
  accounts = [ADMIN, ENGINEER, OPERATOR]
  listCalls = 0
  created = []
  updated = []
  ownUpdates = []
  ownUpdateAnswer = { success: true }
  createAnswer = { success: true }
  listRefusal = null
  deleted = []
})

afterEach(() => {
  cleanup()
})

describe('User Management, admin', () => {
  beforeEach(() => {
    me = ADMIN
  })

  it('lists the accounts with their roles, and creates an engineer by default from the four described roles', async () => {
    renderScreen('v4.4.0')
    await screen.findByText('eng', { selector: 'td' })
    expect(within(rowOf('op')).getByText('Operator')).toBeTruthy()

    fireEvent.click(screen.getByText('New User'))
    for (const label of ['Admin', 'Engineer', 'Operator', 'Viewer']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy()
    }
    expect(
      screen.getByText('Uses the HMI screens granted to viewers; no program upload, debugging or account management.'),
    ).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Engineer' })).toHaveProperty('checked', true)

    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'line1' } })
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'pw' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Create user'))

    await waitFor(() => expect(created).toEqual([{ username: 'line1', password: 'pw', role: 'engineer' }]))
  })

  it("changes another account's role", async () => {
    renderScreen('v4.4.0')
    await screen.findByText('op', { selector: 'td' })
    fireEvent.click(within(rowOf('op')).getByRole('button', { name: 'Edit op' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Viewer' }))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(updated).toEqual([{ id: 3, params: { role: 'viewer' } }]))
    expect(ownUpdates).toEqual([])
  })

  it('shows the runtime refusal to demote the last admin as a clear message', async () => {
    ownUpdateAnswer = { success: false, error: '{"msg":"Cannot demote the last remaining admin"}' }
    renderScreen('v4.4.0')
    await screen.findByText('admin', { selector: 'td' })
    fireEvent.click(within(rowOf('admin')).getByRole('button', { name: 'Edit admin' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Engineer' }))
    fireEvent.click(screen.getByText('Save'))

    expect(
      await screen.findByText('Cannot demote the last remaining admin. Make another account an admin first.'),
    ).toBeTruthy()
    expect(ownUpdates).toEqual([{ id: 1, params: { role: 'engineer' } }])
  })

  it('offers Delete on its own row too and leaves the decision to the runtime', async () => {
    renderScreen('v4.4.0')
    await screen.findByText('admin', { selector: 'td' })
    fireEvent.click(within(rowOf('admin')).getByRole('button', { name: 'Delete admin' }))
    fireEvent.click(screen.getByText('Delete', { selector: 'button' }))
    await waitFor(() => expect(deleted).toEqual([1]))
  })

  it('on a runtime before 4.4.0 offers only Admin and Engineer, shows `user` as Engineer and sends Engineer as `user`', async () => {
    accounts = [ADMIN, { id: 2, username: 'eng', role: 'engineer' }]
    renderScreen('v4.2.0')
    await screen.findByText('eng', { selector: 'td' })
    expect(within(rowOf('eng')).getByText('Engineer')).toBeTruthy()

    fireEvent.click(screen.getByText('New User'))
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Admin', 'Engineer'])

    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'old' } })
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'pw' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Create user'))
    await waitFor(() => expect(created).toEqual([{ username: 'old', password: 'pw', role: 'user' }]))
  })
})

describe('User Management, engineer', () => {
  beforeEach(() => {
    me = ENGINEER
  })

  it('sees every action on every row, and the runtime refusal of a create names the role', async () => {
    createAnswer = { success: false, error: ROLE_REFUSAL }
    renderScreen('v4.4.0')
    await screen.findByText('admin', { selector: 'td' })
    for (const name of ['admin', 'eng', 'op']) {
      expect(within(rowOf(name)).getByRole('button', { name: `Edit ${name}` })).toBeTruthy()
      expect(within(rowOf(name)).getByRole('button', { name: `Delete ${name}` })).toBeTruthy()
    }

    fireEvent.click(screen.getByText('New User'))
    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'x' } })
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'pw' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Create user'))
    expect(await screen.findByText("Your role (engineer) can't create accounts")).toBeTruthy()
    expect(created).toHaveLength(1)
  })

  it('edits its own account with the role picker shown', async () => {
    renderScreen('v4.4.0')
    await screen.findByText('eng', { selector: 'td' })
    fireEvent.click(within(rowOf('eng')).getByRole('button', { name: 'Edit eng' }))
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'eng2' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(ownUpdates).toEqual([{ id: 2, params: { username: 'eng2' } }]))
  })
})

describe('User Management, operator and viewer', () => {
  it.each([OPERATOR, { id: 4, username: 'view', role: 'viewer' as const }])(
    '$role asks for the list, shows the refusal and still lists its own account',
    async (account) => {
      me = account
      listRefusal = ROLE_REFUSAL
      renderScreen('v4.4.0')
      expect(await screen.findByText(`The account list is not available to your role (${account.role}).`)).toBeTruthy()
      expect(listCalls).toBe(1)
      const row = rowOf(account.username)
      expect(within(row).getByRole('button', { name: `Edit ${account.username}` })).toBeTruthy()
      expect(screen.getAllByRole('row')).toHaveLength(2)
    },
  )

  it('changes its own password through the session, which stays connected', async () => {
    me = OPERATOR
    listRefusal = ROLE_REFUSAL
    store.getState().deviceActions.setStoredCredentials({ username: 'op', password: 'old-secret' })
    renderScreen('v4.4.0')
    await screen.findByText('op', { selector: 'td' })
    fireEvent.click(within(rowOf('op')).getByRole('button', { name: 'Edit op' }))
    expect(screen.getByPlaceholderText('Enter username')).toHaveProperty('readOnly', false)

    fillNewPassword('old-secret')
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(ownUpdates).toEqual([{ id: 3, params: { password: 'new-secret', currentPassword: 'old-secret' } }]),
    )
    expect(updated).toEqual([])
    expect(store.getState().runtimeConnection.connectionStatus).toBe('connected')
    expect(store.getState().runtimeConnection.storedCredentials).toEqual({ username: 'op', password: 'new-secret' })
  })

  it('shows the runtime refusal of a rename by its role', async () => {
    me = OPERATOR
    listRefusal = ROLE_REFUSAL
    ownUpdateAnswer = { success: false, error: ROLE_REFUSAL }
    renderScreen('v4.4.0')
    await screen.findByText('op', { selector: 'td' })
    fireEvent.click(within(rowOf('op')).getByRole('button', { name: 'Edit op' }))
    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'op2' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText("Your role (operator) can't rename accounts")).toBeTruthy()
  })
})
