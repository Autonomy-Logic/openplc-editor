import type { ReactNode } from 'react'

import { useAppUpdate } from '../../../../middleware/shared/providers'
import { useAppUpdateStatus } from '../../../hooks/use-app-update-status'

type StatusBarProps = {
  /** Left-hand items, such as the branch switcher. */
  children?: ReactNode
}

/**
 * The bar along the bottom of the window. Items sit on the left; the editor's
 * "Update" button sits on the right once an update is downloaded and ready.
 * With neither, there is no bar, so a screen can always render it.
 */
export function StatusBar({ children }: StatusBarProps) {
  const appUpdate = useAppUpdate()
  const update = useAppUpdateStatus()
  const hasItems = children !== undefined && children !== null && children !== false

  if (!hasItems && update.state !== 'ready') return null

  return (
    <div
      role='status'
      className='flex h-6 w-full shrink-0 items-center justify-between gap-2 bg-brand-dark px-2 dark:bg-neutral-950'
    >
      <div className='flex min-w-0 items-center'>{children}</div>
      {update.state === 'ready' && appUpdate && (
        <button
          type='button'
          onClick={() => appUpdate.installAndRestart()}
          className='shrink-0 rounded-sm bg-brand px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-brand-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white'
          title={`Restart OpenPLC Editor to install version ${update.version}`}
        >
          Update to {update.version}
        </button>
      )}
    </div>
  )
}
