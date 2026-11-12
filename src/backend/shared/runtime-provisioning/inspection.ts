import { V3_UNITS } from './runtime-names'

export interface SystemFacts {
  os: string
  systemd: boolean
  dpkgArch: string
  machine: string
  longBit: string
  uid: string
}

export interface RuntimeFacts {
  docker: 'absent' | 'inactive' | 'active'
  bootloader: 'absent' | 'stopped' | 'running'
  runtimeContainer: 'absent' | 'stopped' | 'running'
  native: 'absent' | 'inactive' | 'active'
  v3Units: string[]
}

export type DeviceClass =
  | { kind: 'v3-present' }
  | {
      kind: 'start'
      target: 'docker-and-bootloader' | 'bootloader' | 'bootloader-restart' | 'runtime-container' | 'native-service'
    }
  | { kind: 'already-running' }
  | { kind: 'install' }

const DISPLAY_MAX_LENGTH = 64
const LAST_C0_CONTROL = 0x1f
const FIRST_DEL_OR_C1_CONTROL = 0x7f
const LAST_C1_CONTROL = 0x9f
const NUMBER_TEXT = /^[0-9]*$/
const UID_TEXT = /^[0-9]+$/
const SYSTEM_KEYS = ['os', 'systemd', 'dpkg_arch', 'machine', 'long_bit', 'uid'] as const
const RUNTIME_KEYS = ['docker', 'bootloader', 'runtime_container', 'native', 'v3'] as const
const SERVICE_STATES = ['absent', 'inactive', 'active'] as const
const CONTAINER_STATES = ['absent', 'stopped', 'running'] as const
const ARMHF_MACHINES = ['armv7l', 'armv8l', 'aarch64']

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code <= LAST_C0_CONTROL || (code >= FIRST_DEL_OR_C1_CONTROL && code <= LAST_C1_CONTROL)
}

function displayText(text: string): string {
  return Array.from(text)
    .filter((character) => !isControlCharacter(character))
    .slice(0, DISPLAY_MAX_LENGTH)
    .join('')
}

function oneOf<T extends string>(options: readonly T[], value: string | undefined): T | undefined {
  return options.find((option) => option === value)
}

function parseKeyValues<K extends string>(stdout: string, keys: readonly K[]): Map<K, string> | null {
  const lines = stdout.endsWith('\n') ? stdout.slice(0, -1).split('\n') : stdout.split('\n')
  const values = new Map<K, string>()
  for (const line of lines) {
    const separator = line.indexOf('=')
    const key = oneOf(keys, line.slice(0, Math.max(separator, 0)))
    if (separator < 1 || key === undefined || values.has(key)) return null
    values.set(key, line.slice(separator + 1))
  }
  return keys.every((key) => values.has(key)) ? values : null
}

export function parseSystemFacts(stdout: string): SystemFacts | null {
  const values = parseKeyValues(stdout, SYSTEM_KEYS)
  if (values === null) return null
  const systemd = values.get('systemd')
  const longBit = values.get('long_bit') ?? ''
  const uid = values.get('uid') ?? ''
  const valid = (systemd === 'yes' || systemd === 'no') && NUMBER_TEXT.test(longBit) && UID_TEXT.test(uid)
  if (!valid) return null
  return {
    os: displayText(values.get('os') ?? ''),
    systemd: systemd === 'yes',
    dpkgArch: displayText(values.get('dpkg_arch') ?? ''),
    machine: displayText(values.get('machine') ?? ''),
    longBit,
    uid,
  }
}

function parseV3Units(text: string | undefined): string[] | null {
  if (text === 'none') return []
  const units = (text ?? '').split(',')
  const known = units.every((unit) => V3_UNITS.includes(unit))
  return known && new Set(units).size === units.length ? units : null
}

export function parseRuntimeFacts(stdout: string): RuntimeFacts | null {
  const values = parseKeyValues(stdout, RUNTIME_KEYS)
  if (values === null) return null
  const docker = oneOf(SERVICE_STATES, values.get('docker'))
  const bootloader = oneOf(CONTAINER_STATES, values.get('bootloader'))
  const runtimeContainer = oneOf(CONTAINER_STATES, values.get('runtime_container'))
  const native = oneOf(SERVICE_STATES, values.get('native'))
  const v3Units = parseV3Units(values.get('v3'))
  const complete =
    docker !== undefined &&
    bootloader !== undefined &&
    runtimeContainer !== undefined &&
    native !== undefined &&
    v3Units !== null
  return complete ? { docker, bootloader, runtimeContainer, native, v3Units } : null
}

function machineArch(machine: string, longBit: string): string {
  if (machine === 'x86_64' && longBit === '64') return 'amd64'
  if (machine === 'aarch64' && longBit === '64') return 'arm64'
  if (machine === 'aarch64' && longBit === '32') return 'armhf'
  if (machine === 'armv7l' || machine === 'armv8l' || machine === 'armv6l') return 'armhf'
  if (machine === 'i686' || machine === 'i386') return 'i386'
  return machine
}

export function userlandArch(facts: SystemFacts): string {
  return facts.dpkgArch !== '' ? facts.dpkgArch : machineArch(facts.machine, facts.longBit)
}

export function systemSupport(facts: SystemFacts): { ok: true } | { ok: false; reason: 'os' | 'init'; detail: string } {
  if (facts.os !== 'Linux') return { ok: false, reason: 'os', detail: displayText(facts.os) }
  if (!facts.systemd) return { ok: false, reason: 'init', detail: 'systemd not running' }
  return { ok: true }
}

export function archSupport(
  facts: SystemFacts,
): { ok: true; arch: 'amd64' | 'arm64' | 'armhf' } | { ok: false; detail: string } {
  const arch = userlandArch(facts)
  if (arch === 'amd64' || arch === 'arm64') return { ok: true, arch }
  if (arch === 'armhf' && ARMHF_MACHINES.includes(facts.machine)) return { ok: true, arch }
  return { ok: false, detail: displayText(arch === facts.machine ? arch : `${arch} (${facts.machine})`) }
}

function classifyContainerInstall(facts: RuntimeFacts): DeviceClass {
  if (facts.docker !== 'active') return { kind: 'start', target: 'docker-and-bootloader' }
  if (facts.bootloader === 'stopped') return { kind: 'start', target: 'bootloader' }
  if (facts.runtimeContainer === 'absent') return { kind: 'start', target: 'bootloader-restart' }
  if (facts.runtimeContainer !== 'running') return { kind: 'start', target: 'runtime-container' }
  return { kind: 'already-running' }
}

export function classifyRuntime(facts: RuntimeFacts): DeviceClass {
  if (facts.v3Units.length > 0) return { kind: 'v3-present' }
  if (facts.bootloader !== 'absent') return classifyContainerInstall(facts)
  if (facts.native === 'inactive') return { kind: 'start', target: 'native-service' }
  if (facts.native === 'active') return { kind: 'already-running' }
  return { kind: 'install' }
}
