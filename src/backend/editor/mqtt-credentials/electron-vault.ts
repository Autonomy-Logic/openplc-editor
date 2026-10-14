import { app, safeStorage } from 'electron'
import { join } from 'path'

import { isEncryptionAvailable } from '../edge-account/session-store'
import { logger } from '../services'
import { createOwnerOnlyTextFile } from '../utils/owner-only-file'
import {
  createMqttCredentialVault,
  type MqttCredentialVault,
  type MqttVaultCipher,
  type MqttVaultStorage,
} from './vault'

export const MQTT_CREDENTIAL_VAULT_DIR = 'mqtt-credentials'
export const MQTT_CREDENTIAL_VAULT_FILE = 'credentials.json'
export const MQTT_CREDENTIAL_VAULT_MAX_BYTES = 4 * 1024 * 1024

/** Same protection rule as the Edge session: no `safeStorage`, or Linux `basic_text`, means no disk. */
export const safeStorageMqttCipher: MqttVaultCipher = {
  canEncrypt: () => isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (sealed) => safeStorage.decryptString(sealed),
}

export const mqttCredentialVaultPath = (userDataDir: string): string =>
  join(userDataDir, MQTT_CREDENTIAL_VAULT_DIR, MQTT_CREDENTIAL_VAULT_FILE)

/** One owner-only file, replaced atomically; never inside a project, its snapshots or the retrieved-projects root. */
export const createMqttCredentialFileStorage = (userDataDir: string): MqttVaultStorage =>
  createOwnerOnlyTextFile(
    join(userDataDir, MQTT_CREDENTIAL_VAULT_DIR),
    MQTT_CREDENTIAL_VAULT_FILE,
    MQTT_CREDENTIAL_VAULT_MAX_BYTES,
    'vault',
  )

export const createElectronMqttCredentialVault = (userDataDir: string = app.getPath('userData')): MqttCredentialVault =>
  createMqttCredentialVault({
    cipher: safeStorageMqttCipher,
    storage: createMqttCredentialFileStorage(userDataDir),
    log: (level, line) => {
      if (level === 'info') logger.info(line)
      else logger.warn(line)
    },
  })
