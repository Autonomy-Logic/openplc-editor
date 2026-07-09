import { useSystem } from '@root/middleware/shared/providers/platform-context'
import { useEffect, useState } from 'react'

import { LicensePurchaseModal, type PurchaseStep } from './license-purchase-modal'
import { DEMO_MINUTES, getPhase, LICENSE_PRICE, type LicensePhase, mockHardwareId, setPhase } from './mock-license'

interface LicenseStatusBlockProps {
  /** Stable VPP identifier (the package id). */
  vppKey: string
  /** Human-readable board/VPP name shown in the purchase modal. */
  vppName: string
}

/**
 * License section on the Board Settings screen for VPP (vendor) boards.
 *
 * Offline-first (approved design): three inline phases — demo / purchase
 * started (pending) / licensed — plus the purchase modal (confirm → browser →
 * success/error). No background polling: after buying in the browser, the
 * license activates on the next upload (mocked here by "check now"). Driven by
 * mock data (`mock-license.ts`); swap for the real `LicensePort` in task E8.
 */
export const LicenseStatusBlock = ({ vppKey, vppName }: LicenseStatusBlockProps) => {
  const system = useSystem()
  const [phase, setPhaseState] = useState<LicensePhase>(() => getPhase(vppKey))
  const [step, setStep] = useState<PurchaseStep | null>(null)
  const [offline, setOffline] = useState(false)
  const deviceId = mockHardwareId(vppKey)

  useEffect(() => {
    setPhaseState(getPhase(vppKey))
  }, [vppKey])

  const changePhase = (next: LicensePhase) => {
    setPhase(vppKey, next)
    setPhaseState(next)
  }

  const confirmBuy = async () => {
    // Opens the buyer's browser at the Edge/Paddle checkout (mocked URL).
    const url = `https://example.com/paddle-checkout-mock?device=${encodeURIComponent(deviceId)}`
    try {
      await system.openExternalLink(url)
    } catch {
      // mock: ignore failures to open the browser
    }
    changePhase('pending')
    setStep('browser')
  }

  // "I've paid — check now" / next upload: activate, or fail if offline.
  const verifyNow = () => setStep(offline ? 'error' : 'success')

  return (
    <div id='license-status' className='flex w-full flex-col items-start justify-start gap-2'>
      <span className='w-fit select-none text-xs font-medium text-neutral-950 dark:text-white'>License</span>

      {phase === 'demo' && (
        <div className='flex w-full flex-col items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3'>
          <span className='font-caption text-cp-sm text-amber-700 dark:text-amber-400'>
            ⚠ Demo mode — the driver stops after {DEMO_MINUTES} min.
          </span>
          <button
            type='button'
            onClick={() => setStep('confirm')}
            className='h-[30px] rounded-md bg-brand px-4 font-caption text-cp-sm font-medium text-white hover:bg-brand-medium-dark'
          >
            Buy license — {LICENSE_PRICE}
          </button>
          <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
            One-time payment · tied to this device
          </span>
        </div>
      )}

      {phase === 'pending' && (
        <div className='flex w-full flex-col items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 p-3'>
          <span className='font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>
            Purchase started in your browser
          </span>
          <span className='text-xs leading-relaxed text-neutral-600 dark:text-neutral-300'>
            Once payment completes, the license activates on the next upload to this device (online). You stay in demo
            until then.
          </span>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={verifyNow}
              className='h-[30px] rounded-md bg-neutral-100 px-4 font-caption text-cp-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-white dark:hover:bg-neutral-800'
            >
              I&apos;ve paid — check now
            </button>
            <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>No background checks</span>
          </div>
          <label className='flex items-center gap-2 text-[11px] text-neutral-400 dark:text-neutral-500'>
            <input type='checkbox' checked={offline} onChange={(event) => setOffline(event.target.checked)} />
            Simulate offline (demo)
          </label>
        </div>
      )}

      {phase === 'licensed' && (
        <div className='flex w-full flex-col items-start gap-1 rounded-md border border-green-500/30 bg-green-500/10 p-3'>
          <div className='flex items-center gap-2'>
            <span className='font-caption text-cp-sm font-medium text-green-700 dark:text-green-400'>
              ✓ Driver licensed to this device
            </span>
            <span className='rounded bg-green-500/20 px-2 py-[1px] text-[11px] font-semibold text-green-700 dark:text-green-400'>
              Active
            </span>
          </div>
          <span className='text-xs leading-relaxed text-neutral-600 dark:text-neutral-300'>
            Stored on the hardware — works offline, no time limit, tied to this device (not your account).
          </span>
          <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>HW-ID {deviceId}</span>
        </div>
      )}

      <LicensePurchaseModal
        step={step}
        vppName={vppName}
        deviceId={deviceId}
        onConfirm={() => void confirmBuy()}
        onBrowserAck={() => setStep(null)}
        onFinish={() => {
          changePhase('licensed')
          setStep(null)
        }}
        onRetry={verifyNow}
        onClose={() => setStep(null)}
      />
    </div>
  )
}
