import type { ReactNode } from 'react'

import type { AppUpdateStatus } from '../../../../middleware/shared/ports/app-update-port'
import { useAppUpdate } from '../../../../middleware/shared/providers'
import { useAppUpdateStatus } from '../../../hooks/use-app-update-status'

type StatusBarProps = {
  /** Left-hand items, such as the branch switcher. */
  children?: ReactNode
}

type ShownUpdate = Exclude<AppUpdateStatus, { state: 'none' }>

function updateLabel(update: ShownUpdate): { text: string; title: string } {
  switch (update.state) {
    case 'available':
      return {
        text: `Update to ${update.version}`,
        title: `Download OpenPLC Editor ${update.version} and open its installer`,
      }
    case 'downloading':
      return { text: `Downloading ${update.version}… ${update.percent}%`, title: 'The installer opens when it is done' }
    case 'downloaded':
      return { text: `Install ${update.version}`, title: `Open the OpenPLC Editor ${update.version} installer again` }
    default: {
      const unreachable: never = update
      return unreachable
    }
  }
}

/**
 * The bar along the bottom of the window. Items sit on the left; the editor's
 * "Update" button sits on the right once a newer version is out. With neither,
 * there is no bar, so a screen can always render it.
 */
export function StatusBar({ children }: StatusBarProps) {
  const appUpdate = useAppUpdate()
  const update = useAppUpdateStatus()
  const hasItems = children !== undefined && children !== null && children !== false
  const shown = update.state === 'none' || !appUpdate ? null : update

  if (!hasItems && !shown) return null

  const label = shown ? updateLabel(shown) : null

  return (
    <div
      role='status'
      className='flex h-6 w-full shrink-0 items-center justify-between gap-2 bg-brand-dark px-2 dark:bg-neutral-950'
    >
      <div className='flex min-w-0 items-center'>{children}</div>
      {shown && label && appUpdate && (
        <button
          type='button'
          onClick={() => appUpdate.downloadAndOpen()}
          disabled={shown.state === 'downloading'}
          className='shrink-0 rounded-sm bg-brand px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-brand-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-default disabled:opacity-80 disabled:hover:bg-brand'
          title={label.title}
        >
          {label.text}
        </button>
      )}
    </div>
  )
}
