import type { BoardInfo, NativeScreenId } from '@root/middleware/shared/ports/types'

/**
 * Which runtime-native screens the current target replaces.
 *
 * A VPP declares `hidesNativeScreens` when its own driver implements a feature
 * the runtime also provides. Hiding is not cosmetic: the screen disappears from
 * the project tree AND the native feature is switched off on the device, so the
 * vendor's driver is the only thing handling it.
 *
 * That coupling is the point. Two live implementations of retention — a
 * hardware store and the runtime's file store, both writing every scan — is a
 * configuration nobody would choose deliberately and nobody would notice
 * immediately, because both of them "work".
 */
export function hiddenNativeScreens(board: BoardInfo | null | undefined): ReadonlySet<NativeScreenId> {
  return new Set(board?.vpp?.hidesNativeScreens ?? [])
}

/**
 * Whether a native screen should be shown for this target.
 *
 * Absent board info means "not a VPP target, or not resolved yet" — the native
 * screen shows, which is the correct default: the runtime provides the feature
 * unless a vendor has taken it over.
 */
export function isNativeScreenAvailable(
  board: BoardInfo | null | undefined,
  screen: NativeScreenId,
): boolean {
  return !hiddenNativeScreens(board).has(screen)
}
