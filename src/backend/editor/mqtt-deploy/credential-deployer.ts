// The secret goes from the vault to the staging body only: never to the renderer, compiler, bundle or logs.

import { randomBytes } from 'crypto'

import type { MqttCredentialRef, MqttProjectIntegrationV1 } from '../../../frontend/utils/mqtt/contract/contract'
import {
  type MqttRuntimeStagingStatus,
  parseMqttApiError,
  parseMqttCapabilities,
  parseMqttRuntimeCredentials,
  parseMqttStagingReceipt,
} from '../../../frontend/utils/mqtt/runtime/status'
import { mqttCredentialBinding, mqttRuntimeBindingMatches } from '../../../frontend/utils/mqtt/ui/credential-state'
import type { StageMqttCredentialResult } from '../../../middleware/shared/ports/compiler-platform-port'
import type {
  MqttCredentialBinding,
  MqttCredentialScope,
  MqttCredentialSecret,
} from '../../../middleware/shared/ports/mqtt-credential-port'
import type { MqttCredentialVault } from '../mqtt-credentials/vault'
import { mqttCredentialEntryLabel } from '../mqtt-credentials/vault'
import { type PinnedRuntimeResponse, RuntimeIdentityError } from '../runtime/pinned-runtime-request'
import type { RuntimeIdentityStore } from '../runtime/runtime-identity-store'

export const MQTT_STAGING_PATH = '/api/mqtt/credentials/staging'
const MAX_RESPONSE_BYTES = 64 * 1024

export interface RuntimeApiCall {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  headers?: Record<string, string>
  body?: Buffer
}

export interface MqttCredentialDeployerDeps {
  vault: Pick<MqttCredentialVault, 'readSecret'>
  identity: Pick<RuntimeIdentityStore, 'get'>
  /** Address the runtime session (JWT) was obtained from; the credential only goes to that runtime. */
  sessionAddress: () => string | null
  /** Authenticated request over a connection pinned to `sha256`; rejects with `RuntimeIdentityError` on mismatch. */
  request: (address: string, sha256: string, call: RuntimeApiCall) => Promise<PinnedRuntimeResponse>
  log: (level: 'info' | 'warn', line: string) => void
}

export interface StageMqttCredentialInput {
  address: string
  projectKey: string
  serverName: string
  integration: MqttProjectIntegrationV1
  programMd5: string
}

export interface MqttCredentialDeployer {
  stage(input: StageMqttCredentialInput): Promise<StageMqttCredentialResult>
  discard(address: string, stagingId: string): Promise<void>
}

type Failure = Extract<StageMqttCredentialResult, { ok: false }>

const failure = (code: string, message: string): Failure => ({ ok: false, code, message })

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const runtimeFailure = (response: PinnedRuntimeResponse, fallback: string): Failure => {
  const error = parseMqttApiError(parseJson(response.body))
  return error
    ? failure(error.code, error.message)
    : failure('runtime_request_failed', `${fallback} (HTTP ${response.statusCode}).`)
}

const runtimeBinding = (binding: MqttCredentialBinding) => ({
  host: binding.host,
  port: binding.port,
  tls_enabled: binding.tlsEnabled,
  client_id: binding.clientId,
  method: binding.method,
})

/** Multipart body for `POST /api/mqtt/credentials/staging`; the caller wipes it after use. */
export const buildStagingBody = (
  binding: MqttCredentialBinding,
  secret: MqttCredentialSecret,
  programMd5: string,
): { body: Buffer; contentType: string } => {
  const boundary = `----openplc-mqtt-${randomBytes(16).toString('hex')}`
  const request = {
    method: secret.method,
    binding: runtimeBinding(binding),
    programMd5,
    ...(secret.method === 'username_password' ? { username: secret.username } : {}),
  }
  const parts: Array<[string, string, string | null]> = [['request', JSON.stringify(request), null]]
  if (secret.method === 'username_password') {
    parts.push(['password', secret.password, null])
  } else {
    parts.push(['client_certificate', secret.certificatePem, 'client.crt'])
    parts.push(['client_key', secret.privateKeyPem, 'client.key'])
    if (secret.privateKeyPassphrase) parts.push(['client_key_passphrase', secret.privateKeyPassphrase, null])
  }
  const text = parts
    .map(([name, value, fileName]) => {
      const disposition = fileName
        ? `form-data; name="${name}"; filename="${fileName}"\r\nContent-Type: application/octet-stream`
        : `form-data; name="${name}"`
      return `--${boundary}\r\nContent-Disposition: ${disposition}\r\n\r\n${value}\r\n`
    })
    .join('')
  return {
    body: Buffer.from(`${text}--${boundary}--\r\n`, 'utf-8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export const createMqttCredentialDeployer = (deps: MqttCredentialDeployerDeps): MqttCredentialDeployer => {
  const label = (scope: MqttCredentialScope) => mqttCredentialEntryLabel(scope)

  const call = async (address: string, sha256: string, request: RuntimeApiCall): Promise<PinnedRuntimeResponse> =>
    deps.request(address, sha256, request)

  const reuseActive = async (
    address: string,
    sha256: string,
    binding: MqttCredentialBinding,
    localReason: 'missing' | 'binding_mismatch',
  ): Promise<StageMqttCredentialResult> => {
    const response = await call(address, sha256, { method: 'GET', path: '/api/mqtt/credentials' })
    if (response.statusCode !== 200) return runtimeFailure(response, 'The runtime did not report its credentials')
    const credentials = parseMqttRuntimeCredentials(parseJson(response.body))
    if (credentials === null) {
      return failure('runtime_response_invalid', 'The runtime answered the credential query with an unexpected body.')
    }
    const { active } = credentials
    if (active && active.method === binding.method && mqttRuntimeBindingMatches(binding, active.binding)) {
      return {
        ok: true,
        credentialRef: { id: active.id, revision: active.revision, staging_id: null },
        stagingId: null,
      }
    }
    return localReason === 'binding_mismatch'
      ? failure(
          'config_credential_binding_mismatch',
          'The saved credential belongs to a different broker, client ID or method. Enter it again for this broker.',
        )
      : failure(
          'config_credential_missing',
          'No credential for this broker is saved on this computer or on the runtime. Enter it in the Security tab.',
        )
  }

  const stageSecret = async (
    address: string,
    sha256: string,
    binding: MqttCredentialBinding,
    secret: MqttCredentialSecret,
    programMd5: string,
  ): Promise<StageMqttCredentialResult> => {
    const capabilities = await call(address, sha256, { method: 'GET', path: '/api/mqtt/capabilities' })
    if (capabilities.statusCode !== 200) {
      return runtimeFailure(capabilities, 'This runtime does not support MQTT credentials')
    }
    const declared = parseMqttCapabilities(parseJson(capabilities.body))
    if (declared === null || !declared.formatVersions.includes(1)) {
      return failure('config_unknown_contract', 'This runtime does not accept this MQTT configuration format.')
    }
    if (!declared.methods.includes(binding.method)) {
      return failure(
        'credential_method_mismatch',
        'This runtime cannot store credentials for this authentication method.',
      )
    }

    const { body, contentType } = buildStagingBody(binding, secret, programMd5)
    let response: PinnedRuntimeResponse
    try {
      response = await call(address, sha256, {
        method: 'POST',
        path: MQTT_STAGING_PATH,
        headers: { 'Content-Type': contentType },
        body,
      })
    } finally {
      body.fill(0)
    }
    if (response.statusCode !== 201) return runtimeFailure(response, 'The runtime refused the credential')
    const receipt: MqttRuntimeStagingStatus | null = parseMqttStagingReceipt(parseJson(response.body))
    if (
      receipt === null ||
      receipt.programMd5 !== programMd5 ||
      receipt.method !== binding.method ||
      !mqttRuntimeBindingMatches(binding, receipt.binding)
    ) {
      return failure('runtime_response_invalid', 'The runtime answered the staging with an unexpected body.')
    }
    const credentialRef: MqttCredentialRef = {
      id: receipt.credentialRef.id,
      revision: receipt.credentialRef.revision,
      staging_id: receipt.stagingId,
    }
    return { ok: true, credentialRef, stagingId: receipt.stagingId }
  }

  return {
    stage: async (input) => {
      const binding = mqttCredentialBinding(input.integration)
      if (binding === null) return failure('internal_error', 'This integration does not use a credential.')
      const scope: MqttCredentialScope = {
        projectKey: input.projectKey,
        targetKey: `address:${input.address}`,
        serverName: input.serverName,
      }
      const entry = label(scope)
      if (deps.sessionAddress() !== input.address) {
        deps.log('warn', `MQTT credential deploy: event=stage result=session_mismatch entry=${entry}`)
        return failure(
          'forbidden',
          'Log in to this runtime again before uploading: the session belongs to another target.',
        )
      }
      const pin = await deps.identity.get(scope.targetKey)
      if (pin === null) {
        deps.log('warn', `MQTT credential deploy: event=stage result=runtime_trust_missing entry=${entry}`)
        return failure(
          'runtime_trust_missing',
          'The runtime identity is not verified. Enter its certificate fingerprint in the Security tab before sending credentials.',
        )
      }
      try {
        const local = await deps.vault.readSecret(scope, binding)
        const result = local.ok
          ? await stageSecret(input.address, pin.sha256, binding, local.secret, input.programMd5)
          : await reuseActive(input.address, pin.sha256, binding, local.reason)
        const outcome = result.ok ? (result.stagingId ? 'staged' : 'reused_active') : result.code
        deps.log(
          result.ok ? 'info' : 'warn',
          `MQTT credential deploy: event=stage result=${outcome} method=${binding.method} entry=${entry}` +
            (result.ok ? ` credential=${result.credentialRef.id}#${result.credentialRef.revision}` : ''),
        )
        return result
      } catch (error) {
        if (error instanceof RuntimeIdentityError) {
          deps.log('warn', `MQTT credential deploy: event=stage result=${error.code} entry=${entry}`)
          return failure(error.code, error.message)
        }
        deps.log('warn', `MQTT credential deploy: event=stage result=unreachable entry=${entry}`)
        return failure('runtime_unreachable', 'The runtime could not be reached to prepare the credential.')
      }
    },

    discard: async (address, stagingId) => {
      const pin = await deps.identity.get(`address:${address}`)
      if (pin === null || !/^[0-9a-f-]{36}$/.test(stagingId)) return
      try {
        const response = await call(address, pin.sha256, {
          method: 'DELETE',
          path: `${MQTT_STAGING_PATH}/${stagingId}`,
        })
        deps.log('info', `MQTT credential deploy: event=discard result=${response.statusCode} staging=${stagingId}`)
      } catch {
        deps.log('warn', `MQTT credential deploy: event=discard result=unreachable staging=${stagingId}`)
      }
    },
  }
}

export const MQTT_DEPLOY_MAX_RESPONSE_BYTES = MAX_RESPONSE_BYTES
