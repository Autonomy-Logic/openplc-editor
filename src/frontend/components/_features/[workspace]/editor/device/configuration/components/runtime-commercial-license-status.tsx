/**
 * Commercial licence of the connected runtime, next to "Connected" on the
 * device screen: "Commercial license" or "GPLv3", with the disclaimer, the
 * hardware ID and the purchase link in a popover. Renders nothing while the
 * status is unknown or a paid VPP's own licence flow is speaking.
 */

import * as Popover from '@radix-ui/react-popover'
import { COMMERCIAL_LICENSE_DISCLAIMER } from '@root/middleware/shared/utils/licensing'
import { useState } from 'react'

import type { RuntimeCommercialLicenseView } from '../../../../../../../hooks/use-runtime-commercial-license'
import { cn } from '../../../../../../../utils/cn'
import { ShieldLicensedIcon, ShieldUnlicensedIcon } from './device-license-status'

type RuntimeCommercialLicenseStatusProps = Pick<
  RuntimeCommercialLicenseView,
  'status' | 'hardwareId' | 'buyUrl' | 'awaitingPurchase'
> & { onBuy: () => void }

export function RuntimeCommercialLicenseStatus({
  status,
  hardwareId,
  buyUrl,
  awaitingPurchase,
  onBuy,
}: RuntimeCommercialLicenseStatusProps) {
  const [copied, setCopied] = useState(false)
  if (status !== 'licensed' && status !== 'unlicensed') return null

  const licensed = status === 'licensed'
  const Icon = licensed ? ShieldLicensedIcon : ShieldUnlicensedIcon
  const label = licensed ? 'Commercial license' : awaitingPurchase ? 'Waiting for purchase…' : 'GPLv3'

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type='button'
          aria-label='Runtime license status'
          className='flex w-fit items-center gap-1 font-caption text-cp-xs font-medium text-neutral-600 outline-none hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white'
        >
          <Icon size={10} />
          <span className={cn(!licensed && 'border-b border-dashed border-neutral-400 dark:border-neutral-700')}>
            {label}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={8}
          className='box z-[100] flex w-[320px] flex-col gap-3 rounded-lg bg-white p-4 dark:bg-neutral-950'
        >
          <div className='flex items-start gap-2.5'>
            <span className='flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md border border-neutral-100 text-neutral-950 dark:border-neutral-850 dark:text-white'>
              <Icon />
            </span>
            <div className='min-w-0'>
              <p className='font-caption text-cp-base font-semibold text-neutral-950 dark:text-white'>
                {licensed ? 'Commercial license' : 'No commercial license'}
              </p>
              <p className='break-words font-caption text-cp-sm text-neutral-600 dark:text-neutral-400'>
                {licensed
                  ? 'The OpenPLC Runtime on this target is covered by a commercial license.'
                  : COMMERCIAL_LICENSE_DISCLAIMER}
              </p>
            </div>
          </div>

          {hardwareId ? (
            <div className='flex flex-col gap-1'>
              <span className='font-caption text-cp-xs text-neutral-500 dark:text-neutral-500'>Hardware ID</span>
              <div className='flex items-start gap-2'>
                <code className='min-w-0 break-all font-mono text-cp-xs text-neutral-700 dark:text-neutral-300'>
                  {hardwareId}
                </code>
                <button
                  type='button'
                  className='shrink-0 font-caption text-cp-xs text-brand hover:underline'
                  onClick={() => {
                    void navigator.clipboard?.writeText(hardwareId).then(
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

          {!licensed && awaitingPurchase ? (
            <p className='font-caption text-cp-sm text-neutral-600 dark:text-neutral-400'>
              Waiting for the purchase to complete. OpenPLC keeps checking for up to ten minutes and installs the
              license on this target as soon as the purchase clears.
            </p>
          ) : null}

          {!licensed && buyUrl && !awaitingPurchase ? (
            <button type='button' onClick={onBuy} className='w-fit font-caption text-cp-xs text-brand hover:underline'>
              Buy licences
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
