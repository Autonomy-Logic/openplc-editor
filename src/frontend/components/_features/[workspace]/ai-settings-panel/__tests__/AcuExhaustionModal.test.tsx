import { fireEvent, render, screen } from '@testing-library/react'

import type { BillingErrorPayload } from '../../../../../../middleware/shared/ports/types'
import { AcuExhaustionModal } from '../AcuExhaustionModal'

const TEST_UPGRADE_URL = 'http://localhost:5173/profile/settings?tab=usage'

const insufficientAcu: BillingErrorPayload = {
  code: 'insufficient_acu',
  message: 'Out of ACU — upgrade to keep chatting',
  remaining: 0,
  required: 12,
  monthlyLimit: 613,
}

const subscriptionInactive: BillingErrorPayload = {
  code: 'subscription_inactive',
  message: 'Your subscription was canceled. Reactivate to continue.',
  subscriptionStatus: 'canceled',
  reactivateUrl: 'https://billing.example/reactivate',
}

describe('AcuExhaustionModal', () => {
  it('renders nothing when billingError is null', () => {
    const { container } = render(
      <AcuExhaustionModal billingError={null} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the "Out of ACU" variant with frontend copy + ACU figures', () => {
    render(<AcuExhaustionModal billingError={insufficientAcu} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />)
    expect(screen.getByText("You're out of ACU")).toBeTruthy()
    // Frontend copy — ignores the backend message which still mentions the
    // descoped Haiku quick-switch.
    expect(screen.getByText(/used all 613 ACU.*Buy more ACU or upgrade your plan/)).toBeTruthy()
    expect(screen.getByText(/This request needed 12 ACU; only 0 remaining/)).toBeTruthy()
    const cta = screen.getByTestId('acu-exhaustion-cta') as HTMLAnchorElement
    expect(cta.textContent).toBe('Upgrade plan')
    expect(cta.href).toBe(TEST_UPGRADE_URL)
  })

  it('renders the "Subscription required" variant with reactivate CTA pointing at reactivateUrl', () => {
    render(<AcuExhaustionModal billingError={subscriptionInactive} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />)
    expect(screen.getByText('Subscription required')).toBeTruthy()
    // Frontend copy — uses subscriptionStatus, ignores the backend message.
    expect(screen.getByText(/Your subscription is canceled.*Reactivate it to keep using AI features/)).toBeTruthy()
    const cta = screen.getByTestId('acu-exhaustion-cta') as HTMLAnchorElement
    expect(cta.textContent).toBe('Reactivate subscription')
    expect(cta.href).toBe('https://billing.example/reactivate')
  })

  it('falls back to upgradeUrl when subscription_inactive has no reactivateUrl', () => {
    const noReactivate: BillingErrorPayload = {
      code: 'subscription_inactive',
      message: 'paused',
      subscriptionStatus: 'paused',
    }
    render(
      <AcuExhaustionModal
        billingError={noReactivate}
        onDismiss={vi.fn()}
        upgradeUrl='https://override.example/billing'
      />,
    )
    const cta = screen.getByTestId('acu-exhaustion-cta') as HTMLAnchorElement
    expect(cta.href).toBe('https://override.example/billing')
  })

  it('ignores the backend `message` field — frontend composes its own copy', () => {
    // Backend's `CreditGuard` still emits "Switch to Haiku..." text from the
    // descoped DOPE-288 era. The modal must not surface that to the user.
    const stalePayload: BillingErrorPayload = {
      ...insufficientAcu,
      message: 'Switch to Haiku to use fewer credits, or upgrade your plan.',
    }
    render(<AcuExhaustionModal billingError={stalePayload} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />)
    expect(screen.queryByText(/Switch to Haiku/)).toBeNull()
    expect(screen.getByText(/Buy more ACU or upgrade your plan/)).toBeTruthy()
  })

  it('falls back to a generic out-of-ACU description when monthlyLimit is missing', () => {
    render(
      <AcuExhaustionModal
        billingError={{ code: 'insufficient_acu', message: '' }}
        onDismiss={vi.fn()}
        upgradeUrl={TEST_UPGRADE_URL}
      />,
    )
    expect(screen.getByText(/out of ACU for this billing period/)).toBeTruthy()
  })

  it('omits the "needed N / M remaining" line when remaining/required are missing', () => {
    render(
      <AcuExhaustionModal
        billingError={{ code: 'insufficient_acu', message: 'short body' }}
        onDismiss={vi.fn()}
        upgradeUrl={TEST_UPGRADE_URL}
      />,
    )
    expect(screen.queryByText(/needed.*remaining/)).toBeNull()
  })

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    render(<AcuExhaustionModal billingError={insufficientAcu} onDismiss={onDismiss} upgradeUrl={TEST_UPGRADE_URL} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when the upgrade CTA is clicked (so the modal closes after the link opens)', () => {
    const onDismiss = vi.fn()
    render(<AcuExhaustionModal billingError={insufficientAcu} onDismiss={onDismiss} upgradeUrl={TEST_UPGRADE_URL} />)
    fireEvent.click(screen.getByTestId('acu-exhaustion-cta'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('fires onUpgradeClick before dismissing so the consumer can emit telemetry', () => {
    const onDismiss = vi.fn()
    const onUpgradeClick = vi.fn()
    render(
      <AcuExhaustionModal
        billingError={insufficientAcu}
        onDismiss={onDismiss}
        upgradeUrl={TEST_UPGRADE_URL}
        onUpgradeClick={onUpgradeClick}
      />,
    )
    fireEvent.click(screen.getByTestId('acu-exhaustion-cta'))
    expect(onUpgradeClick).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    // onUpgradeClick must fire before onDismiss so the consumer's telemetry
    // helper can read fresh state before the slice clears.
    expect(onUpgradeClick.mock.invocationCallOrder[0]).toBeLessThan(onDismiss.mock.invocationCallOrder[0])
  })

  it('skips onUpgradeClick when the prop is not provided (back-compat for legacy callers)', () => {
    const onDismiss = vi.fn()
    render(<AcuExhaustionModal billingError={insufficientAcu} onDismiss={onDismiss} upgradeUrl={TEST_UPGRADE_URL} />)
    expect(() => fireEvent.click(screen.getByTestId('acu-exhaustion-cta'))).not.toThrow()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders the rate-limit variant with reset time + upgrade CTA', () => {
    const rateLimited: BillingErrorPayload = {
      code: 'rate_limit_exceeded',
      message: 'Too many AI requests in the recent window. Try again shortly.',
      resetsAt: '2026-06-01T18:30:00.000Z',
    }
    render(<AcuExhaustionModal billingError={rateLimited} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />)
    expect(screen.getByText('AI usage limit reached')).toBeTruthy()
    expect(screen.getByText(/reached the AI usage limit.*upgrade your plan for a higher limit/i)).toBeTruthy()
    // The reset line renders a locale-formatted timestamp; assert the prefix
    // (the exact date/time string is locale/timezone dependent).
    expect(screen.getByText(/Your usage window resets on /)).toBeTruthy()
    const cta = screen.getByTestId('acu-exhaustion-cta') as HTMLAnchorElement
    expect(cta.textContent).toBe('Upgrade plan')
    expect(cta.href).toBe(TEST_UPGRADE_URL)
  })

  it('omits the reset line for a rate-limit block with null resetsAt', () => {
    const rateLimited: BillingErrorPayload = {
      code: 'rate_limit_exceeded',
      message: 'Too many AI requests in the recent window. Try again shortly.',
      resetsAt: null,
    }
    render(<AcuExhaustionModal billingError={rateLimited} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />)
    expect(screen.getByText('AI usage limit reached')).toBeTruthy()
    expect(screen.queryByText(/Your usage window resets on/)).toBeNull()
  })

  it('omits the reset line when the rate-limit resetsAt is an unparseable string', () => {
    const rateLimited: BillingErrorPayload = {
      code: 'rate_limit_exceeded',
      message: 'Too many AI requests in the recent window. Try again shortly.',
      resetsAt: 'not-a-date',
    }
    render(<AcuExhaustionModal billingError={rateLimited} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />)
    expect(screen.queryByText(/Your usage window resets on/)).toBeNull()
  })

  it('uses dialog ARIA semantics (Radix Dialog)', () => {
    render(<AcuExhaustionModal billingError={insufficientAcu} onDismiss={vi.fn()} upgradeUrl={TEST_UPGRADE_URL} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
  })
})
