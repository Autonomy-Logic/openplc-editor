// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project

const CANCELED = 'Canceled'

/**
 * Monaco's own cancellation signal: `CancellationError` and the legacy
 * `canceled()` helper both set name and message to `Canceled`.
 */
export function isMonacoCancellation(reason: unknown): boolean {
  return reason instanceof Error && reason.name === CANCELED && reason.message === CANCELED
}

/**
 * Silence one cancellation event.
 *
 * `preventDefault` only drops the browser's own reporting; every other listener
 * on `window` still runs. `stopImmediatePropagation` stops the ones registered
 * after this guard — which is not all of them, so it is not a way to hide a
 * reporter that got in first. The dev overlay is exactly that case and is turned
 * off in `webpack.config.renderer.dev.ts` instead.
 */
function swallow(event: Event): void {
  event.preventDefault()
  event.stopImmediatePropagation()
}

/**
 * Cancelling a Monaco token rejects the work racing it, and nothing is behind
 * that rejection to catch it: disposing an inline-completion provider while a
 * request is in flight is the ordinary path here. Nothing is wrong, but the
 * renderer reports every one as a crash.
 */
export function installMonacoCancellationGuard(): () => void {
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isMonacoCancellation(event.reason)) swallow(event)
  }
  // Disposal cancels a token inside an emitter, which can rethrow synchronously:
  // that arrives as an uncaught error, not a rejection, so both listeners are needed.
  const onError = (event: ErrorEvent) => {
    if (isMonacoCancellation(event.error)) swallow(event)
  }
  // Capture phase, so an error retargeted at a descendant is still ours first.
  window.addEventListener('unhandledrejection', onUnhandledRejection, true)
  window.addEventListener('error', onError, true)
  return () => {
    window.removeEventListener('unhandledrejection', onUnhandledRejection, true)
    window.removeEventListener('error', onError, true)
  }
}
