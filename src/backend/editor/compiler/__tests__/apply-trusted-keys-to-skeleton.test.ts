/**
 * Tests for the ARDUINO half of the trusted-keys injection (ADR-0004) —
 * `CompilerModule.applyTrustedKeysToSkeleton`, extracted from
 * `compileProgram` so this path is unit-testable (review #1014 finding A).
 *
 * This is the path the FIRST licensable package actually uses: all 13
 * com.industrialshields.esp32plc devices are arduino-cli. The runtime-v4
 * counterpart is covered by handle-vendor-plugin-packaging.test.ts.
 *
 * NOTE deliberately placed under __tests__/ and named *.test.ts: the repo's
 * jest testMatch does not collect `*.spec.ts` files (verified with
 * --listTests — compiler-module.spec.ts is dormant), so a suite added there
 * would never run.
 */

import { CompilerModule } from '../compiler-module'

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/mock-user-data'),
    getAppPath: jest.fn().mockReturnValue('/tmp/mock-app-root'),
    isPackaged: false,
    getVersion: jest.fn().mockReturnValue('0.0.0-test'),
  },
  dialog: {
    showSaveDialog: jest.fn().mockResolvedValue({ filePath: '/tmp/mock-save-path' }),
  },
}))

jest.mock('electron/main', () => ({}), { virtual: true })

// CompilerModule reads process.resourcesPath outside dev mode.
;(process as unknown as { resourcesPath: string }).resourcesPath ??= process.cwd()

describe('applyTrustedKeysToSkeleton (arduino-path trusted-keys injection, ADR-0004)', () => {
  const validJson = JSON.stringify({
    keys: [{ keyId: 0, pubKeyRawHex: 'ab'.repeat(64) }],
  })

  let compilerModule: CompilerModule

  beforeEach(() => {
    compilerModule = new CompilerModule()
  })

  const run = (overrides: Partial<Parameters<CompilerModule['applyTrustedKeysToSkeleton']>[0]>) => {
    const firmwareSkeleton: Record<string, string> = { 'examples/Baremetal/Baremetal.ino': '// sketch' }
    const messages: Array<{ logLevel: string; message: string }> = []
    const proceed = compilerModule.applyTrustedKeysToSkeleton({
      isRuntimeV3: false,
      isLicensable: true,
      packageLabel: 'com.vendor.licensed',
      trustedKeysJson: validJson,
      firmwareSkeleton,
      postMessage: (msg) => messages.push(msg),
      ...overrides,
    })
    return { proceed, firmwareSkeleton, messages }
  }

  it('licensable board + valid json → trusted_keys.c lands in the sketch tree and the build proceeds', () => {
    const { proceed, firmwareSkeleton, messages } = run({})
    expect(proceed).toBe(true)
    const generated = firmwareSkeleton['examples/Baremetal/trusted_keys.c']
    expect(generated).toBeDefined()
    expect(generated).toContain('const uint8_t LIC_TRUSTED_KEY_COUNT = 1;')
    expect(generated).toContain('0xab,')
    expect(messages).toEqual([
      expect.objectContaining({ logLevel: 'info', message: expect.stringContaining('1 key(s)') }),
    ])
  })

  it('licensable board + missing json → packaging fault posted and the build stops', () => {
    const { proceed, firmwareSkeleton, messages } = run({ trustedKeysJson: null })
    expect(proceed).toBe(false)
    expect(firmwareSkeleton['examples/Baremetal/trusted_keys.c']).toBeUndefined()
    expect(messages).toEqual([
      expect.objectContaining({
        logLevel: 'error',
        message: expect.stringContaining('packaging fault'),
      }),
    ])
    expect(messages[0].message).toContain('Stopping compilation process.')
  })

  it('licensable board + malformed json → packaging fault carries the parse reason', () => {
    const { proceed, messages } = run({ trustedKeysJson: '{"keys": []}' })
    expect(proceed).toBe(false)
    expect(messages[0].message).toContain('at least one signing key')
  })

  it('non-licensable board → nothing generated, no messages, build proceeds', () => {
    const { proceed, firmwareSkeleton, messages } = run({ isLicensable: false })
    expect(proceed).toBe(true)
    expect(firmwareSkeleton['examples/Baremetal/trusted_keys.c']).toBeUndefined()
    expect(messages).toEqual([])
  })

  it('runtime-v3 board → exempt even when licensable: v3 never links Arduino firmware', () => {
    // The enclosing compileProgram block is merely NOT-v4, which includes
    // v3 — the hard stop must not fire one target-type wider than the
    // thing it protects (review #1014 finding D).
    const { proceed, firmwareSkeleton, messages } = run({ isRuntimeV3: true, trustedKeysJson: null })
    expect(proceed).toBe(true)
    expect(firmwareSkeleton['examples/Baremetal/trusted_keys.c']).toBeUndefined()
    expect(messages).toEqual([])
  })
})
