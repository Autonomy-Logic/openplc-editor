import { provisioningMessage, type ProvisioningMessageKey, WHAT_WILL_BE_DONE } from '../runtime-provisioning-messages'

type Facts = Parameters<typeof provisioningMessage>[1]

const HOST = '192.168.1.50'
const NOTHING_CHANGED = /nothing[^.]*changed|no changes?\b|unchanged/i
const DOCKER_ABSENT = /docker[^.]*\bnot\b|no docker|without docker/i

const EVERY_FACT: Facts = {
  host: HOST,
  sshPort: 22,
  target: `${HOST}:22`,
  state: 'recovery',
  field: 'port',
  reason: 'os',
  detail: 'Windows_NT',
  dockerPresent: true,
  lastLines: ['E: Unable to locate package docker-ce'],
  operation: 'install',
}

const EVERY_KEY: ProvisioningMessageKey[] = [
  'no-device',
  'recovery',
  'bootloader-busy',
  'offer',
  'input-refused',
  'debugger-request-ended',
  'connected-ready',
  'not-started',
  'cancelled',
  'unknown',
  'busy',
  'invalid-input',
  'ssh-unreachable',
  'host-key-changed',
  'host-key-file-unusable',
  'host-key-not-saved',
  'auth-rejected',
  'password-auth-not-accepted',
  'no-admin-rights',
  'unsupported',
  'v3-present',
  'download-failed',
  'installer-failed',
]

const HOST_KEY_FILE_KEYS: ProvisioningMessageKey[] = ['host-key-changed', 'host-key-file-unusable']

const UNSUPPORTED_REASONS: [string, Facts, RegExp, string][] = [
  ['its operating system', { reason: 'os', detail: 'Windows_NT' }, /operating system/i, 'Windows_NT'],
  ['its init system', { reason: 'init', detail: 'openrc' }, /init/i, 'openrc'],
  ['its architecture', { reason: 'arch', detail: 'mips' }, /architecture/i, 'mips'],
]

function text(key: ProvisioningMessageKey, facts: Facts): string {
  const { title, body } = provisioningMessage(key, facts)
  return `${title}\n${body}`
}

describe('provisioningMessage', () => {
  it('takes no username or password among its facts (BR14, M14)', () => {
    const noCredentialFacts: Extract<keyof Facts, 'username' | 'password'> extends never ? true : false = true

    expect(noCredentialFacts).toBe(true)
  })

  it.each(EVERY_KEY)('gives the %s message a title and a body', (key) => {
    const { title, body } = provisioningMessage(key, EVERY_FACT)

    expect(title.trim()).not.toBe('')
    expect(body.trim()).not.toBe('')
  })

  it('names the address, says neither the runtime nor SSH answered, and offers another SSH port', () => {
    const message = text('no-device', { host: '192.0.2.10', sshPort: 22 })

    expect(message).toContain('192.0.2.10')
    expect(message).toMatch(/runtime/i)
    expect(message).toMatch(/SSH/)
    expect(message).toMatch(/answer|respond/i)
    expect(message).toMatch(/try another SSH port/i)
  })

  it('says a runtime in recovery is installed but failed to start, with the reported state', () => {
    const message = text('recovery', { host: HOST, state: 'crash-loop' })

    expect(message).toMatch(/installed/i)
    expect(message).toMatch(/failed to start/i)
    expect(message).toContain('crash-loop')
  })

  it('reports a busy bootloader with its state and asks to try again later', () => {
    const message = text('bootloader-busy', { host: HOST, state: 'updating' })

    expect(message).toContain('updating')
    expect(message).toMatch(/try again later/i)
  })

  it('names the target host and SSH port of the offer and says the runtime is not running', () => {
    const message = text('offer', { host: HOST, sshPort: 2222 })

    expect(message).toContain(HOST)
    expect(message).toContain('2222')
    expect(message).toMatch(/not running/i)
    expect(message).toMatch(/install/i)
    expect(message).toMatch(/start/i)
  })

  it('names the changed host key, says nothing was sent, and that clearing it is manual', () => {
    const message = text('host-key-changed', { target: `${HOST}:2222` })

    expect(message).toContain(`${HOST}:2222`)
    expect(message).toMatch(/changed/i)
    expect(message).toMatch(/(nothing|no\b)[^.]*\bsent\b|sent nothing/i)
    expect(message).toMatch(/manual|by hand/i)
  })

  it('says the host-key file could not be read or is invalid, and the operation stopped', () => {
    const message = text('host-key-file-unusable', {})

    expect(message).toMatch(/read|invalid/i)
    expect(message).toMatch(/stopped/i)
  })

  it.each(HOST_KEY_FILE_KEYS)(
    'names ssh-known-hosts.json in the user data folder that holds the logs folder, for %s (TC26)',
    (key) => {
      const { body } = provisioningMessage(key, { host: HOST, target: `${HOST}:22` })

      expect(body).toContain('ssh-known-hosts.json')
      expect(body).toMatch(/user data folder/i)
      expect(body).toMatch(/\blogs\b/)
    },
  )

  it.each(HOST_KEY_FILE_KEYS)('points to no repository path and no per-OS path for %s', (key) => {
    const { body } = provisioningMessage(key, { host: HOST, target: `${HOST}:22` })

    expect(body).not.toContain('docs/')
    expect(body).not.toMatch(/AppData|Application Support|\.config|~\/|[A-Z]:\\/)
  })

  it('says the device key could not be saved and the operation stopped before login', () => {
    const message = text('host-key-not-saved', {})

    expect(message).toMatch(/not[^.]*saved|could not save/i)
    expect(message).toMatch(/stopped/i)
    expect(message).toMatch(/before[^.]*log/i)
  })

  it.each<[Facts['field'], RegExp, string]>([
    ['port', /SSH port/i, '65535'],
    ['username', /username/i, '32'],
    ['password', /password/i, '1024'],
  ])('names a refused %s with its rule and says nothing was contacted', (field, name, limit) => {
    const message = text('input-refused', { field })

    expect(message).toMatch(name)
    expect(message).toContain(limit)
    expect(message).toMatch(/contact/i)
  })

  it('says a rejected login changed nothing', () => {
    const message = text('auth-rejected', { host: HOST })

    expect(message).toMatch(/reject/i)
    expect(message).toMatch(NOTHING_CHANGED)
  })

  it('says the device does not accept password login over SSH and nothing changed', () => {
    const message = text('password-auth-not-accepted', { host: HOST })

    expect(message).toMatch(/password/i)
    expect(message).toMatch(/SSH/)
    expect(message).toMatch(NOTHING_CHANGED)
  })

  it('says the account cannot run administrative commands and nothing changed', () => {
    const message = text('no-admin-rights', { host: HOST })

    expect(message).toMatch(/administrat/i)
    expect(message).toMatch(NOTHING_CHANGED)
  })

  it.each(UNSUPPORTED_REASONS)('explains a device unsupported for %s', (_name, facts, reason, detail) => {
    const message = text('unsupported', facts)

    expect(message).toMatch(reason)
    expect(message).toContain(detail)
    expect(message).toMatch(NOTHING_CHANGED)
  })

  it('says a v3 runtime is present and the editor will not install or start there', () => {
    const message = text('v3-present', { host: HOST })

    expect(message).toMatch(/v3/i)
    expect(message).toMatch(/(will not|won't|does not|cannot|can't)[^.]*install/i)
    expect(message).toMatch(NOTHING_CHANGED)
  })

  it('says the download failed and whether Docker is present on the device', () => {
    const present = text('download-failed', { dockerPresent: true })
    const absent = text('download-failed', { dockerPresent: false })

    expect(present).toMatch(/download/i)
    expect(present).toMatch(/docker/i)
    expect(absent).toMatch(/docker/i)
    expect(present).not.toMatch(DOCKER_ABSENT)
    expect(absent).toMatch(DOCKER_ABSENT)
  })

  it('says the installer failed and shows its last lines', () => {
    const message = text('installer-failed', {
      lastLines: [
        'dpkg: error processing package docker-ce',
        'E: Sub-process /usr/bin/dpkg returned an error code (1)',
      ],
    })

    expect(message).toMatch(/installer/i)
    expect(message).toMatch(/fail/i)
    expect(message).toContain('dpkg: error processing package docker-ce')
    expect(message).toContain('E: Sub-process /usr/bin/dpkg returned an error code (1)')
  })

  it('says an installed runtime did not answer within 120 s, with the last lines of an install', () => {
    const message = text('not-started', {
      operation: 'install',
      lastLines: ['openplc-runtime: waiting for the database'],
    })

    expect(message).toContain('120')
    expect(message).toMatch(/answer|respond/i)
    expect(message).toContain('openplc-runtime: waiting for the database')
  })

  it('says a started runtime did not answer within 120 s', () => {
    expect(text('not-started', { operation: 'start', lastLines: [] })).toContain('120')
  })

  it('says the result is unknown and asks to Connect again', () => {
    const message = text('unknown', { host: HOST })

    expect(message).toMatch(/unknown|lost/i)
    expect(message).toMatch(/connect again/i)
  })

  it('keeps the debugger title and says the debugger was not started because the editor is not connected', () => {
    const { title, body } = provisioningMessage('debugger-request-ended', { host: HOST })

    expect(title).toBe('Debugger not started')
    expect(body).toMatch(/debugger/i)
    expect(body).toMatch(/(not|n't) connected/i)
    expect(body).toMatch(/dialog/i)
    expect(body).toMatch(/connect/i)
  })

  it('does not say or imply that an install or start is running when the debugger request ends (TC15)', () => {
    const { body } = provisioningMessage('debugger-request-ended', { host: HOST })

    expect(body).not.toMatch(/being (installed|started)|installing|starting/i)
  })

  it('says the device SSH did not answer and nothing changed', () => {
    const message = text('ssh-unreachable', { host: HOST, sshPort: 22 })

    expect(message).toMatch(/SSH/)
    expect(message).toMatch(/answer|respond|reach/i)
    expect(message).toMatch(NOTHING_CHANGED)
  })

  it('says a cancelled operation installed and started nothing', () => {
    const message = text('cancelled', { host: HOST })

    expect(message).toMatch(/cancel/i)
    expect(message).toMatch(/nothing[^.]*(installed|started)|not (been )?(installed|started)/i)
  })

  it('says an operation is already running', () => {
    expect(text('busy', { host: HOST })).toMatch(/already[^.]*(running|in progress)/i)
  })
})

describe('WHAT_WILL_BE_DONE', () => {
  function installStep(...facts: (string | RegExp)[]): string | undefined {
    return WHAT_WILL_BE_DONE.install.find((step) =>
      facts.every((fact) => (typeof fact === 'string' ? step.includes(fact) : fact.test(step))),
    )
  }

  it('says a stopped runtime that is already installed is started', () => {
    expect(WHAT_WILL_BE_DONE.ifInstalled).toMatch(/stopped/i)
    expect(WHAT_WILL_BE_DONE.ifInstalled).toMatch(/start/i)
  })

  it('lists the five install steps', () => {
    expect(WHAT_WILL_BE_DONE.install).toHaveLength(5)
  })

  it.each<[string, (string | RegExp)[]]>([
    ['the script download run as administrator', ['runtime.getedge.me', /administrator/i]],
    ['Docker installed when missing and enabled at boot', [/docker/i, /boot/i]],
    ['the runtime images downloaded', [/image/i]],
    ['any older OpenPLC service stopped and disabled', [/older/i, /stopped/i, /disabled/i]],
    ['the ports the device then listens on', ['8443', '8445', '33333', /TCP/, /UDP/]],
  ])('includes %s', (_step, facts) => {
    expect(installStep(...facts)).toBeDefined()
  })
})
