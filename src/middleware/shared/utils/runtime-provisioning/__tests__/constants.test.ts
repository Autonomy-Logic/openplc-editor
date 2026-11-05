import {
  DEFAULT_SSH_PORT,
  PROVISIONING_BOOTLOADER_TIMEOUT_MS,
  SSH_PROBE_MAX_BYTES,
  SSH_PROBE_TIMEOUT_MS,
} from '../constants'

describe('runtime provisioning constants', () => {
  it('checks SSH on port 22 by default', () => {
    expect(DEFAULT_SSH_PORT).toBe(22)
  })

  it('gives the bootloader 2,500 ms to answer', () => {
    expect(PROVISIONING_BOOTLOADER_TIMEOUT_MS).toBe(2500)
  })

  it('gives the SSH probe 2,000 ms and reads at most 1,024 bytes of greeting', () => {
    expect(SSH_PROBE_TIMEOUT_MS).toBe(2000)
    expect(SSH_PROBE_MAX_BYTES).toBe(1024)
  })
})
