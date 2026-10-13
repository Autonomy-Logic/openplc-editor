// No method returns the password, private key or passphrase.

import type { MqttSecretAuthMethod } from '../../../frontend/utils/mqtt/contract/contract'

/** Identity the credential belongs to: the project, the target runtime and the MQTT server. */
export interface MqttCredentialScope {
  projectKey: string
  targetKey: string
  serverName: string
}

/** Broker parameters the credential was entered for; a credential never follows a different binding. */
export interface MqttCredentialBinding {
  host: string
  port: number
  tlsEnabled: boolean
  clientId: string
  method: MqttSecretAuthMethod
}

export type MqttCredentialSecret =
  | { method: 'username_password'; username: string; password: string }
  | { method: 'client_certificate'; certificatePem: string; privateKeyPem: string; privateKeyPassphrase?: string }

export type MqttCredentialPersistence = 'protected' | 'session' | 'transient'

export interface MqttCredentialPresence {
  present: boolean
  method?: MqttSecretAuthMethod
  binding?: MqttCredentialBinding
  usernameSet?: boolean
  updatedAt?: string
}

export type MqttCredentialInputErrorCode =
  | 'credential_invalid_format'
  | 'credential_too_large'
  | 'credential_method_mismatch'

export type MqttCredentialWriteResult =
  | { ok: true; presence: MqttCredentialPresence }
  | { ok: false; code: MqttCredentialInputErrorCode | 'credential_store_unavailable'; message: string }

export interface MqttCredentialStorePort {
  readonly persistence: MqttCredentialPersistence
  getPresence(scope: MqttCredentialScope): Promise<MqttCredentialPresence>
  put(
    scope: MqttCredentialScope,
    secret: MqttCredentialSecret,
    binding: MqttCredentialBinding,
  ): Promise<MqttCredentialWriteResult>
  remove(scope: MqttCredentialScope): Promise<void>
  /** Called when a presence may have changed without a UI action (sent, signed out, project closed). */
  subscribe?(listener: () => void): () => void
}
