import {
  assignableRuntimeRoles,
  engineeringActionRefusal,
  isFourRoleRuntime,
  isHmiRole,
  readRuntimeRole,
  toRuntimeWireRole,
} from '../roles'

describe('runtime user roles', () => {
  describe('isFourRoleRuntime', () => {
    it.each([
      ['v4.4.0', true],
      ['4.4.0-rc.1', true],
      ['v4.5.2', true],
      ['v4.3.9', false],
      ['v4.1.9', false],
      [null, false],
      ['garbage', false],
    ])('%s -> %s', (version, expected) => {
      expect(isFourRoleRuntime(version)).toBe(expected)
    })
  })

  describe('readRuntimeRole (runtime to editor)', () => {
    it('keeps the four roles of a 4.4.0 runtime', () => {
      expect(readRuntimeRole('admin')).toBe('admin')
      expect(readRuntimeRole('engineer')).toBe('engineer')
      expect(readRuntimeRole('operator')).toBe('operator')
      expect(readRuntimeRole('viewer')).toBe('viewer')
    })

    it('reads the `user` role of an older runtime as engineer', () => {
      expect(readRuntimeRole('user')).toBe('engineer')
    })

    it('refuses anything else', () => {
      expect(readRuntimeRole('root')).toBeNull()
      expect(readRuntimeRole(undefined)).toBeNull()
      expect(readRuntimeRole(3)).toBeNull()
    })
  })

  describe('toRuntimeWireRole (editor to runtime)', () => {
    it('sends every role as named to a 4.4.0 runtime', () => {
      expect(toRuntimeWireRole('admin', 'v4.4.0')).toBe('admin')
      expect(toRuntimeWireRole('engineer', 'v4.4.0')).toBe('engineer')
      expect(toRuntimeWireRole('operator', 'v4.4.0')).toBe('operator')
      expect(toRuntimeWireRole('viewer', 'v4.4.0')).toBe('viewer')
    })

    it('sends an engineer as `user` to a runtime before 4.4.0', () => {
      expect(toRuntimeWireRole('engineer', 'v4.2.0')).toBe('user')
      expect(toRuntimeWireRole('admin', 'v4.2.0')).toBe('admin')
    })
  })

  describe('assignableRuntimeRoles', () => {
    it('offers the four roles on a 4.4.0 runtime', () => {
      expect(assignableRuntimeRoles('v4.4.0')).toEqual(['admin', 'engineer', 'operator', 'viewer'])
    })

    it('offers only Admin and Engineer before 4.4.0', () => {
      expect(assignableRuntimeRoles('v4.1.9')).toEqual(['admin', 'engineer'])
    })
  })

  it('tells HMI roles from engineering roles', () => {
    expect(isHmiRole('operator')).toBe(true)
    expect(isHmiRole('viewer')).toBe(true)
    expect(isHmiRole('engineer')).toBe(false)
    expect(isHmiRole(null)).toBe(false)
  })

  describe('engineeringActionRefusal', () => {
    it('names the role and the action for an HMI account', () => {
      expect(engineeringActionRefusal('operator', 'upload')).toBe("Your role (operator) can't upload programs")
      expect(engineeringActionRefusal('viewer', 'start-stop')).toBe("Your role (viewer) can't start or stop the PLC")
      expect(engineeringActionRefusal('operator', 'logs')).toBe("Your role (operator) can't read the runtime logs")
      expect(engineeringActionRefusal('viewer', 'debugger')).toBe("Your role (viewer) can't use the debugger")
    })

    it('refuses nothing to engineering roles or an unknown role', () => {
      expect(engineeringActionRefusal('admin', 'upload')).toBeNull()
      expect(engineeringActionRefusal('engineer', 'debugger')).toBeNull()
      expect(engineeringActionRefusal(null, 'upload')).toBeNull()
    })
  })
})
