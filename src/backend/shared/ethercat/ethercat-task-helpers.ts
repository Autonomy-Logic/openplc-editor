/**
 * Generates a system task name from an EtherCAT device name.
 * Example: "Master1" -> "EtherCAT_Master1"
 */
export function ethercatTaskName(deviceName: string): string {
  return `EtherCAT_${deviceName}`
}

/**
 * Converts a cycle time in microseconds to an IEC 61131-3 time interval string.
 * Examples: 1000 -> "T#1ms", 500 -> "T#500us", 20000 -> "T#20ms"
 */
export function cycleTimeUsToIecInterval(cycleTimeUs: number): string {
  if (cycleTimeUs <= 0) return 'T#1ms'
  if (cycleTimeUs % 1000 === 0) {
    return `T#${cycleTimeUs / 1000}ms`
  }
  return `T#${cycleTimeUs}us`
}
