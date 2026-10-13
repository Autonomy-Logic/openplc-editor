import { type ChangeEvent, useState } from 'react'

import type {
  MqttCredentialBinding,
  MqttCredentialPersistence,
  MqttCredentialSecret,
  MqttCredentialWriteResult,
} from '../../../../../../../middleware/shared/ports/mqtt-credential-port'
import type { MqttSecretAuthMethod } from '../../../../../../utils/mqtt/contract/contract'
import { MQTT_CREDENTIAL_LIMITS, validateMqttCredentialSecret } from '../../../../../../utils/mqtt/credentials/validate'
import type { MqttCredentialState } from '../../../../../../utils/mqtt/ui/credential-state'
import { buttonClass, hintClass, inputClass, labelClass, primaryButtonClass, textareaClass } from './fields'

interface CredentialPanelProps {
  method: MqttSecretAuthMethod
  binding: MqttCredentialBinding
  state: MqttCredentialState
  persistence: MqttCredentialPersistence
  onSave: (secret: MqttCredentialSecret, binding: MqttCredentialBinding) => Promise<MqttCredentialWriteResult>
  onRemove: () => Promise<void>
}

interface Drafts {
  username: string
  password: string
  certificatePem: string
  privateKeyPem: string
  privateKeyPassphrase: string
}

const EMPTY_DRAFTS: Drafts = {
  username: '',
  password: '',
  certificatePem: '',
  privateKeyPem: '',
  privateKeyPassphrase: '',
}

const describeState = (state: MqttCredentialState, method: MqttSecretAuthMethod): string => {
  const what = method === 'username_password' ? 'username and password' : 'client certificate and private key'
  switch (state.kind) {
    case 'local':
      return `A ${what} is saved for this target. Saved values are never shown again.`
    case 'runtime':
      return `The runtime already holds a ${what} for this broker (revision ${state.active.revision}, updated ${state.active.updatedAt} by ${state.active.updatedBy}).`
    case 'binding_mismatch':
      return `The saved ${what} belongs to a different broker, client ID or method and will not be used.`
    case 'no_target':
      return 'Select the target runtime in the device configuration before entering a credential.'
    case 'loading':
      return 'Checking the saved credential...'
    default:
      return `No ${what} is saved for this target.`
  }
}

const persistenceText = (persistence: MqttCredentialPersistence): string => {
  switch (persistence) {
    case 'protected':
      return 'Stored encrypted on this computer, outside the project.'
    case 'transient':
      return 'Kept only in this page, unencrypted, until the next upload sends it to the runtime; then it is discarded here. Signing out, switching project or leaving the page also discards it.'
    default:
      return 'Kept only in memory for this session. Enter it again after closing the editor.'
  }
}

export const CredentialPanel = ({ method, binding, state, persistence, onSave, onRemove }: CredentialPanelProps) => {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Drafts>(EMPTY_DRAFTS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canEdit = state.kind !== 'no_target' && state.kind !== 'loading'
  const hasLocal = state.kind === 'local' || state.kind === 'binding_mismatch'
  const hasAny = hasLocal || state.kind === 'runtime'

  const set = (field: keyof Drafts) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value } = event.target
    setDrafts((current) => ({ ...current, [field]: value }))
  }

  const loadFile =
    (field: 'certificatePem' | 'privateKeyPem', max: number) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      if (file.size > max) {
        setError(`The file is larger than ${max} bytes.`)
        return
      }
      file
        .text()
        .then((text) => setDrafts((current) => ({ ...current, [field]: text })))
        .catch(() => setError('The file could not be read.'))
    }

  const close = () => {
    setDrafts(EMPTY_DRAFTS)
    setError(null)
    setEditing(false)
  }

  const save = async () => {
    const secret: MqttCredentialSecret =
      method === 'username_password'
        ? { method, username: drafts.username, password: drafts.password }
        : {
            method,
            certificatePem: drafts.certificatePem,
            privateKeyPem: drafts.privateKeyPem,
            ...(drafts.privateKeyPassphrase !== '' ? { privateKeyPassphrase: drafts.privateKeyPassphrase } : {}),
          }
    const [invalid] = validateMqttCredentialSecret(secret, binding)
    if (invalid) {
      setError(invalid.message)
      return
    }
    setBusy(true)
    try {
      const result = await onSave(secret, binding)
      if (result.ok) close()
      else setError(result.message)
    } catch {
      setError('The credential could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await onRemove()
      close()
    } catch {
      setError('The credential could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label='Broker credential'
      className='flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700'
    >
      <h4 className={labelClass}>Broker credential</h4>
      <p className={hintClass} data-testid='mqtt-credential-state' data-state={state.kind}>
        {describeState(state, method)}
      </p>
      <p className={hintClass}>{persistenceText(persistence)}</p>
      {!editing && (
        <div className='flex gap-2'>
          <button type='button' className={buttonClass} disabled={!canEdit || busy} onClick={() => setEditing(true)}>
            {hasAny ? 'Replace credential' : 'Enter credential'}
          </button>
          {hasLocal && (
            <button type='button' className={buttonClass} disabled={busy} onClick={() => void remove()}>
              Remove credential
            </button>
          )}
        </div>
      )}
      {editing && (
        <form
          className='flex flex-col gap-2'
          autoComplete='off'
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {method === 'username_password' ? (
            <>
              <label htmlFor='mqtt-credential-username' className={labelClass}>
                Username
              </label>
              <input
                id='mqtt-credential-username'
                type='text'
                autoComplete='off'
                spellCheck={false}
                className={inputClass}
                value={drafts.username}
                onChange={set('username')}
              />
              <label htmlFor='mqtt-credential-password' className={labelClass}>
                Password
              </label>
              <input
                id='mqtt-credential-password'
                type='password'
                autoComplete='new-password'
                className={inputClass}
                value={drafts.password}
                onChange={set('password')}
              />
            </>
          ) : (
            <>
              <label htmlFor='mqtt-credential-certificate' className={labelClass}>
                Client certificate (PEM)
              </label>
              <textarea
                id='mqtt-credential-certificate'
                rows={5}
                spellCheck={false}
                className={textareaClass}
                value={drafts.certificatePem}
                onChange={set('certificatePem')}
              />
              <input
                type='file'
                aria-label='Load client certificate file'
                accept='.pem,.crt,.cer'
                className={hintClass}
                onChange={loadFile('certificatePem', MQTT_CREDENTIAL_LIMITS.maxCertificateBytes)}
              />
              <label htmlFor='mqtt-credential-key' className={labelClass}>
                Private key (PEM)
              </label>
              <textarea
                id='mqtt-credential-key'
                rows={5}
                spellCheck={false}
                className={textareaClass}
                value={drafts.privateKeyPem}
                onChange={set('privateKeyPem')}
              />
              <input
                type='file'
                aria-label='Load private key file'
                accept='.pem,.key'
                className={hintClass}
                onChange={loadFile('privateKeyPem', MQTT_CREDENTIAL_LIMITS.maxPrivateKeyBytes)}
              />
              <label htmlFor='mqtt-credential-passphrase' className={labelClass}>
                Key passphrase (optional)
              </label>
              <input
                id='mqtt-credential-passphrase'
                type='password'
                autoComplete='new-password'
                className={inputClass}
                value={drafts.privateKeyPassphrase}
                onChange={set('privateKeyPassphrase')}
              />
            </>
          )}
          {error !== null && (
            <span role='alert' className='font-caption text-xs text-red-500'>
              {error}
            </span>
          )}
          <div className='flex gap-2'>
            <button type='submit' className={primaryButtonClass} disabled={busy}>
              Save credential
            </button>
            <button type='button' className={buttonClass} disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!editing && error !== null && (
        <span role='alert' className='font-caption text-xs text-red-500'>
          {error}
        </span>
      )}
    </section>
  )
}
