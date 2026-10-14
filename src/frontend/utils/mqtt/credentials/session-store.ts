import type {
  MqttCredentialBinding,
  MqttCredentialPresence,
  MqttCredentialScope,
  MqttCredentialSecret,
  MqttCredentialStorePort,
  MqttCredentialWriteResult,
} from '../../../../middleware/shared/ports/mqtt-credential-port'
import { validateMqttCredentialSecret } from './validate'

interface SessionEntry {
  secret: MqttCredentialSecret
  binding: MqttCredentialBinding
  updatedAt: string
}

export const mqttCredentialScopeKey = (scope: MqttCredentialScope): string =>
  JSON.stringify([scope.projectKey, scope.targetKey, scope.serverName])

const copySecret = (secret: MqttCredentialSecret): MqttCredentialSecret =>
  secret.method === 'username_password'
    ? { method: secret.method, username: secret.username, password: secret.password }
    : {
        method: secret.method,
        certificatePem: secret.certificatePem,
        privateKeyPem: secret.privateKeyPem,
        ...(secret.privateKeyPassphrase ? { privateKeyPassphrase: secret.privateKeyPassphrase } : {}),
      }

const presenceOf = (entry: SessionEntry | undefined): MqttCredentialPresence =>
  entry === undefined
    ? { present: false }
    : {
        present: true,
        method: entry.secret.method,
        binding: { ...entry.binding },
        ...(entry.secret.method === 'username_password' ? { usernameSet: true } : {}),
        updatedAt: entry.updatedAt,
      }

/** Page memory only: nothing reaches disk, the project or the serializable store. */
export const createSessionMqttCredentialStore = (now: () => Date = () => new Date()): MqttCredentialStorePort => {
  const entries = new Map<string, SessionEntry>()
  return {
    persistence: 'session',
    getPresence: (scope) => Promise.resolve(presenceOf(entries.get(mqttCredentialScopeKey(scope)))),
    put: (scope, secret, binding): Promise<MqttCredentialWriteResult> => {
      const [error] = validateMqttCredentialSecret(secret, binding)
      if (error) return Promise.resolve({ ok: false, code: error.code, message: error.message })
      const entry: SessionEntry = {
        secret: copySecret(secret),
        binding: { ...binding },
        updatedAt: now().toISOString(),
      }
      entries.set(mqttCredentialScopeKey(scope), entry)
      return Promise.resolve({ ok: true, presence: presenceOf(entry) })
    },
    remove: (scope) => {
      entries.delete(mqttCredentialScopeKey(scope))
      return Promise.resolve()
    },
  }
}

/** Process-wide fallback used when the platform supplies no credential store of its own. */
export const sessionMqttCredentialStore: MqttCredentialStorePort = createSessionMqttCredentialStore()
