import type { DeviceClass, RuntimeFacts, SystemFacts } from '../inspection'
import {
  archSupport,
  classifyRuntime,
  parseRuntimeFacts,
  parseSystemFacts,
  systemSupport,
  userlandArch,
} from '../inspection'

function lines(...values: string[]): string {
  return `${values.join('\n')}\n`
}

const PI4_64_BIT = lines('os=Linux', 'systemd=yes', 'dpkg_arch=arm64', 'machine=aarch64', 'long_bit=64', 'uid=1000')

function systemFacts(overrides: Partial<SystemFacts>): SystemFacts {
  return { os: 'Linux', systemd: true, dpkgArch: '', machine: 'x86_64', longBit: '64', uid: '1000', ...overrides }
}

function runtimeFacts(overrides: Partial<RuntimeFacts>): RuntimeFacts {
  return {
    docker: 'absent',
    bootloader: 'absent',
    runtimeContainer: 'absent',
    native: 'absent',
    v3Units: [],
    ...overrides,
  }
}

describe('parseSystemFacts', () => {
  it('reads every system fact', () => {
    expect(parseSystemFacts(PI4_64_BIT)).toEqual({
      os: 'Linux',
      systemd: true,
      dpkgArch: 'arm64',
      machine: 'aarch64',
      longBit: '64',
      uid: '1000',
    })
  })

  it('reads systemd=no and an empty dpkg architecture', () => {
    expect(
      parseSystemFacts(lines('os=FreeBSD', 'systemd=no', 'dpkg_arch=', 'machine=amd64', 'long_bit=64', 'uid=0')),
    ).toEqual({ os: 'FreeBSD', systemd: false, dpkgArch: '', machine: 'amd64', longBit: '64', uid: '0' })
  })

  it('accepts the keys in any order', () => {
    expect(
      parseSystemFacts(
        lines('uid=1000', 'long_bit=64', 'machine=aarch64', 'dpkg_arch=arm64', 'systemd=yes', 'os=Linux'),
      ),
    ).toEqual(parseSystemFacts(PI4_64_BIT))
  })

  it('removes control characters from the OS name and cuts it at 64 characters', () => {
    const os = `Free\u0007B\u001bS\u007fD${'x'.repeat(100)}`
    const facts = parseSystemFacts(
      lines(`os=${os}`, 'systemd=no', 'dpkg_arch=', 'machine=amd64', 'long_bit=64', 'uid=0'),
    )

    expect(facts?.os).toBe(`FreeBSD${'x'.repeat(57)}`)
  })

  it.each([
    ['empty output', ''],
    ['a missing key', lines('os=Linux', 'systemd=yes', 'dpkg_arch=arm64', 'machine=aarch64', 'long_bit=64')],
    ['a repeated key', `${PI4_64_BIT}uid=0\n`],
    ['an unknown key', `${PI4_64_BIT}kernel=6.1\n`],
    ['a systemd value other than yes or no', PI4_64_BIT.replace('systemd=yes', 'systemd=maybe')],
    ['a line without a key', `${PI4_64_BIT}garbage\n`],
  ])('returns null for %s', (_, stdout) => {
    expect(parseSystemFacts(stdout)).toBeNull()
  })
})

describe('parseRuntimeFacts', () => {
  const CASE_F = lines('docker=active', 'bootloader=running', 'runtime_container=stopped', 'native=absent', 'v3=none')

  it('reads every runtime fact, with no v3 unit', () => {
    expect(parseRuntimeFacts(CASE_F)).toEqual({
      docker: 'active',
      bootloader: 'running',
      runtimeContainer: 'stopped',
      native: 'absent',
      v3Units: [],
    })
  })

  it('reads the present v3 units from a comma-separated list', () => {
    const stdout = lines(
      'docker=inactive',
      'bootloader=stopped',
      'runtime_container=stopped',
      'native=inactive',
      'v3=openplc.service,openplc-v3.service',
    )

    expect(parseRuntimeFacts(stdout)).toEqual({
      docker: 'inactive',
      bootloader: 'stopped',
      runtimeContainer: 'stopped',
      native: 'inactive',
      v3Units: ['openplc.service', 'openplc-v3.service'],
    })
  })

  it.each([
    ['docker', 'docker=running'],
    ['bootloader', 'bootloader=active'],
    ['runtime_container', 'runtime_container=inactive'],
    ['native', 'native=running'],
  ])('returns null for a value %s cannot take', (key, replacement) => {
    const stdout = CASE_F.split('\n')
      .map((line) => (line.startsWith(`${key}=`) ? replacement : line))
      .join('\n')

    expect(parseRuntimeFacts(stdout)).toBeNull()
  })

  it.each([
    ['empty output', ''],
    ['a missing key', lines('docker=active', 'bootloader=running', 'runtime_container=stopped', 'native=absent')],
    ['a repeated key', `${CASE_F}docker=absent\n`],
    ['an unknown key', `${CASE_F}podman=active\n`],
    ['a v3 unit that is not an OpenPLC v3 unit', CASE_F.replace('v3=none', 'v3=sshd.service')],
  ])('returns null for %s', (_, stdout) => {
    expect(parseRuntimeFacts(stdout)).toBeNull()
  })
})

describe('systemSupport', () => {
  it('accepts Linux with systemd', () => {
    expect(systemSupport(systemFacts({}))).toEqual({ ok: true })
  })

  it('refuses another operating system and names it', () => {
    expect(systemSupport(systemFacts({ os: 'FreeBSD', systemd: false }))).toEqual({
      ok: false,
      reason: 'os',
      detail: 'FreeBSD',
    })
  })

  it('refuses Linux without systemd for its init system', () => {
    expect(systemSupport(systemFacts({ systemd: false, dpkgArch: 'arm64', machine: 'aarch64' }))).toEqual(
      expect.objectContaining({ ok: false, reason: 'init' }),
    )
  })

  it('removes control characters from the detail and cuts it at 64 characters', () => {
    const support = systemSupport(systemFacts({ os: `Dar\u0007win${'y'.repeat(100)}` }))

    expect(support).toEqual({ ok: false, reason: 'os', detail: `Darwin${'y'.repeat(58)}` })
  })
})

describe('userlandArch', () => {
  it('uses the dpkg architecture when there is one', () => {
    expect(userlandArch(systemFacts({ dpkgArch: 'armhf', machine: 'aarch64', longBit: '32' }))).toBe('armhf')
  })

  it.each([
    ['x86_64', '64', 'amd64'],
    ['aarch64', '64', 'arm64'],
    ['aarch64', '32', 'armhf'],
    ['armv7l', '32', 'armhf'],
    ['armv8l', '32', 'armhf'],
    ['armv6l', '32', 'armhf'],
    ['i686', '32', 'i386'],
    ['i386', '32', 'i386'],
    ['riscv64', '64', 'riscv64'],
    ['mips', '32', 'mips'],
  ])('maps machine %s with %s-bit userland to %s when dpkg is absent', (machine, longBit, arch) => {
    expect(userlandArch(systemFacts({ dpkgArch: '', machine, longBit }))).toBe(arch)
  })
})

describe('archSupport', () => {
  it.each([
    ['an amd64 userland', systemFacts({ dpkgArch: 'amd64', machine: 'x86_64' }), 'amd64'],
    ['an arm64 userland', systemFacts({ dpkgArch: 'arm64', machine: 'aarch64' }), 'arm64'],
    ['an armhf userland on ARMv7', systemFacts({ dpkgArch: 'armhf', machine: 'armv7l', longBit: '32' }), 'armhf'],
    [
      'an armhf userland on ARMv8 in 32-bit mode',
      systemFacts({ dpkgArch: 'armhf', machine: 'armv8l', longBit: '32' }),
      'armhf',
    ],
    [
      'Raspberry Pi OS 32-bit on a 64-bit kernel',
      systemFacts({ dpkgArch: 'armhf', machine: 'aarch64', longBit: '32' }),
      'armhf',
    ],
    ['an x86_64 machine without dpkg', systemFacts({ dpkgArch: '', machine: 'x86_64', longBit: '64' }), 'amd64'],
  ])('accepts %s', (_, facts, arch) => {
    expect(archSupport(facts)).toEqual({ ok: true, arch })
  })

  it.each([
    [
      'an armhf userland on ARMv6',
      systemFacts({ dpkgArch: 'armhf', machine: 'armv6l', longBit: '32' }),
      /armhf|armv6l/,
    ],
    ['an i386 userland', systemFacts({ dpkgArch: 'i386', machine: 'i686', longBit: '32' }), /i386/],
    ['an i686 machine without dpkg', systemFacts({ dpkgArch: '', machine: 'i686', longBit: '32' }), /i386|i686/],
    ['a riscv64 userland', systemFacts({ dpkgArch: 'riscv64', machine: 'riscv64' }), /riscv64/],
  ])('refuses %s and names the architecture', (_, facts, named) => {
    const support = archSupport(facts)

    expect(support.ok).toBe(false)
    expect(support.ok ? '' : support.detail).toMatch(named)
  })
})

describe('classifyRuntime', () => {
  const cases: [string, Partial<RuntimeFacts>, DeviceClass][] = [
    ['a v3 unit alone', { v3Units: ['openplc.service'] }, { kind: 'v3-present' }],
    ['the openplc_v3 unit', { v3Units: ['openplc_v3.service'] }, { kind: 'v3-present' }],
    ['the openplc-v3 unit', { v3Units: ['openplc-v3.service'] }, { kind: 'v3-present' }],
    [
      'a v3 unit next to a stopped container v4 install',
      { v3Units: ['openplc.service'], docker: 'inactive', bootloader: 'stopped', runtimeContainer: 'stopped' },
      { kind: 'v3-present' },
    ],
    [
      'a v3 unit next to a running native v4 service',
      { v3Units: ['openplc.service'], native: 'active' },
      { kind: 'v3-present' },
    ],
    [
      'a container install with Docker stopped',
      { docker: 'inactive', bootloader: 'stopped', runtimeContainer: 'stopped' },
      { kind: 'start', target: 'docker-and-bootloader' },
    ],
    [
      'a container install with Docker stopped and stale running records',
      { docker: 'inactive', bootloader: 'running', runtimeContainer: 'running' },
      { kind: 'start', target: 'docker-and-bootloader' },
    ],
    [
      'a container install with Docker running and the bootloader stopped',
      { docker: 'active', bootloader: 'stopped', runtimeContainer: 'stopped' },
      { kind: 'start', target: 'bootloader' },
    ],
    [
      'the bootloader running with the runtime container stopped',
      { docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' },
      { kind: 'start', target: 'runtime-container' },
    ],
    [
      'the bootloader running with no runtime container',
      { docker: 'active', bootloader: 'running', runtimeContainer: 'absent' },
      { kind: 'start', target: 'runtime-container' },
    ],
    [
      'a container install fully running',
      { docker: 'active', bootloader: 'running', runtimeContainer: 'running' },
      { kind: 'already-running' },
    ],
    [
      'a container install next to a stopped native service',
      { docker: 'active', bootloader: 'stopped', runtimeContainer: 'stopped', native: 'inactive' },
      { kind: 'start', target: 'bootloader' },
    ],
    ['a stopped native v4 service', { native: 'inactive' }, { kind: 'start', target: 'native-service' }],
    [
      'a stopped native v4 service on a host with Docker',
      { docker: 'active', native: 'inactive' },
      { kind: 'start', target: 'native-service' },
    ],
    ['a running native v4 service', { native: 'active' }, { kind: 'already-running' }],
    ['no runtime at all', {}, { kind: 'install' }],
    ['Docker without the OpenPLC containers', { docker: 'active' }, { kind: 'install' }],
    [
      'only a stray runtime container without the bootloader',
      { docker: 'active', runtimeContainer: 'stopped' },
      { kind: 'install' },
    ],
  ]

  it.each(cases)('classifies %s', (_, overrides, expected) => {
    expect(classifyRuntime(runtimeFacts(overrides))).toEqual(expected)
  })
})
