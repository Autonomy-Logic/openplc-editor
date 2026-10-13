import { useEffect, useState } from 'react'

import type {
  MqttCredentialBinding,
  MqttCredentialPersistence,
  MqttCredentialSecret,
  MqttCredentialWriteResult,
} from '../../../../../../../middleware/shared/ports/mqtt-credential-port'
import type { RuntimeIdentityPort } from '../../../../../../../middleware/shared/ports/runtime-identity-port'
import type { MqttAuthMethod, MqttProjectIntegrationV1 } from '../../../../../../utils/mqtt/contract/contract'
import { withMqttTlsEnabled } from '../../../../../../utils/mqtt/project/model'
import type { MqttProjectIssue } from '../../../../../../utils/mqtt/project/validate'
import type { MqttCredentialState } from '../../../../../../utils/mqtt/ui/credential-state'
import { ToggleSwitch } from '../../../../../_atoms/toggle-switch'
import { CredentialPanel } from './credential-panel'
import { hintClass, inputClass, IssueList, labelClass, textareaClass } from './fields'
import { RuntimeIdentityPanel } from './runtime-identity-panel'

const AUTH_OPTIONS: ReadonlyArray<{ value: MqttAuthMethod; label: string }> = [
  { value: 'anonymous', label: 'Anonymous' },
  { value: 'username_password', label: 'Username and password' },
  { value: 'client_certificate', label: 'Client certificate' },
]

const isAuthMethod = (value: string): value is MqttAuthMethod => AUTH_OPTIONS.some((o) => o.value === value)

interface SecuritySectionProps {
  integration: MqttProjectIntegrationV1
  issues: readonly MqttProjectIssue[]
  commit: (next: MqttProjectIntegrationV1) => void
  credentialBinding: MqttCredentialBinding | null
  credentialState: MqttCredentialState
  persistence: MqttCredentialPersistence
  onSaveCredential: (secret: MqttCredentialSecret, binding: MqttCredentialBinding) => Promise<MqttCredentialWriteResult>
  onRemoveCredential: () => Promise<void>
  /** Present where the runtime certificate must be pinned before a credential is sent to it. */
  runtimeIdentity?: RuntimeIdentityPort
  targetKey: string | null
}

export const SecuritySection = ({
  integration,
  issues,
  commit,
  credentialBinding,
  credentialState,
  persistence,
  onSaveCredential,
  onRemoveCredential,
  runtimeIdentity,
  targetKey,
}: SecuritySectionProps) => {
  const { tls } = integration.connection
  const savedCaPem = tls.enabled && tls.trust.source === 'pem' ? tls.trust.caPem : ''
  const [caDraft, setCaDraft] = useState(savedCaPem)
  useEffect(() => setCaDraft(savedCaPem), [savedCaPem])

  const setTrust = (trust: { source: 'system' } | { source: 'pem'; caPem: string }) =>
    commit({ ...integration, connection: { ...integration.connection, tls: { enabled: true, trust } } })

  return (
    <div className='flex max-w-xl flex-col gap-4'>
      <div className='flex items-center gap-3'>
        <ToggleSwitch
          id='mqtt-tls-enabled'
          aria-label='Use TLS'
          checked={tls.enabled}
          onCheckedChange={(enabled) => commit(withMqttTlsEnabled(integration, enabled))}
        />
        <label htmlFor='mqtt-tls-enabled' className={labelClass}>
          Use TLS
        </label>
      </div>
      {tls.enabled ? (
        <div className='flex flex-col gap-2' data-testid='mqtt-transport' data-transport='tls'>
          <p className={hintClass}>
            TLS 1.2 or later. The runtime always checks the broker certificate chain, validity and host name; there is
            no option to skip that check.
          </p>
          <fieldset className='flex flex-col gap-1'>
            <legend className={labelClass}>Trusted certificate authority</legend>
            <label className='flex items-center gap-2 font-caption text-xs'>
              <input
                type='radio'
                name='mqtt-trust'
                checked={tls.trust.source === 'system'}
                onChange={() => setTrust({ source: 'system' })}
              />
              System trust store
            </label>
            <label className='flex items-center gap-2 font-caption text-xs'>
              <input
                type='radio'
                name='mqtt-trust'
                checked={tls.trust.source === 'pem'}
                onChange={() => setTrust({ source: 'pem', caPem: caDraft })}
              />
              Private CA (PEM)
            </label>
          </fieldset>
          {tls.trust.source === 'pem' && (
            <>
              <label htmlFor='mqtt-ca-pem' className={labelClass}>
                CA certificate (PEM, not secret)
              </label>
              <textarea
                id='mqtt-ca-pem'
                rows={6}
                spellCheck={false}
                className={textareaClass}
                value={caDraft}
                onChange={(e) => setCaDraft(e.target.value)}
                onBlur={() => {
                  if (caDraft !== savedCaPem) setTrust({ source: 'pem', caPem: caDraft })
                }}
              />
            </>
          )}
        </div>
      ) : (
        <p
          role='note'
          data-testid='mqtt-transport'
          data-transport='plaintext'
          className='rounded-md border border-amber-300 bg-amber-50 p-2 font-caption text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        >
          Plaintext connection: traffic, including any username and password, is not encrypted and the broker identity
          is not verified.
        </p>
      )}
      <div className='flex flex-col gap-1'>
        <label htmlFor='mqtt-auth-method' className={labelClass}>
          Authentication
        </label>
        <select
          id='mqtt-auth-method'
          className={inputClass}
          value={integration.authMethod}
          onChange={(e) => {
            const { value } = e.target
            if (isAuthMethod(value)) commit({ ...integration, authMethod: value })
          }}
        >
          {AUTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={hintClass}>
          The project never stores passwords or private keys; they stay in the credential store of this computer or of
          the runtime.
        </span>
      </div>
      {credentialBinding !== null && integration.authMethod !== 'anonymous' && (
        <CredentialPanel
          method={integration.authMethod}
          binding={credentialBinding}
          state={credentialState}
          persistence={persistence}
          onSave={onSaveCredential}
          onRemove={onRemoveCredential}
        />
      )}
      {credentialBinding !== null &&
        integration.authMethod !== 'anonymous' &&
        runtimeIdentity !== undefined &&
        targetKey !== null && <RuntimeIdentityPanel port={runtimeIdentity} targetKey={targetKey} />}
      <IssueList issues={issues} label='Security issues' />
    </div>
  )
}
