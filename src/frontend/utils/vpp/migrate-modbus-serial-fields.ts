/**
 * Fold a project's Modbus RTU wiring forward into the `serial` section.
 *
 * Four fields — which UART the RTU answers on, that UART's baud rate, and the
 * RS485 driver-enable pair — used to live in the `modbus_rtu` section. They
 * moved to `serial` when the unified Modbus server screen took `modbus_rtu`
 * over, because the native screen renders that section itself and anything
 * left in it had nowhere to appear.
 *
 * Persisted state is keyed by section id, so a project saved before the move
 * still carries those values under the old keys. Without this, the Serial
 * screen reads `serial.modbus_port`, finds nothing and shows its default,
 * while the compiler's fallback chain finds the old key and builds something
 * else — the screen quietly disagreeing with the firmware, which is the exact
 * failure this whole area keeps producing.
 *
 * Two older spellings exist and both are handled: `serial_port` / `baud_rate`
 * from the first split, and `rtu_interface` / `rtu_baud_rate` from the
 * original single-screen shape.
 *
 * ## Why it is gated on the board
 *
 * A board whose installed VPP has NOT been split still renders the old Modbus
 * screen, which reads `modbus_rtu.rtu_interface` directly. Migrating those
 * values away would mirror the bug rather than fix it: the legacy screen would
 * then show its default while the compiler used the migrated value. So the
 * caller passes a predicate, and only buckets whose board actually ships a
 * `serial` screen are touched.
 *
 * That is also why this runs when the board list lands rather than when the
 * project loads: the project reaches the store first, and which packages are
 * installed is not known until `getAvailableBoards` resolves.
 *
 * Pure and idempotent: a value already present under the new key wins and the
 * old key is dropped, so a second pass finds nothing to do. Returns the input
 * unchanged (by identity) when nothing moved, so the caller can skip the write.
 */

/** Old key → new key, in precedence order. First match wins. */
const MOVES: Array<{ to: string; from: string[] }> = [
  { to: 'modbus_port', from: ['serial_port', 'rtu_interface'] },
  { to: 'modbus_baud_rate', from: ['baud_rate', 'rtu_baud_rate'] },
  { to: 'enable_rs485_en_pin', from: ['enable_rs485_en_pin'] },
  { to: 'rs485_en_pin', from: ['rtu_rs485_en_pin'] },
]

const RTU_SECTION = 'modbus_rtu'
const SERIAL_SECTION = 'serial'

/** Per-board archive of vendor-screen state, as the device slice holds it. */
export type VendorScreenDataByBoard = Record<string, Record<string, unknown>>

function asSection(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Migrate one board's bucket. Returns the same object when nothing moved.
 */
function migrateBucket(bucket: Record<string, unknown>): Record<string, unknown> {
  const rtu = asSection(bucket[RTU_SECTION])
  if (!rtu) return bucket

  const serial = asSection(bucket[SERIAL_SECTION]) ?? {}
  const nextRtu: Record<string, unknown> = { ...rtu }
  const nextSerial: Record<string, unknown> = { ...serial }
  let moved = false

  for (const { to, from } of MOVES) {
    // Every old spelling is dropped once the field is dealt with, so a project
    // carrying both `serial_port` and `rtu_interface` does not leave one behind
    // to be picked up by the compiler's fallback on a later build.
    let value: unknown
    for (const key of from) {
      if (!(key in nextRtu)) continue
      if (value === undefined) value = nextRtu[key]
      delete nextRtu[key]
      moved = true
    }
    if (value === undefined) continue
    // A value already written through the new screen is the user's most recent
    // intent; the legacy key is stale by definition.
    if (!(to in nextSerial)) nextSerial[to] = value
  }

  if (!moved) return bucket
  return { ...bucket, [RTU_SECTION]: nextRtu, [SERIAL_SECTION]: nextSerial }
}

/**
 * Migrate every board bucket whose board ships a `serial` screen.
 *
 * `boardHasSerialScreen` is injected rather than derived from `BoardInfo` here
 * so the rule stays testable without a board fixture, and so the caller owns
 * the question of what "installed and split" means.
 */
export function migrateModbusSerialFields(
  byBoard: VendorScreenDataByBoard | undefined,
  boardHasSerialScreen: (boardName: string) => boolean,
): VendorScreenDataByBoard | undefined {
  if (!byBoard) return byBoard

  let changed = false
  const next: VendorScreenDataByBoard = {}
  for (const [board, bucket] of Object.entries(byBoard)) {
    const section = asSection(bucket)
    if (!section || !boardHasSerialScreen(board)) {
      next[board] = bucket
      continue
    }
    const migrated = migrateBucket(section)
    if (migrated !== section) changed = true
    next[board] = migrated
  }

  return changed ? next : byBoard
}
