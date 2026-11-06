import type { Account, DeviceCommand } from '../commands'
import {
  buildExec,
  INSTALLER_CONNECT_TIMEOUT_S,
  INSTALLER_DOWNLOAD_MAX_S,
  pollInstallerCommand,
  PROVISIONING_COMMANDS,
  startInstallerCommand,
} from '../commands'
import { DOCKER_CONTAINER_RECORDS, INSTALLER_URL, V3_UNITS } from '../runtime-names'

const LOG_DIR = '/tmp/tmp.Xy7Qa9Zk2B'
const HOSTILE_USERNAME = 'pi; rm -rf /'
const HOSTILE_PASSWORD = 'x$(reboot)`id`\'"'
const SUDO_PREFIX = "/usr/bin/sudo -S -k -p '' sh -c "
const STDIN_FROM_DEV_NULL = 'exec </dev/null; '
const INJECTION_DIR = "/tmp/x'; touch /tmp/PWNED; '"
const UNSAFE_DIRS: [string, string][] = [
  ['a directory that closes the quote and runs a command', INJECTION_DIR],
  ['a relative directory', 'relative/dir'],
  ['a directory with a parent segment', '/tmp/../etc'],
  ['an empty directory', ''],
]
const INVALID_OFFSETS: [string, number][] = [
  ['NaN', Number.NaN],
  ['-1', -1],
  ['1.5', 1.5],
  ['one past the largest safe integer', Number.MAX_SAFE_INTEGER + 1],
]
const INVALID_MAX_BYTES: [string, number][] = [
  ['0', 0],
  ['-1', -1],
  ['1.5', 1.5],
  ['NaN', Number.NaN],
]
const SHELL_SPECIALS = new Set([';', '&', '|', '<', '>', '(', ')', '$', '`', '*', '?', '[', '#', '~', '\n'])

const fixedCommands: [string, DeviceCommand][] = Object.entries(PROVISIONING_COMMANDS)
const allCommands: [string, DeviceCommand][] = [
  ...fixedCommands,
  ['startInstallerCommand', startInstallerCommand(LOG_DIR)],
  ['pollInstallerCommand', pollInstallerCommand(LOG_DIR, 1234, 65536)],
]

function readSingleQuoted(text: string, start: number): { value: string; next: number } {
  const end = text.indexOf("'", start)
  if (end < 0) throw new Error('unterminated single quote')
  return { value: text.slice(start, end), next: end + 1 }
}

function readDoubleQuoted(text: string, start: number): { value: string; next: number } {
  let value = ''
  let index = start
  while (index < text.length) {
    const character = text[index]
    if (character === '"') return { value, next: index + 1 }
    if (character === '$' || character === '`') throw new Error('expansion inside double quotes')
    if (character === '\\' && '$`"\\\n'.includes(text[index + 1] ?? '')) {
      value += text[index + 1]
      index += 2
    } else {
      value += character
      index += 1
    }
  }
  throw new Error('unterminated double quote')
}

function shellWords(text: string): string[] {
  const words: string[] = []
  let word: string | null = null
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === ' ' || character === '\t') {
      if (word !== null) words.push(word)
      word = null
      index += 1
    } else if (character === "'") {
      const read = readSingleQuoted(text, index + 1)
      word = (word ?? '') + read.value
      index = read.next
    } else if (character === '"') {
      const read = readDoubleQuoted(text, index + 1)
      word = (word ?? '') + read.value
      index = read.next
    } else if (character === '\\') {
      word = (word ?? '') + (text[index + 1] ?? '')
      index += 2
    } else if (SHELL_SPECIALS.has(character)) {
      throw new Error(`unquoted shell character ${character}`)
    } else {
      word = (word ?? '') + character
      index += 1
    }
  }
  if (word !== null) words.push(word)
  return words
}

function hasOption(command: string, option: string): boolean {
  return command.split(/\s+/).includes(option)
}

const FORBIDDEN_IN_START = [
  'restart',
  'docker pull',
  'docker create',
  'docker run',
  'docker rm',
  'docker compose',
  'docker-compose',
  'rm -',
  'curl',
  'install.sh',
]

describe('PROVISIONING_COMMANDS', () => {
  it('holds exactly the fixed command set', () => {
    expect(Object.keys(PROVISIONING_COMMANDS).sort()).toEqual(
      [
        'probeSystem',
        'privilegeCheck',
        'inspectRuntime',
        'startDockerAndBootloader',
        'startBootloader',
        'startRuntimeContainer',
        'startNativeService',
        'prepareInstaller',
        'dockerPresent',
      ].sort(),
    )
  })

  it('runs only the system probe without elevation', () => {
    const elevation = Object.fromEntries(fixedCommands.map(([name, command]) => [name, command.elevated]))

    expect(elevation).toEqual({
      probeSystem: false,
      privilegeCheck: true,
      inspectRuntime: true,
      startDockerAndBootloader: true,
      startBootloader: true,
      startRuntimeContainer: true,
      startNativeService: true,
      prepareInstaller: true,
      dockerPresent: true,
    })
  })

  it('probes the system with uname, the systemd directory, dpkg, getconf and id, printing each key', () => {
    const { command } = PROVISIONING_COMMANDS.probeSystem
    for (const fragment of [
      'uname -s',
      '/run/systemd/system',
      'dpkg --print-architecture',
      'uname -m',
      'getconf LONG_BIT',
      'id -u',
      'os=',
      'systemd=',
      'dpkg_arch=',
      'machine=',
      'long_bit=',
      'uid=',
    ]) {
      expect(command).toContain(fragment)
    }
  })

  it('checks privileges by running /bin/true only', () => {
    expect(PROVISIONING_COMMANDS.privilegeCheck.command).toBe('/bin/true')
  })

  it('inspects Docker, both containers, the native unit and every v3 unit, falling back to Docker records', () => {
    const { command } = PROVISIONING_COMMANDS.inspectRuntime
    for (const fragment of [
      'docker=',
      'bootloader=',
      'runtime_container=',
      'native=',
      'v3=',
      'none',
      'openplc-bootloader',
      'openplc-runtime',
      'openplc-runtime.service',
      DOCKER_CONTAINER_RECORDS,
      'config.v2.json',
      ...V3_UNITS,
    ]) {
      expect(command).toContain(fragment)
    }
  })

  it.each([
    ['probeSystem', PROVISIONING_COMMANDS.probeSystem],
    ['inspectRuntime', PROVISIONING_COMMANDS.inspectRuntime],
    ['dockerPresent', PROVISIONING_COMMANDS.dockerPresent],
  ])('keeps %s read-only', (_, { command }) => {
    for (const fragment of ['systemctl start', 'docker start', ...FORBIDDEN_IN_START]) {
      expect(command).not.toContain(fragment)
    }
  })

  it('reports whether Docker is present', () => {
    const { command } = PROVISIONING_COMMANDS.dockerPresent
    expect(command).toContain('docker=yes')
    expect(command).toContain('docker=no')
  })

  it('starts the Docker service, then the bootloader container', () => {
    const { command } = PROVISIONING_COMMANDS.startDockerAndBootloader
    const dockerService = command.indexOf('systemctl start docker')
    const bootloader = command.indexOf('docker start openplc-bootloader')

    expect(dockerService).toBeGreaterThanOrEqual(0)
    expect(bootloader).toBeGreaterThan(dockerService)
    expect(command).not.toContain('docker start openplc-runtime')
  })

  it('starts only the bootloader container', () => {
    const { command } = PROVISIONING_COMMANDS.startBootloader
    expect(command).toContain('docker start openplc-bootloader')
    expect(command).not.toContain('systemctl')
    expect(command).not.toContain('docker start openplc-runtime')
  })

  it('starts only the runtime container, never the bootloader', () => {
    const { command } = PROVISIONING_COMMANDS.startRuntimeContainer
    expect(command).toContain('docker start openplc-runtime')
    expect(command).not.toContain('openplc-bootloader')
    expect(command).not.toContain('systemctl')
  })

  it('starts only the native v4 service', () => {
    const { command } = PROVISIONING_COMMANDS.startNativeService
    expect(command).toContain('systemctl start openplc-runtime.service')
    expect(command).not.toContain('docker')
  })

  it.each([
    ['startDockerAndBootloader', PROVISIONING_COMMANDS.startDockerAndBootloader],
    ['startBootloader', PROVISIONING_COMMANDS.startBootloader],
    ['startRuntimeContainer', PROVISIONING_COMMANDS.startRuntimeContainer],
    ['startNativeService', PROVISIONING_COMMANDS.startNativeService],
  ])('%s never restarts, pulls, creates, removes or installs anything', (_, { command }) => {
    for (const fragment of FORBIDDEN_IN_START) {
      expect(command).not.toContain(fragment)
    }
  })
})

describe('prepareInstaller', () => {
  const { command } = PROVISIONING_COMMANDS.prepareInstaller

  it('creates a fresh private directory with mktemp -d and names no fixed temporary path', () => {
    expect(command).toContain('mktemp -d')
    expect(command).not.toContain('/tmp')
  })

  it('downloads with HTTPS restricted for the request and every redirect, within 20 s to connect and 120 s in all (F23)', () => {
    expect(command).toContain(
      `if curl --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 120 -fsSL ${INSTALLER_URL} -o "$d/install.sh"; then echo download=ok; else echo download=failed; fi`,
    )
  })

  it('pins the installer download limits at 20 s to connect and 120 s in all (F23)', () => {
    expect(INSTALLER_CONNECT_TIMEOUT_S).toBe(20)
    expect(INSTALLER_DOWNLOAD_MAX_S).toBe(120)
  })

  it('passes both download limits to curl before the installer URL', () => {
    const url = command.indexOf(INSTALLER_URL)

    expect(command.indexOf(`--connect-timeout ${INSTALLER_CONNECT_TIMEOUT_S} `)).toBeGreaterThan(-1)
    expect(command.indexOf(`--connect-timeout ${INSTALLER_CONNECT_TIMEOUT_S} `)).toBeLessThan(url)
    expect(command.indexOf(`--max-time ${INSTALLER_DOWNLOAD_MAX_S} `)).toBeGreaterThan(-1)
    expect(command.indexOf(`--max-time ${INSTALLER_DOWNLOAD_MAX_S} `)).toBeLessThan(url)
  })

  it('names no URL other than the installer URL', () => {
    const urls = command.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"]*/g) ?? []

    expect(urls.length).toBeGreaterThan(0)
    expect(new Set(urls)).toEqual(new Set(['https://runtime.getedge.me']))
    expect(command).not.toContain('raw.githubusercontent.com')
  })

  it('keeps certificate verification on', () => {
    expect(command).not.toContain('--insecure')
    expect(command.split(/\s+/).some((word) => /^-[A-Za-z]*k[A-Za-z]*$/.test(word))).toBe(false)
  })

  it('reports the directory and the download result', () => {
    for (const fragment of ['dir=', 'download=ok', 'download=failed']) {
      expect(command).toContain(fragment)
    }
  })
})

describe('startInstallerCommand', () => {
  const started = startInstallerCommand(LOG_DIR)

  it('runs the downloaded installer as administrator, with no argument', () => {
    expect(started.elevated).toBe(true)
    expect(started.command).toMatch(/bash\s+['"]?\/tmp\/tmp\.Xy7Qa9Zk2B\/install\.sh['"]?\s*(?:[<>&;|)'"]|2>|$)/)
  })

  it('detaches the installer so the command returns at once', () => {
    expect(started.command).toMatch(/\b(?:setsid|nohup)\b/)
  })

  it('writes the installer output and exit status into the private directory', () => {
    expect(started.command).toContain(`${LOG_DIR}/install.log`)
    expect(started.command).toContain(`${LOG_DIR}/exit`)
  })

  it('downloads nothing', () => {
    expect(started.command).not.toContain('curl')
    expect(started.command).not.toContain('://')
  })

  it.each(UNSAFE_DIRS)('refuses %s', (_, dir) => {
    expect(() => startInstallerCommand(dir)).toThrow(Error)
  })
})

describe('pollInstallerCommand', () => {
  const polled = pollInstallerCommand(LOG_DIR, 1234, 65536)

  it('reads as administrator from the private directory', () => {
    expect(polled.elevated).toBe(true)
    expect(polled.command).toContain(`${LOG_DIR}/install.log`)
    expect(polled.command).toContain(`${LOG_DIR}/exit`)
  })

  it('prints the exit state, the size, the offset read and a separator', () => {
    for (const fragment of ['exit=', 'running', 'size=', 'from=', '---']) {
      expect(polled.command).toContain(fragment)
    }
  })

  it('places the requested offset and byte count in the command', () => {
    expect(polled.command).toContain('1234')
    expect(polled.command).toContain('65536')
    expect(pollInstallerCommand(LOG_DIR, 0, 4096).command).not.toBe(polled.command)
  })

  it('removes nothing', () => {
    expect(polled.command).not.toContain('rm ')
  })

  it.each(UNSAFE_DIRS)('refuses %s', (_, dir) => {
    expect(() => pollInstallerCommand(dir, 0, 65536)).toThrow(Error)
  })

  it.each(INVALID_OFFSETS)('refuses the offset %s', (_, offset) => {
    expect(() => pollInstallerCommand(LOG_DIR, offset, 65536)).toThrow(Error)
  })

  it.each(INVALID_MAX_BYTES)('refuses the byte count %s', (_, maxBytes) => {
    expect(() => pollInstallerCommand(LOG_DIR, 0, maxBytes)).toThrow(Error)
  })

  it('accepts offset 0, the largest safe offset and a byte count of 1', () => {
    expect(() => pollInstallerCommand(LOG_DIR, 0, 1)).not.toThrow()
    expect(() => pollInstallerCommand(LOG_DIR, Number.MAX_SAFE_INTEGER, 65536)).not.toThrow()
  })
})

describe('buildExec', () => {
  it.each(allCommands)('runs %s for root with stdin from /dev/null, without sending the password', (_, command) => {
    expect(buildExec(command, 'root')).toEqual({
      command: `${STDIN_FROM_DEV_NULL}${command.command}`,
      sendsPassword: false,
    })
  })

  it('runs a command that needs no elevation for a sudo account with stdin from /dev/null', () => {
    const probe = PROVISIONING_COMMANDS.probeSystem

    expect(buildExec(probe, 'sudo')).toEqual({
      command: `${STDIN_FROM_DEV_NULL}${probe.command}`,
      sendsPassword: false,
    })
  })

  const elevatedCommands = allCommands.filter(([, command]) => command.elevated)

  it.each(elevatedCommands)('wraps %s in sudo by absolute path, reading the password from stdin', (_, command) => {
    const exec = buildExec(command, 'sudo')

    expect(exec.sendsPassword).toBe(true)
    expect(exec.command.startsWith(SUDO_PREFIX)).toBe(true)
  })

  it.each(elevatedCommands)(
    'quotes %s so the shell receives it whole, with stdin from /dev/null for the whole command',
    (_, command) => {
      expect(shellWords(buildExec(command, 'sudo').command)).toEqual([
        '/usr/bin/sudo',
        '-S',
        '-k',
        '-p',
        '',
        'sh',
        '-c',
        `${STDIN_FROM_DEV_NULL}${command.command}`,
      ])
    },
  )

  it.each(allCommands)('no longer redirects only the last simple command of %s from /dev/null', (_, command) => {
    for (const account of ['root', 'sudo'] satisfies Account[]) {
      expect(buildExec(command, account).command.endsWith(" </dev/null'")).toBe(false)
    }
  })

  it.each(allCommands)('never preserves the environment through sudo for %s', (_, command) => {
    expect(hasOption(buildExec(command, 'sudo').command, '-E')).toBe(false)
    expect(hasOption(buildExec(command, 'root').command, '-E')).toBe(false)
  })

  it.each(allCommands)('never places a username or password in the %s command line', (_, command) => {
    for (const account of ['root', 'sudo'] as const) {
      const line = buildExec(command, account).command
      expect(line).not.toContain(HOSTILE_USERNAME)
      expect(line).not.toContain(HOSTILE_PASSWORD)
      expect(line).not.toContain('commissioner42')
      expect(line).not.toContain('S3cr3t-Pi!')
    }
  })
})
