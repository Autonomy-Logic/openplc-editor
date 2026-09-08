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
 * Dismissing a quick pick cancels its token, and the delayers unwound by
 * that cancellation reject with no `catch` behind them. Nothing is wrong,
 * but the renderer reports every one as an unhandled rejection.
 */
export function installMonacoCancellationGuard(): () => void {
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isMonacoCancellation(event.reason)) event.preventDefault()
  }
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => window.removeEventListener('unhandledrejection', onUnhandledRejection)
}
