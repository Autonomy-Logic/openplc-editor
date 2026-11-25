import {
  parseRuntimeUser,
  parseRuntimeUserList,
  runtimeUpdateUserBody,
  runtimeUserErrorMessage,
  runtimeUserRefusal,
} from '../wire'

describe('runtime user wire format', () => {
  it('parses an account and reads `user` as engineer', () => {
    expect(parseRuntimeUser({ id: 2, username: 'bob', role: 'user' })).toEqual({
      id: 2,
      username: 'bob',
      role: 'engineer',
    })
    expect(parseRuntimeUser({ id: 3, username: 'op', role: 'operator' })).toEqual({
      id: 3,
      username: 'op',
      role: 'operator',
    })
  })

  it('refuses something that is not an account', () => {
    expect(parseRuntimeUser({ msg: 'Users found' })).toBeNull()
    expect(parseRuntimeUser({ id: '1', username: 'x', role: 'admin' })).toBeNull()
    expect(parseRuntimeUser({ id: 1, username: 'x', role: 'root' })).toBeNull()
    expect(parseRuntimeUser(null)).toBeNull()
  })

  it('lists the accounts of a reply and nothing for a non-list', () => {
    expect(
      parseRuntimeUserList([
        { id: 1, username: 'admin', role: 'admin' },
        { id: 2, username: 'eng', role: 'user' },
        { nope: true },
      ]),
    ).toEqual([
      { id: 1, username: 'admin', role: 'admin' },
      { id: 2, username: 'eng', role: 'engineer' },
    ])
    expect(parseRuntimeUserList({ msg: 'Users found' })).toEqual([])
  })

  it('builds the update body with only the given fields', () => {
    expect(runtimeUpdateUserBody({ password: 'n', currentPassword: 'o' })).toEqual({
      password: 'n',
      current_password: 'o',
    })
    expect(runtimeUpdateUserBody({ username: 'u', role: 'user' })).toEqual({ username: 'u', role: 'user' })
    expect(runtimeUpdateUserBody({})).toEqual({})
  })

  describe('runtimeUserErrorMessage', () => {
    it('reads the runtime message out of a JSON body', () => {
      expect(runtimeUserErrorMessage('{"msg":"Username already exists"}', 'x')).toBe('Username already exists')
      expect(runtimeUserErrorMessage('"Wrong username or password"', 'x')).toBe('Wrong username or password')
    })

    it('explains the last-admin refusal', () => {
      expect(runtimeUserErrorMessage('{"msg":"Cannot demote the last remaining admin"}', 'x')).toBe(
        'Cannot demote the last remaining admin. Make another account an admin first.',
      )
      expect(runtimeUserErrorMessage('Cannot demote the last remaining admin', 'x')).toBe(
        'Cannot demote the last remaining admin. Make another account an admin first.',
      )
    })

    it('falls back when there is no error and keeps plain text', () => {
      expect(runtimeUserErrorMessage(undefined, 'Failed')).toBe('Failed')
      expect(runtimeUserErrorMessage('socket hang up', 'Failed')).toBe('socket hang up')
    })
  })
})

describe('runtimeUserRefusal', () => {
  const ROLE_REFUSAL = '{"msg":"This account\'s role may not use this endpoint"}'

  it('names the action and the role for the runtime role refusal', () => {
    expect(runtimeUserRefusal('list', ROLE_REFUSAL, 'operator')).toBe(
      'The account list is not available to your role (operator)',
    )
    expect(runtimeUserRefusal('create', ROLE_REFUSAL, 'engineer')).toBe("Your role (engineer) can't create accounts")
    expect(runtimeUserRefusal('rename', ROLE_REFUSAL, 'viewer')).toBe("Your role (viewer) can't rename accounts")
    expect(runtimeUserRefusal('delete', ROLE_REFUSAL, 'engineer')).toBe("Your role (engineer) can't delete accounts")
    expect(runtimeUserRefusal('update', ROLE_REFUSAL, null)).toBe("Your role (unknown) can't change this account")
  })

  it("keeps the runtime's own refusals, which already say what happened", () => {
    expect(runtimeUserRefusal('delete', '{"msg":"Admin privileges required"}', 'engineer')).toBe(
      'Admin privileges required',
    )
    expect(runtimeUserRefusal('delete', '{"msg":"You cannot delete your own account"}', 'admin')).toBe(
      'You cannot delete your own account',
    )
    expect(runtimeUserRefusal('update', '{"msg":"Only an admin can change roles"}', 'engineer')).toBe(
      'Only an admin can change roles',
    )
    expect(runtimeUserRefusal('update', '{"msg":"Cannot demote the last remaining admin"}', 'admin')).toBe(
      'Cannot demote the last remaining admin. Make another account an admin first.',
    )
  })

  it('falls back per action when there is no error text', () => {
    expect(runtimeUserRefusal('list', undefined, 'admin')).toBe('Failed to load users')
    expect(runtimeUserRefusal('delete', '', 'admin')).toBe('Failed to delete user')
  })
})
