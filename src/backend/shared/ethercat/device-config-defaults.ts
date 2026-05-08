import type { EtherCATSlaveConfig } from '@root/middleware/shared/ports/esi-types'

/**
 * Default per-slave configuration for a newly added EtherCAT device.
 * Values based on SOEM defaults and industrial best practices.
 */
export const DEFAULT_SLAVE_CONFIG: Readonly<EtherCATSlaveConfig> = {
  startupChecks: {
    checkVendorId: true,
    checkProductCode: true,
  },
  addressing: {
    ethercatAddress: 0,
  },
  timeouts: {
    sdoTimeoutMs: 1000,
    initToPreOpTimeoutMs: 3000,
    safeOpToOpTimeoutMs: 10000,
  },
  watchdog: {
    smWatchdogEnabled: true,
    smWatchdogMs: 100,
    pdiWatchdogEnabled: false,
    pdiWatchdogMs: 100,
  },
  distributedClocks: {
    dcEnabled: false,
    dcSyncUnitCycleUs: 0,
    dcSync0Enabled: false,
    dcSync0CycleUs: 0,
    dcSync0ShiftUs: 0,
    dcSync1Enabled: false,
    dcSync1CycleUs: 0,
    dcSync1ShiftUs: 0,
  },
}

/**
 * Creates a fresh mutable copy of the default slave config.
 * Each device gets its own config object to avoid shared-reference mutations.
 */
export function createDefaultSlaveConfig(): EtherCATSlaveConfig {
  return {
    startupChecks: { ...DEFAULT_SLAVE_CONFIG.startupChecks },
    addressing: { ...DEFAULT_SLAVE_CONFIG.addressing },
    timeouts: { ...DEFAULT_SLAVE_CONFIG.timeouts },
    watchdog: { ...DEFAULT_SLAVE_CONFIG.watchdog },
    distributedClocks: { ...DEFAULT_SLAVE_CONFIG.distributedClocks },
  }
}
