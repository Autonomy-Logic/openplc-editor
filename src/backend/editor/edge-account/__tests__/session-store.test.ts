/**
 * Where the refresh token goes, with `safeStorage` and the store stubbed.
 *
 * Two decisions are worth protecting. A token must never reach the disk in a form the
 * OS did not actually encrypt — and on Linux without a keyring Electron says it can
 * encrypt while using a hardcoded key. And a rotation that could not be persisted must
 * not leave the previous ciphertext behind, because that ciphertext is a token the
 * server has already retired.
 */

import { safeStorage } from 'electron'

import { store } from '../../../../main/modules/store'
import { clearRefreshToken, isEncryptionAvailable, readRefreshToken, saveRefreshToken } from '../session-store'

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => true),
    getSelectedStorageBackend: jest.fn(() => 'gnome_libsecret'),
    encryptString: jest.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: jest.fn((buffer: Buffer) => buffer.toString().replace(/^enc:/, '')),
  },
}))

jest.mock('../../../../main/modules/store', () => {
  const values = new Map<string, unknown>()

  return {
    store: {
      get: jest.fn((key: string) => values.get(key)),
      set: jest.fn((key: string, value: unknown) => values.set(key, value)),
      delete: jest.fn((key: string) => values.delete(key)),
    },
  }
})

const storage = jest.mocked(safeStorage)
const disk = jest.mocked(store)

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function pretendPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  jest.clearAllMocks()
  storage.isEncryptionAvailable.mockReturnValue(true)
  storage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
  storage.encryptString.mockImplementation((value: string) => Buffer.from(`enc:${value}`))
  pretendPlatform('darwin')
  // The in-memory copy is module state; clearing is the only way to start each case cold.
  clearRefreshToken()
  jest.clearAllMocks()
})

afterAll(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

describe('saveRefreshToken', () => {
  it('persists the ciphertext, never the token', () => {
    expect(saveRefreshToken('r1')).toEqual({ persisted: true })

    expect(disk.set).toHaveBeenCalledWith('edge_session', {
      refreshToken: Buffer.from('enc:r1').toString('base64'),
    })
    expect(JSON.stringify(disk.set.mock.calls)).not.toContain('"r1"')
  })

  it('keeps the token in memory only when the OS cannot encrypt', () => {
    storage.isEncryptionAvailable.mockReturnValue(false)

    expect(saveRefreshToken('r1')).toEqual({ persisted: false })
    expect(disk.set).not.toHaveBeenCalled()
    expect(readRefreshToken()).toBe('r1')
  })

  it('refuses the Linux basic_text backend, which is a hardcoded key and not encryption', () => {
    pretendPlatform('linux')
    storage.getSelectedStorageBackend.mockReturnValue('basic_text')

    expect(saveRefreshToken('r1')).toEqual({ persisted: false })
    expect(disk.set).not.toHaveBeenCalled()
    expect(isEncryptionAvailable()).toBe(false)
  })

  it('accepts a real Linux keyring backend', () => {
    pretendPlatform('linux')
    storage.getSelectedStorageBackend.mockReturnValue('kwallet5')

    expect(saveRefreshToken('r1')).toEqual({ persisted: true })
    expect(disk.set).toHaveBeenCalledTimes(1)
  })

  it('never consults the Linux backend probe elsewhere, where it throws', () => {
    pretendPlatform('win32')
    storage.getSelectedStorageBackend.mockImplementation(() => {
      throw new Error('not on Linux')
    })

    expect(saveRefreshToken('r1')).toEqual({ persisted: true })
    expect(storage.getSelectedStorageBackend).not.toHaveBeenCalled()
  })

  it('treats a probe that throws as no encryption', () => {
    pretendPlatform('linux')
    storage.getSelectedStorageBackend.mockImplementation(() => {
      throw new Error('safeStorage not ready')
    })

    expect(saveRefreshToken('r1')).toEqual({ persisted: false })
    expect(disk.set).not.toHaveBeenCalled()
  })

  it('does not persist when encryption was advertised but failed', () => {
    storage.encryptString.mockImplementation(() => {
      throw new Error('keychain locked')
    })

    expect(saveRefreshToken('r1')).toEqual({ persisted: false })
    expect(disk.set).not.toHaveBeenCalled()
  })

  it.each([
    ['encryption is unavailable', () => storage.isEncryptionAvailable.mockReturnValue(false)],
    [
      'encryption fails',
      () =>
        storage.encryptString.mockImplementation(() => {
          throw new Error('keychain locked')
        }),
    ],
  ])('deletes the previously stored entry when %s', (_label, arrange) => {
    // Every renewal rotates the token and retires the old one. A stored ciphertext one
    // rotation behind is a token the server no longer accepts, so the next launch would
    // begin with a request that can only fail.
    saveRefreshToken('r1')
    expect(disk.set).toHaveBeenCalledTimes(1)

    arrange()
    saveRefreshToken('r2')

    expect(disk.delete).toHaveBeenCalledWith('edge_session')
    expect(disk.get('edge_session')).toBeUndefined()
    // The run itself keeps working from memory.
    expect(readRefreshToken()).toBe('r2')
  })
})

describe('readRefreshToken', () => {
  it('decrypts what was stored, once, and serves memory afterwards', () => {
    saveRefreshToken('r1')
    clearRefreshToken()
    disk.set('edge_session', { refreshToken: Buffer.from('enc:r1').toString('base64') })
    jest.clearAllMocks()

    expect(readRefreshToken()).toBe('r1')
    expect(readRefreshToken()).toBe('r1')
    expect(storage.decryptString).toHaveBeenCalledTimes(1)
  })

  it('answers null, and drops the entry, when the ciphertext cannot be decrypted', () => {
    disk.set('edge_session', { refreshToken: 'garbage' })
    storage.decryptString.mockImplementationOnce(() => {
      throw new Error('different OS user')
    })

    expect(readRefreshToken()).toBeNull()
    expect(disk.delete).toHaveBeenCalledWith('edge_session')
  })

  it('answers null when there is an entry but no way to decrypt it', () => {
    disk.set('edge_session', { refreshToken: 'ciphertext' })
    storage.isEncryptionAvailable.mockReturnValue(false)

    expect(readRefreshToken()).toBeNull()
    expect(storage.decryptString).not.toHaveBeenCalled()
  })

  it('answers null when nothing was ever stored', () => {
    expect(readRefreshToken()).toBeNull()
  })
})

describe('clearRefreshToken', () => {
  it('forgets memory and disk, and survives a store that cannot delete', () => {
    saveRefreshToken('r1')
    disk.delete.mockImplementationOnce(() => {
      throw new Error('read-only config')
    })

    expect(() => clearRefreshToken()).not.toThrow()
    expect(disk.delete).toHaveBeenCalledWith('edge_session')
    // Memory is gone either way: the next read has to go back to the disk.
    expect(readRefreshToken()).toBe('r1')
    expect(storage.decryptString).toHaveBeenCalledTimes(1)
  })
})
