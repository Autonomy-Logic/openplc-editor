/**
 * Tiny decoupled bridge for the CONNECT flow (D72). The device screen's
 * "no firmware" dialog lives in `board.tsx`, but Build & Upload lives in the
 * workspace activity bar (`default.tsx`). Rather than hoist build state up or
 * thread refs across the component tree, the dialog fires a DOM CustomEvent the
 * activity bar listens for. Same window, synchronous dispatch — no payload.
 */
const FLASH_REQUEST_EVENT = 'openplc:device-flash-request'

/** Ask the workspace activity bar to run Build & Upload (flash the firmware). */
export function requestDeviceFlash(): void {
  window.dispatchEvent(new CustomEvent(FLASH_REQUEST_EVENT))
}

/**
 * Subscribe to flash requests. Returns an unsubscribe function suitable for a
 * React effect cleanup.
 */
export function onDeviceFlashRequest(handler: () => void): () => void {
  const listener = (): void => handler()
  window.addEventListener(FLASH_REQUEST_EVENT, listener)
  return () => window.removeEventListener(FLASH_REQUEST_EVENT, listener)
}
