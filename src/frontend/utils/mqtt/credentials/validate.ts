import type {
  MqttCredentialBinding,
  MqttCredentialInputErrorCode,
  MqttCredentialSecret,
} from '../../../../middleware/shared/ports/mqtt-credential-port'
import { utf8Length } from '../contract/names'

/** Input limits of the runtime staging endpoint, in UTF-8 bytes. */
export const MQTT_CREDENTIAL_LIMITS = {
  maxUsernameBytes: 256,
  maxPasswordBytes: 1024,
  maxCertificateBytes: 65536,
  maxPrivateKeyBytes: 65536,
  maxPassphraseBytes: 1024,
} as const

export interface MqttCredentialInputError {
  code: MqttCredentialInputErrorCode
  field: 'method' | 'username' | 'password' | 'certificatePem' | 'privateKeyPem' | 'privateKeyPassphrase'
  message: string
}

const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----[\s\S]+?-----END \1-----/
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })

const tooLarge = (field: MqttCredentialInputError['field'], label: string, max: number): MqttCredentialInputError => ({
  code: 'credential_too_large',
  field,
  message: `${label} must be at most ${max} bytes.`,
})

/** Format and size checks before a secret is stored; messages never echo the secret. */
export const validateMqttCredentialSecret = (
  secret: MqttCredentialSecret,
  binding: MqttCredentialBinding,
): MqttCredentialInputError[] => {
  const errors: MqttCredentialInputError[] = []
  if (secret.method !== binding.method) {
    errors.push({
      code: 'credential_method_mismatch',
      field: 'method',
      message: 'The credential does not match the authentication method of the integration.',
    })
    return errors
  }
  if (secret.method === 'username_password') {
    const usernameBytes = utf8Length(secret.username)
    if (usernameBytes === 0 || hasControlCharacter(secret.username)) {
      errors.push({
        code: 'credential_invalid_format',
        field: 'username',
        message: 'Enter a username without control characters.',
      })
    } else if (usernameBytes > MQTT_CREDENTIAL_LIMITS.maxUsernameBytes) {
      errors.push(tooLarge('username', 'Username', MQTT_CREDENTIAL_LIMITS.maxUsernameBytes))
    }
    const passwordBytes = utf8Length(secret.password)
    if (passwordBytes === 0) {
      errors.push({ code: 'credential_invalid_format', field: 'password', message: 'Enter a password.' })
    } else if (passwordBytes > MQTT_CREDENTIAL_LIMITS.maxPasswordBytes) {
      errors.push(tooLarge('password', 'Password', MQTT_CREDENTIAL_LIMITS.maxPasswordBytes))
    }
    return errors
  }
  if (utf8Length(secret.certificatePem) > MQTT_CREDENTIAL_LIMITS.maxCertificateBytes) {
    errors.push(tooLarge('certificatePem', 'Client certificate', MQTT_CREDENTIAL_LIMITS.maxCertificateBytes))
  } else if (!CERTIFICATE_BLOCK.test(secret.certificatePem)) {
    errors.push({
      code: 'credential_invalid_format',
      field: 'certificatePem',
      message: 'The client certificate must be a PEM certificate.',
    })
  }
  if (utf8Length(secret.privateKeyPem) > MQTT_CREDENTIAL_LIMITS.maxPrivateKeyBytes) {
    errors.push(tooLarge('privateKeyPem', 'Private key', MQTT_CREDENTIAL_LIMITS.maxPrivateKeyBytes))
  } else if (!PRIVATE_KEY_BLOCK.test(secret.privateKeyPem)) {
    errors.push({
      code: 'credential_invalid_format',
      field: 'privateKeyPem',
      message: 'The private key must be a PEM private key.',
    })
  }
  const passphrase = secret.privateKeyPassphrase ?? ''
  if (utf8Length(passphrase) > MQTT_CREDENTIAL_LIMITS.maxPassphraseBytes) {
    errors.push(tooLarge('privateKeyPassphrase', 'Key passphrase', MQTT_CREDENTIAL_LIMITS.maxPassphraseBytes))
  }
  return errors
}
