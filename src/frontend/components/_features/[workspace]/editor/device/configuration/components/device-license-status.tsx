/**
 * Licence status for the device screen: a quiet, monochrome line next to
 * "Connected", plus a details panel with the device id and the actions the
 * outcome warrants.
 *
 * WHAT "LICENSED" IS ALLOWED TO MEAN HERE. It means the main process read the
 * blob off the device (FC 0x4A) and verified its magic, crc32, `deviceId` and
 * `productId` — i.e. the device HOLDS a well-formed licence for this board and
 * this VPP. The ECDSA signature and the key id are NOT checked (only the closed
 * license-core can), so a blob signed by a key the board does not trust would
 * read "Licensed" here and the board would still run demo.
 *
 * Therefore every label in this component is about POSSESSION — Licensed / Not
 * licensed / Licence check failed — and never about EXECUTION. No string here may
 * say "full mode", "unlocked" or "running in demo": the editor cannot know that.
 *
 * THREE states, deliberately not two. "Not licensed" is an ANSWER; "Licence check
 * failed" is the ABSENCE of one. Collapsing them either tells a paying customer to
 * buy again or hides a real failure behind a reassuring badge.
 */

import * as Popover from '@radix-ui/react-popover'
import type { DeviceLicenseReport } from '@root/middleware/shared/ports/device-port'
import { useState } from 'react'

import { cn } from '../../../../../../../utils/cn'

/** Filled shield + check — "this device holds a licence". */
function ShieldLicensedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M8 1.5 13 3.2v4.1c0 3.2-2.1 6-5 7.2-2.9-1.2-5-4-5-7.2V3.2L8 1.5Z' fill='currentColor' />
      <path d='M5.8 8.1 7.2 9.5l3-3.1' stroke='#fff' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}

/** Outline shield + dash — "no licence on this device". */
function ShieldUnlicensedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path
        d='M8 1.5 13 3.2v4.1c0 3.2-2.1 6-5 7.2-2.9-1.2-5-4-5-7.2V3.2L8 1.5Z'
        stroke='currentColor'
        strokeWidth='1.3'
      />
      <path d='M5.9 8h4.2' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' />
    </svg>
  )
}

/** Outline shield + question — "we could not tell". */
function ShieldUnknownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path
        d='M8 1.5 13 3.2v4.1c0 3.2-2.1 6-5 7.2-2.9-1.2-5-4-5-7.2V3.2L8 1.5Z'
        stroke='currentColor'
        strokeWidth='1.3'
      />
      <path
        d='M6.7 6.3a1.3 1.3 0 0 1 2.6.2c0 .9-1.3 1-1.3 2'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      />
      <circle cx='8' cy='10.7' r='0.65' fill='currentColor' />
    </svg>
  )
}

export interface DeviceLicenseStatusProps {
  /** Null before any licensing call has landed — nothing is rendered. */
  report: DeviceLicenseReport | null
  isChecking: boolean
  /** Null when no valid purchase link can be built; the button is then hidden. */
  buyUrl: string | null
  onBuy: () => void
  onRecheck: () => void
}

/** The label + icon for an outcome. One place, so no branch can drift. */
function describeOutcome(report: DeviceLicenseReport): {
  label: string
  Icon: typeof ShieldLicensedIcon
  /** Whether the label reads as a definitive negative (drives the dashed underline). */
  negative: boolean
  detail: string
} {
  switch (report.outcome.state) {
    case 'licensed':
      return {
        label: 'Licensed',
        Icon: ShieldLicensedIcon,
        negative: false,
        detail:
          report.outcome.how === 'activated'
            ? 'A licence was just written to this device and read back to confirm it.'
            : 'This device is holding a licence issued for it and for this VPP.',
      }
    case 'unlicensed':
      return {
        label: 'Not licensed',
        Icon: ShieldUnlicensedIcon,
        negative: true,
        detail: report.outcome.entitlementChecked
          ? `No licence is registered for this device.${
              report.outcome.backendReason ? ` The licence server said: ${report.outcome.backendReason}` : ''
            }`
          : 'This device is not holding a valid licence. Nobody has checked yet whether one was purchased for it.',
      }
    case 'unsupported':
      // The label points at the FIRMWARE, not the board. "Not storable" read as a
      // hardware limitation and cost a debugging session on a NodeMCU that stores
      // licences fine — the image was simply built without the backend.
      return {
        label: 'Storage missing',
        Icon: ShieldUnknownIcon,
        negative: false,
        detail:
          'The firmware running on this device reports no licence storage. This hardware supports it, ' +
          'so the image was built without the storage backend — rebuild and upload.',
      }
    case 'check-failed':
      return {
        label: 'Licence check failed',
        Icon: ShieldUnknownIcon,
        negative: false,
        detail: `${report.outcome.error}\n\nThis is not the same as having no licence — nothing on the device has changed.`,
      }
  }
}

export function DeviceLicenseStatus({ report, isChecking, buyUrl, onBuy, onRecheck }: DeviceLicenseStatusProps) {
  const [copied, setCopied] = useState(false)

  // Nothing has run: every non-licensable board stays here, and so does a
  // licensable one before Connect. Showing a placeholder badge would invite the
  // user to read meaning into a check that never happened.
  if (!report) {
    return isChecking ? (
      <span className='font-caption text-cp-xs font-medium text-neutral-500 dark:text-neutral-500'>
        Checking licence…
      </span>
    ) : null
  }

  const { label, Icon, negative, detail } = describeOutcome(report)
  const deviceId = report.deviceId

  // The purchase button appears ONLY where buying is the honest next step: the
  // backend was asked and reported no entitlement. On `check-failed` or an
  // unchecked `unlicensed` it would be a guess, and a costly one.
  const offerPurchase = !!buyUrl && report.outcome.state === 'unlicensed' && report.outcome.entitlementChecked === true

  return (
    // Radix Popover, PORTALLED. The details used to be a conditional <div> in the
    // flow, which is what broke the layout: opening it pushed "Specs" and the
    // board image down and displaced the Connected label, because the panel is
    // ~140px tall and this badge sits inside the connect row. A portalled popover
    // is out of the flow entirely, so the row never changes height.
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type='button'
          aria-label='Licence status'
          className={cn(
            'flex w-fit items-center gap-1 font-caption text-cp-xs font-medium outline-none',
            negative
              ? 'text-neutral-700 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white'
              : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white',
          )}
        >
          {isChecking ? <ShieldUnknownIcon size={10} /> : <Icon size={10} />}
          <span className={cn(negative && 'border-b border-dashed border-neutral-400 dark:border-neutral-700')}>
            {isChecking ? 'Checking licence…' : label}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={8}
          // Fixed width so the panel's own content can never stretch the trigger
          // row, and a high z so it clears the board image next to it.
          className='box z-[100] flex w-[300px] flex-col gap-3 rounded-lg bg-white p-4 dark:bg-neutral-950'
        >
          <div className='flex items-center gap-2.5'>
            <span className='flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md border border-neutral-100 text-neutral-950 dark:border-neutral-850 dark:text-white'>
              <Icon />
            </span>
            <div className='min-w-0'>
              <p className='font-caption text-cp-base font-semibold text-neutral-950 dark:text-white'>{label}</p>
              <p className='whitespace-pre-line break-words font-caption text-cp-sm text-neutral-600 dark:text-neutral-400'>
                {detail}
              </p>
            </div>
          </div>

          {deviceId ? (
            <div className='flex flex-col gap-1'>
              <span className='font-caption text-cp-xs text-neutral-500 dark:text-neutral-500'>Device ID</span>
              <div className='flex items-start gap-2'>
                <code className='min-w-0 break-all font-mono text-cp-xs text-neutral-700 dark:text-neutral-300'>
                  {deviceId}
                </code>
                <button
                  type='button'
                  className='shrink-0 font-caption text-cp-xs text-brand hover:underline'
                  onClick={() => {
                    // The id is what a support ticket needs, and what the purchase
                    // page accepts pasted. Copy failures are silent on purpose:
                    // clipboard permission is not something the user can act on
                    // here, and the id is selectable next to the button anyway.
                    void navigator.clipboard?.writeText(deviceId).then(
                      () => setCopied(true),
                      () => undefined,
                    )
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ) : null}

          <div className='flex items-center gap-3'>
            <button
              type='button'
              disabled={isChecking}
              onClick={onRecheck}
              className='font-caption text-cp-xs text-neutral-600 hover:underline disabled:opacity-50 dark:text-neutral-400'
            >
              Check again
            </button>
            {offerPurchase ? (
              <button type='button' onClick={onBuy} className='font-caption text-cp-xs text-brand hover:underline'>
                Buy licence
              </button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
