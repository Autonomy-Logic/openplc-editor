import {
  formatProvisioningTarget,
  ProvisioningHostSchema,
  type RuntimeProvisioningEvent,
  type RuntimeProvisioningOutcome,
  type RuntimeProvisioningPort,
  RuntimeProvisioningRunRequestSchema,
  type SshProbeResult,
  SshPortSchema,
  SshProbeRequestSchema,
  toRuntimeProvisioningEvent,
  toRuntimeProvisioningOutcome,
  toSshProbeResult,
  validateRunRequest,
} from '../runtime-provisioning-port'

const label = (length: number, char = 'a') => char.repeat(length)
const host253 = [label(63), label(63), label(63), label(61)].join('.')
const host254 = [label(63), label(63), label(63), label(62)].join('.')

const validRequest = {
  host: '192.168.1.50',
  port: 22,
  username: 'commissioner42',
  password: 's3cret-pass',
}

describe('ProvisioningHostSchema', () => {
  it.each([
    ['an IPv4 address', '192.168.1.50'],
    ['a hostname', 'plc.local'],
    ['a single-label hostname', 'plc'],
    ['a hostname with digits and inner hyphens', 'plc-01.factory-a.example'],
    ['a one-character label', 'a'],
    ['an IPv6 address', 'fe80::1'],
    ['the IPv6 loopback', '::1'],
    ['a full IPv6 address', '2001:0db8:85a3:0000:0000:8a2e:0370:7334'],
    ['an IPv4-mapped IPv6 address', '::ffff:192.168.1.50'],
    ['a hostname of 253 characters with labels of 63, 63, 63 and 61', host253],
    ['a label of 63 characters', `${label(63)}.local`],
  ])('accepts %s', (_, host) => {
    expect(ProvisioningHostSchema.safeParse(host).success).toBe(true)
  })

  it.each([
    ['an empty host', ''],
    ['a hostname of 254 characters with labels of 63, 63, 63 and 62', host254],
    ['a label of 64 characters', `${label(64)}.local`],
    ['a label starting with a hyphen', '-plc.local'],
    ['a label ending with a hyphen', 'plc-.local'],
    ['an empty label', 'plc..local'],
    ['a trailing dot', 'plc.local.'],
    ['an underscore', 'plc_1.local'],
    ['a space', 'plc local'],
    ['a shell metacharacter', 'plc;reboot'],
    ['a URL', 'http://plc.local'],
    ['a host with a port', 'plc.local:22'],
    ['a bracketed IPv6 literal', '[fe80::1]'],
    ['an IPv6 zone index', 'fe80::1%eth0'],
    ['non-hex IPv6 digits', 'gggg::1'],
    ['a control character', 'plc\n.local'],
  ])('rejects %s', (_, host) => {
    expect(ProvisioningHostSchema.safeParse(host).success).toBe(false)
  })

  it.each([42, null, undefined, ['plc.local'], { host: 'plc.local' }])('rejects the non-string %p', (host) => {
    expect(ProvisioningHostSchema.safeParse(host).success).toBe(false)
  })
})

describe('SshPortSchema', () => {
  it.each([1, 22, 2222, 65535])('accepts %p', (port) => {
    expect(SshPortSchema.safeParse(port).success).toBe(true)
  })

  it.each([0, -22, 65536, 22.5, '22', Number.NaN, Number.POSITIVE_INFINITY, null])('rejects %p', (port) => {
    expect(SshPortSchema.safeParse(port).success).toBe(false)
  })
})

describe('RuntimeProvisioningRunRequestSchema', () => {
  it('accepts host, port, username and password', () => {
    expect(RuntimeProvisioningRunRequestSchema.safeParse(validRequest).success).toBe(true)
  })

  it.each([
    ['operation', 'install'],
    ['command', 'id'],
    ['installerUrl', 'http://evil.example/install.sh'],
  ])('rejects an extra field %p', (field, value) => {
    expect(RuntimeProvisioningRunRequestSchema.safeParse({ ...validRequest, [field]: value }).success).toBe(false)
  })
})

describe('SshProbeRequestSchema', () => {
  it('accepts host and port', () => {
    expect(SshProbeRequestSchema.safeParse({ host: '192.168.1.50', port: 22 }).success).toBe(true)
  })

  it('rejects credentials in a probe request', () => {
    expect(
      SshProbeRequestSchema.safeParse({ host: '192.168.1.50', port: 22, username: 'commissioner42' }).success,
    ).toBe(false)
  })

  it.each([
    ['port 0', { host: '192.168.1.50', port: 0 }],
    ['port "22" as a string', { host: '192.168.1.50', port: '22' }],
    ['port 22.5', { host: '192.168.1.50', port: 22.5 }],
    ['an invalid host', { host: 'plc..local', port: 22 }],
    ['no port', { host: '192.168.1.50' }],
  ])('rejects %s', (_, request) => {
    expect(SshProbeRequestSchema.safeParse(request).success).toBe(false)
  })
})

describe('validateRunRequest', () => {
  it.each([
    ['the plain request', validRequest],
    ['port 1', { ...validRequest, port: 1 }],
    ['port 65535', { ...validRequest, port: 65535 }],
    ['a valid hostname of 253 characters', { ...validRequest, host: host253 }],
    ['an IPv6 host', { ...validRequest, host: 'fe80::1' }],
    ['a username of 32 characters', { ...validRequest, username: 'u'.repeat(32) }],
    ['a username of 1 character', { ...validRequest, username: 'u' }],
    ['a password of 1,024 characters', { ...validRequest, password: 'p'.repeat(1024) }],
    ['a password of 1 character', { ...validRequest, password: 'p' }],
    [
      'a username of 32 and a password of 1,024 characters',
      { ...validRequest, username: 'u'.repeat(32), password: 'p'.repeat(1024) },
    ],
    ['a password with spaces and symbols', { ...validRequest, password: 'pass word ~!@#$%' }],
  ])('accepts %s', (_, request) => {
    expect(validateRunRequest(request)).toEqual({ ok: true, request })
  })

  it.each([
    ['port', 'port 0', { ...validRequest, port: 0 }],
    ['port', 'port 65536', { ...validRequest, port: 65536 }],
    ['port', 'port "22" as a string', { ...validRequest, port: '22' }],
    ['port', 'port 22.5', { ...validRequest, port: 22.5 }],
    ['port', 'no port', { host: '192.168.1.50', username: 'commissioner42', password: 's3cret-pass' }],
    ['host', 'a hostname of 254 characters', { ...validRequest, host: host254 }],
    ['host', 'an empty host', { ...validRequest, host: '' }],
    ['host', 'a host with a shell metacharacter', { ...validRequest, host: 'plc;reboot' }],
    ['host', 'a numeric host', { ...validRequest, host: 192 }],
    ['username', 'a username of 33 characters', { ...validRequest, username: 'u'.repeat(33) }],
    ['username', 'an empty username', { ...validRequest, username: '' }],
    ['username', 'a username with a tab', { ...validRequest, username: 'commis\tsioner' }],
    ['username', 'a username with DEL', { ...validRequest, username: 'commissioner\u007f' }],
    ['password', 'a password of 1,025 characters', { ...validRequest, password: 'p'.repeat(1025) }],
    ['password', 'an empty password', { ...validRequest, password: '' }],
    ['password', 'a password with a tab', { ...validRequest, password: 'pass\tword' }],
    ['password', 'a password with a newline', { ...validRequest, password: 'abc\nreboot' }],
    ['password', 'a password with NUL', { ...validRequest, password: 'abc\u0000' }],
    ['password', 'a password with U+001F', { ...validRequest, password: 'abc\u001f' }],
    ['password', 'a password with DEL', { ...validRequest, password: 'abc\u007f' }],
    ['password', 'a numeric password', { ...validRequest, password: 1234 }],
  ])('rejects the %s field: %s', (field, _, request) => {
    expect(validateRunRequest(request)).toEqual({ ok: false, field })
  })

  it.each([
    ['an extra field "operation": "install"', { ...validRequest, operation: 'install' }],
    ['an extra field "command": "id"', { ...validRequest, command: 'id' }],
    ['an extra field "installerUrl"', { ...validRequest, installerUrl: 'http://evil.example/install.sh' }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'host=192.168.1.50'],
    ['a number', 22],
    ['an array', [validRequest]],
  ])('rejects the payload for %s', (_, value) => {
    expect(validateRunRequest(value)).toEqual({ ok: false, field: 'payload' })
  })
})

describe('toRuntimeProvisioningEvent', () => {
  it.each<[string, RuntimeProvisioningEvent]>([
    ['a phase', { type: 'phase', phase: 'connecting', cancellable: true }],
    ['a phase with its operation', { type: 'phase', phase: 'installing', cancellable: false, operation: 'install' }],
    ['a start phase', { type: 'phase', phase: 'starting', cancellable: false, operation: 'start' }],
    ['the inspecting phase', { type: 'phase', phase: 'inspecting', cancellable: true }],
    ['the waiting phase', { type: 'phase', phase: 'waiting-runtime', cancellable: false }],
    ['an output line', { type: 'output', line: 'Pulling image...' }],
    ['an empty output line', { type: 'output', line: '' }],
    ['an info console message', { type: 'console', level: 'info', message: 'Connecting over SSH' }],
    ['a warning console message', { type: 'console', level: 'warning', message: 'Slow answer' }],
    ['an error console message', { type: 'console', level: 'error', message: 'Install failed' }],
    ['an audit line', { type: 'audit', line: 'install started on 192.168.1.50:22' }],
  ])('keeps %s', (_, event) => {
    expect(toRuntimeProvisioningEvent(event)).toEqual(event)
  })

  it.each([
    ['an unknown type', { type: 'progress', percent: 10 }],
    ['an unknown phase', { type: 'phase', phase: 'rebooting', cancellable: true }],
    ['a phase without cancellable', { type: 'phase', phase: 'connecting' }],
    ['a phase with a string cancellable', { type: 'phase', phase: 'connecting', cancellable: 'yes' }],
    [
      'a phase with an unknown operation',
      { type: 'phase', phase: 'starting', cancellable: false, operation: 'reboot' },
    ],
    ['a phase with operation none', { type: 'phase', phase: 'starting', cancellable: false, operation: 'none' }],
    ['an output without a line', { type: 'output' }],
    ['an output with a numeric line', { type: 'output', line: 42 }],
    ['a console message with an unknown level', { type: 'console', level: 'debug', message: 'x' }],
    ['a console message without a message', { type: 'console', level: 'info' }],
    ['a console message with a numeric message', { type: 'console', level: 'info', message: 1 }],
    ['an audit without a line', { type: 'audit' }],
    ['an audit with an object line', { type: 'audit', line: { text: 'x' } }],
    ['no type', { line: 'x' }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'phase'],
    ['an array', [{ type: 'output', line: 'x' }]],
  ])('reads %s as no event', (_, value) => {
    expect(toRuntimeProvisioningEvent(value)).toBeNull()
  })

  it('never carries a password or username that came along with an event', () => {
    const event = toRuntimeProvisioningEvent({
      type: 'output',
      line: 'Pulling image...',
      password: 'leaked-secret',
      username: 'leaked-user',
    })
    expect(JSON.stringify(event ?? null)).not.toContain('leaked-secret')
    expect(JSON.stringify(event ?? null)).not.toContain('leaked-user')
  })
})

describe('toRuntimeProvisioningOutcome', () => {
  it.each<RuntimeProvisioningOutcome>([
    { kind: 'connected-ready', operation: 'start' },
    { kind: 'connected-ready', operation: 'install' },
    { kind: 'connected-ready', operation: 'none' },
    { kind: 'not-started', operation: 'start', lastLines: ['line 1', 'line 2'] },
    { kind: 'not-started', operation: 'none', lastLines: [] },
    { kind: 'cancelled' },
    { kind: 'unknown' },
    { kind: 'busy' },
    { kind: 'invalid-input', field: 'host' },
    { kind: 'invalid-input', field: 'port' },
    { kind: 'invalid-input', field: 'username' },
    { kind: 'invalid-input', field: 'password' },
    { kind: 'invalid-input', field: 'payload' },
    { kind: 'ssh-unreachable' },
    { kind: 'host-key-changed', target: '192.168.1.50:22' },
    { kind: 'host-key-changed', target: '[fe80::1]:22' },
    { kind: 'host-key-file-unusable' },
    { kind: 'host-key-not-saved' },
    { kind: 'auth-rejected' },
    { kind: 'password-auth-not-accepted' },
    { kind: 'no-admin-rights' },
    { kind: 'unsupported', reason: 'os', detail: 'FreeBSD' },
    { kind: 'unsupported', reason: 'init', detail: 'openrc' },
    { kind: 'unsupported', reason: 'arch', detail: 'mips' },
    { kind: 'v3-present' },
    { kind: 'download-failed', dockerPresent: true },
    { kind: 'download-failed', dockerPresent: false },
    { kind: 'installer-failed', lastLines: ['error: disk full'] },
  ])('keeps %p', (outcome) => {
    expect(toRuntimeProvisioningOutcome(outcome)).toEqual(outcome)
  })

  it.each([
    ['an unknown kind', { kind: 'rebooted' }],
    ['no kind', { operation: 'start' }],
    ['connected-ready without an operation', { kind: 'connected-ready' }],
    ['connected-ready with an unknown operation', { kind: 'connected-ready', operation: 'reboot' }],
    ['not-started without lastLines', { kind: 'not-started', operation: 'start' }],
    ['not-started with a string lastLines', { kind: 'not-started', operation: 'start', lastLines: 'line 1' }],
    ['not-started with a numeric line', { kind: 'not-started', operation: 'start', lastLines: ['ok', 2] }],
    ['not-started with an unknown operation', { kind: 'not-started', operation: 'reboot', lastLines: [] }],
    ['invalid-input with an unknown field', { kind: 'invalid-input', field: 'operation' }],
    ['invalid-input without a field', { kind: 'invalid-input' }],
    ['host-key-changed without a target', { kind: 'host-key-changed' }],
    ['host-key-changed with a numeric target', { kind: 'host-key-changed', target: 22 }],
    ['unsupported with an unknown reason', { kind: 'unsupported', reason: 'cpu', detail: 'x' }],
    ['unsupported without a detail', { kind: 'unsupported', reason: 'os' }],
    ['unsupported with a numeric detail', { kind: 'unsupported', reason: 'arch', detail: 64 }],
    ['download-failed with a string dockerPresent', { kind: 'download-failed', dockerPresent: 'yes' }],
    ['download-failed without dockerPresent', { kind: 'download-failed' }],
    ['installer-failed without lastLines', { kind: 'installer-failed' }],
    ['installer-failed with a non-string line', { kind: 'installer-failed', lastLines: [null] }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'connected-ready'],
    ['an array', [{ kind: 'cancelled' }]],
  ])('reads %s as unknown', (_, value) => {
    expect(toRuntimeProvisioningOutcome(value)).toEqual({ kind: 'unknown' })
  })

  it('never carries a password or username that came along with an outcome', () => {
    const outcome = toRuntimeProvisioningOutcome({
      kind: 'auth-rejected',
      password: 'leaked-secret',
      username: 'leaked-user',
    })
    expect(JSON.stringify(outcome)).not.toContain('leaked-secret')
    expect(JSON.stringify(outcome)).not.toContain('leaked-user')
  })
})

describe('toSshProbeResult', () => {
  it.each<SshProbeResult>([
    { answered: true },
    { answered: false, reason: 'refused' },
    { answered: false, reason: 'timeout' },
    { answered: false, reason: 'unreachable' },
    { answered: false, reason: 'not-ssh' },
    { answered: false, reason: 'invalid-input' },
  ])('keeps %p', (result) => {
    expect(toSshProbeResult(result)).toEqual(result)
  })

  it.each([
    ['an unknown reason', { answered: false, reason: 'closed' }],
    ['no reason', { answered: false }],
    ['a string answered', { answered: 'true' }],
    ['no answered', { reason: 'refused' }],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an array', [{ answered: true }]],
  ])('reads %s as unreachable', (_, value) => {
    expect(toSshProbeResult(value)).toEqual({ answered: false, reason: 'unreachable' })
  })
})

describe('formatProvisioningTarget', () => {
  it.each([
    ['192.168.1.50', 22, '192.168.1.50:22'],
    ['plc.local', 2222, 'plc.local:2222'],
    ['fe80::1', 22, '[fe80::1]:22'],
    ['::ffff:192.168.1.50', 65535, '[::ffff:192.168.1.50]:65535'],
  ])('writes %p on port %p as %p', (host, port, target) => {
    expect(formatProvisioningTarget(host, port)).toBe(target)
  })
})

describe('RuntimeProvisioningPort', () => {
  it('exposes only probe, run, cancel and progress events', async () => {
    const port: RuntimeProvisioningPort = {
      probeSsh: () => Promise.resolve({ answered: true }),
      run: () => Promise.resolve({ kind: 'cancelled' }),
      cancel: () => Promise.resolve(),
      onEvent: () => () => undefined,
    }
    expect(Object.keys(port).sort()).toEqual(['cancel', 'onEvent', 'probeSsh', 'run'])
    await expect(port.probeSsh({ host: '192.168.1.50', port: 22 })).resolves.toEqual({ answered: true })
    await expect(port.run(validRequest)).resolves.toEqual({ kind: 'cancelled' })
  })
})
