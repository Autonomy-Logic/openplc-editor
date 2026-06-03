import type { BillingErrorPayload } from '../../../../../middleware/shared/ports/types'
import { Modal, ModalContent, ModalHeader, ModalTitle } from '../../../_molecules/modal'

/**
 * Format the `rate_limit_exceeded` reset timestamp into a locale-aware
 * date+time string, or `null` when there's nothing valid to show (the
 * backend sends `null`/omits it when it can't compute a reset point).
 */
function formatResetTime(resetsAt?: string | null): string | null {
  if (!resetsAt) return null
  const ms = Date.parse(resetsAt)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export type AcuExhaustionModalProps = {
  /** Pulled from `ai.billingError`. Modal renders when non-null. */
  billingError: BillingErrorPayload | null
  /**
   * Called when the user dismisses the modal (close button, ESC, click
   * outside). Consumers typically wire this to `setBillingError(null)` so
   * the slice clears and the modal won't re-open until the next 402.
   */
  onDismiss: () => void
  /**
   * URL for the upgrade / reactivate CTA. The consumer is expected to
   * compose this from the edge-frontend origin + the right settings deep-
   * link (e.g. `${getEdgeFrontendBaseUrl()}/profile/settings?tab=usage`).
   * The `subscription_inactive` variant prefers its own `reactivateUrl`
   * from the 402 payload when present and falls back to this prop.
   */
  upgradeUrl: string
  /**
   * Optional callback fired right before the upgrade CTA navigates. Used
   * by the consumer to fire the `upgrade_cta_clicked` telemetry event;
   * left undefined in contexts (tests, future surfaces) that don't need it.
   */
  onUpgradeClick?: () => void
}

/**
 * Renders the right copy + CTA for whichever 402 variant landed on the
 * slice. Pure presentational: the workspace screen owns the slice
 * subscription and passes the payload + dismissal callback as props so
 * this component stays platform-agnostic and trivially testable in both
 * Vitest and Jest.
 */
export const AcuExhaustionModal = ({
  billingError,
  onDismiss,
  upgradeUrl,
  onUpgradeClick,
}: AcuExhaustionModalProps) => {
  if (!billingError) return null

  const isInactive = billingError.code === 'subscription_inactive'
  const isRateLimit = billingError.code === 'rate_limit_exceeded'
  const resetLabel = isRateLimit ? formatResetTime(billingError.resetsAt) : null

  const title = isRateLimit ? 'AI usage limit reached' : isInactive ? 'Subscription required' : "You're out of ACU"
  // Frontend-controlled copy: the backend `CreditGuard` message is geared
  // toward operators/logs and still references the (now-descoped) Haiku
  // model quick-switch from DOPE-288. We pull only the structured fields
  // (subscriptionStatus, monthlyLimit, resetsAt) and compose user-facing
  // text here.
  const description = isRateLimit
    ? 'You’ve reached the AI usage limit for the current window. Wait until it resets, or upgrade your plan for a higher limit and a larger context window.'
    : isInactive
      ? `Your subscription is ${billingError.subscriptionStatus ?? 'inactive'}. Reactivate it to keep using AI features.`
      : billingError.monthlyLimit != null
        ? `You've used all ${Math.round(billingError.monthlyLimit)} ACU for this billing period. Buy more ACU or upgrade your plan to keep going.`
        : "You're out of ACU for this billing period. Buy more ACU or upgrade your plan to keep going."
  const ctaLabel = isInactive ? 'Reactivate subscription' : 'Upgrade plan'
  // subscription_inactive carries its own reactivation URL; the other variants don't.
  const ctaUrl = isInactive && billingError.reactivateUrl ? billingError.reactivateUrl : upgradeUrl

  return (
    <Modal open onOpenChange={(open) => !open && onDismiss()}>
      <ModalContent
        data-testid='acu-exhaustion-modal'
        // `ModalContent` defaults to a 525×500 modal anchored via `inset-0`
        // for project-loading flows. Reset the inset cage and re-center via
        // translate so the modal wraps its actual content height instead of
        // stretching top-to-bottom.
        className='inset-auto left-1/2 top-1/2 m-0 h-auto w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 gap-3 p-6'
        onClose={onDismiss}
      >
        <ModalHeader>
          <ModalTitle className='text-[16px] font-semibold text-neutral-900 dark:text-white'>{title}</ModalTitle>
        </ModalHeader>
        <p className='text-[13px] leading-[1.5] text-neutral-600 dark:text-neutral-300'>{description}</p>
        {billingError.code === 'insufficient_acu' &&
          typeof billingError.remaining === 'number' &&
          typeof billingError.required === 'number' && (
            <p className='text-[12px] text-neutral-500 dark:text-neutral-400'>
              This request needed {Math.round(billingError.required)} ACU; only {Math.round(billingError.remaining)}{' '}
              remaining.
            </p>
          )}
        {isRateLimit && resetLabel && (
          <p className='text-[12px] text-neutral-500 dark:text-neutral-400'>
            Your usage window resets on {resetLabel}.
          </p>
        )}
        <div className='mt-2 flex items-center justify-end gap-2'>
          <button
            type='button'
            onClick={onDismiss}
            className='rounded px-3 py-1.5 text-[13px] text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/[0.06] dark:hover:text-white'
          >
            Dismiss
          </button>
          <a
            href={ctaUrl}
            target='_blank'
            rel='noreferrer'
            onClick={() => {
              onUpgradeClick?.()
              onDismiss()
            }}
            data-testid='acu-exhaustion-cta'
            className='cursor-pointer rounded bg-brand px-3 py-1.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-blue-600'
          >
            {ctaLabel}
          </a>
        </div>
      </ModalContent>
    </Modal>
  )
}
