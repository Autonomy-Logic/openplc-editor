import type {
  RunRequestField,
  RuntimeProvisioningOperation,
  RuntimeProvisioningOutcome,
} from '../../middleware/shared/ports/runtime-provisioning-port'

export type ProvisioningMessageKey =
  | 'no-device'
  | 'recovery'
  | 'bootloader-busy'
  | 'offer'
  | 'input-refused'
  | 'debugger-request-ended'
  | RuntimeProvisioningOutcome['kind']

export interface ProvisioningMessageFacts {
  host?: string
  sshPort?: number
  target?: string
  state?: string
  field?: RunRequestField | 'payload'
  reason?: 'os' | 'init' | 'arch'
  detail?: string
  dockerPresent?: boolean
  lastLines?: readonly string[]
  operation?: RuntimeProvisioningOperation | 'none'
}

export interface ProvisioningMessage {
  title: string
  body: string
}

export const WHAT_WILL_BE_DONE: { ifInstalled: string; install: readonly string[] } = {
  ifInstalled: 'If an OpenPLC Runtime is already installed but stopped, what is stopped is started.',
  install: [
    'A script is downloaded from runtime.getedge.me and run as administrator.',
    'Docker is installed when missing and enabled at boot.',
    'The OpenPLC Runtime images are downloaded.',
    'Any older OpenPLC service is stopped and disabled.',
    'The device then listens on TCP 8443, TCP 8445 and UDP 33333.',
  ],
}

const NOTHING_CHANGED = 'Nothing was changed on the device.'

const HOST_KEY_FILE_LOCATION =
  "ssh-known-hosts.json in the editor's user data folder, the folder that also holds the editor's logs folder"

const FIELD_RULES: Record<RunRequestField | 'payload', string> = {
  host: 'The device address was refused: it must be an IP address or a host name of at most 253 characters.',
  port: 'The SSH port was refused: it must be a whole number from 1 to 65535.',
  username: 'The username was refused: it must have 1 to 32 characters, with no control characters.',
  password: 'The password was refused: it must have 1 to 1024 characters, with no control characters.',
  payload: 'The request was refused because it was malformed.',
}

const UNSUPPORTED_PARTS: Record<'os' | 'init' | 'arch', string> = {
  os: 'operating system',
  init: 'init system',
  arch: 'architecture',
}

const NOT_STARTED_ACTIONS: Record<RuntimeProvisioningOperation | 'none', string> = {
  install: 'was installed',
  start: 'was started',
  none: 'was found',
}

function deviceName(facts: ProvisioningMessageFacts): string {
  return facts.host ?? 'the device'
}

function sshPortName(facts: ProvisioningMessageFacts): string {
  return facts.sshPort === undefined ? 'its SSH port' : `port ${facts.sshPort}`
}

function withLastLines(text: string, lastLines: readonly string[] | undefined): string {
  if (lastLines === undefined || lastLines.length === 0) return text
  return `${text}\n\nLast lines:\n${lastLines.join('\n')}`
}

function refusedInput(facts: ProvisioningMessageFacts): ProvisioningMessage {
  const rule = FIELD_RULES[facts.field ?? 'payload']
  return { title: 'Value refused', body: `${rule} The device was not contacted.` }
}

function unsupported(facts: ProvisioningMessageFacts): ProvisioningMessage {
  const part = facts.reason === undefined ? 'system' : UNSUPPORTED_PARTS[facts.reason]
  const detail = facts.detail === undefined || facts.detail === '' ? '' : ` (${facts.detail})`
  return {
    title: 'Unsupported device',
    body: `The OpenPLC Runtime cannot run on ${deviceName(facts)}: its ${part}${detail} is not supported. ${NOTHING_CHANGED}`,
  }
}

function downloadFailed(facts: ProvisioningMessageFacts): ProvisioningMessage {
  const docker =
    facts.dockerPresent === undefined
      ? 'Whether Docker is installed on the device is not known.'
      : facts.dockerPresent
        ? 'Docker is installed on the device.'
        : 'Docker is not installed on the device.'
  return {
    title: 'No internet access',
    body: `The device could not download the OpenPLC Runtime. ${docker} Check that the device can reach the internet.`,
  }
}

function notStarted(facts: ProvisioningMessageFacts): ProvisioningMessage {
  const action = NOT_STARTED_ACTIONS[facts.operation ?? 'none']
  return {
    title: 'Runtime not started',
    body: withLastLines(
      `The OpenPLC Runtime ${action} on ${deviceName(facts)}, but it did not answer within 120 s.`,
      facts.lastLines,
    ),
  }
}

function connectedReady(facts: ProvisioningMessageFacts): ProvisioningMessage {
  const action =
    facts.operation === 'none' || facts.operation === undefined ? 'is running' : NOT_STARTED_ACTIONS[facts.operation]
  return {
    title: 'Runtime ready',
    body: `The OpenPLC Runtime ${action} on ${deviceName(facts)} and answers. The editor is connecting to it.`,
  }
}

type DeviceMessageKey = 'no-device' | 'recovery' | 'bootloader-busy' | 'offer' | 'debugger-request-ended'

function deviceMessage(key: DeviceMessageKey, facts: ProvisioningMessageFacts): ProvisioningMessage {
  const host = deviceName(facts)
  switch (key) {
    case 'no-device':
      return {
        title: 'No recognized device',
        body: `No recognized device was found at ${host}. Neither the OpenPLC Runtime nor SSH on ${sshPortName(facts)} answered. Check the address, or choose "Try another SSH port" if the device's SSH server listens on another port.`,
      }
    case 'recovery':
      return {
        title: 'Runtime failed to start',
        body: `The OpenPLC Runtime is installed on ${host} but failed to start. Bootloader state: ${facts.state ?? 'unknown'}.`,
      }
    case 'bootloader-busy':
      return {
        title: 'Bootloader busy',
        body: `The bootloader on ${host} reports the state "${facts.state ?? 'unknown'}". Try again later.`,
      }
    case 'offer':
      return {
        title: 'Install or start the OpenPLC Runtime',
        body: `The OpenPLC Runtime is not running on ${host}, and an SSH server answered on ${sshPortName(facts)}. With your permission, the editor logs in over SSH with an operating-system account of the device and installs or starts the runtime.`,
      }
    case 'debugger-request-ended':
      return {
        title: 'Debugger not started',
        body: `The debugger was not started because the editor is not connected to the OpenPLC Runtime on ${host}. The dialog shown explains what to do. Start the debugger again once the editor is connected.`,
      }
  }
}

function outcomeMessage(key: RuntimeProvisioningOutcome['kind'], facts: ProvisioningMessageFacts): ProvisioningMessage {
  const host = deviceName(facts)
  switch (key) {
    case 'connected-ready':
      return connectedReady(facts)
    case 'not-started':
      return notStarted(facts)
    case 'cancelled':
      return {
        title: 'Operation cancelled',
        body: `The operation was cancelled. Nothing was installed or started on ${host}.`,
      }
    case 'unknown':
      return {
        title: 'Result unknown',
        body: `The editor lost track of the operation on ${host}, so its result is unknown. Connect again to check the device.`,
      }
    case 'busy':
      return {
        title: 'Operation in progress',
        body: 'An install or start operation is already running. Wait for it to end.',
      }
    case 'invalid-input':
      return refusedInput(facts)
    case 'ssh-unreachable':
      return { title: 'SSH not reachable', body: `The SSH server of ${host} did not answer. ${NOTHING_CHANGED}` }
    case 'host-key-changed':
      return {
        title: 'Host key changed',
        body: `The SSH host key of ${facts.target ?? host} changed since the editor saved it. Nothing was sent to the device. Clearing the saved key is manual: remove its entry from ${HOST_KEY_FILE_LOCATION}.`,
      }
    case 'host-key-file-unusable':
      return {
        title: 'Host key file unusable',
        body: `The file of saved SSH host keys, ${HOST_KEY_FILE_LOCATION}, could not be read or is invalid. The operation stopped.`,
      }
    case 'host-key-not-saved':
      return {
        title: 'Host key not saved',
        body: 'The SSH host key of the device could not be saved. The operation stopped before logging in.',
      }
    case 'auth-rejected':
      return { title: 'Login rejected', body: `The device rejected the login. ${NOTHING_CHANGED}` }
    case 'password-auth-not-accepted':
      return {
        title: 'Password login not accepted',
        body: `The device does not accept password login over SSH. ${NOTHING_CHANGED}`,
      }
    case 'no-admin-rights':
      return {
        title: 'No administrative rights',
        body: `The account cannot run administrative commands on the device. ${NOTHING_CHANGED}`,
      }
    case 'unsupported':
      return unsupported(facts)
    case 'v3-present':
      return {
        title: 'OpenPLC Runtime v3 present',
        body: `An OpenPLC Runtime v3 is installed on ${host}. The editor will not install or start the runtime there. ${NOTHING_CHANGED}`,
      }
    case 'download-failed':
      return downloadFailed(facts)
    case 'installer-failed':
      return {
        title: 'Installer failed',
        body: withLastLines(`The installer failed on ${host}.`, facts.lastLines),
      }
  }
}

export function provisioningMessage(key: ProvisioningMessageKey, facts: ProvisioningMessageFacts): ProvisioningMessage {
  switch (key) {
    case 'input-refused':
      return refusedInput(facts)
    case 'no-device':
    case 'recovery':
    case 'bootloader-busy':
    case 'offer':
    case 'debugger-request-ended':
      return deviceMessage(key, facts)
    default:
      return outcomeMessage(key, facts)
  }
}
