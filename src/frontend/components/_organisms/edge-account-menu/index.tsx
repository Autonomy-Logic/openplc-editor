import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LayoutDashboard, LogOut, Settings, User } from 'lucide-react'
import type { ReactNode } from 'react'

import type { EdgeUser } from '../../../../middleware/shared/ports/edge-account-port'
import { cn } from '../../../utils/cn'
import { EdgeAvatar } from '../../_atoms/edge-avatar'

interface EdgeAccountMenuProps {
  user: EdgeUser
  planCaption?: string | null
  onSignOut: () => void
  /** Origin of the Edge SPA. A prop, since the mirrored desktop editor has no such environment. */
  edgeBaseUrl: string
  avatarClassName?: string
  label?: ReactNode
  triggerClassName?: string
  /** Defaults to `right`: in the ~48px activity bar a menu dropping down is clipped on short viewports. */
  side?: 'right' | 'bottom'
}

const ITEM_CLASSES =
  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
const ICON_CLASSES = 'h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400'
const LABEL_CLASSES = 'text-sm text-neutral-900 dark:text-neutral-100'

const EdgeAccountMenu = ({
  user,
  planCaption,
  onSignOut,
  edgeBaseUrl,
  side = 'right',
  avatarClassName,
  label,
  triggerClassName,
}: EdgeAccountMenuProps) => {
  const edgeBase = edgeBaseUrl
  // Same destinations as Edge's own dropdown. `/profile`, not `/{username}`: the latter is the public page.
  const dashboardUrl = new URL('/dashboard', edgeBase).toString()
  const profileUrl = new URL('/profile', edgeBase).toString()
  const settingsUrl = new URL('/profile/settings', edgeBase).toString()

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type='button'
          aria-label={`Account: ${user.name}`}
          className={cn(
            'cursor-pointer rounded-full outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-brand',
            triggerClassName,
          )}
        >
          <EdgeAvatar
            name={user.name}
            imageSrc={user.profileImage}
            customInitials={user.customInitials}
            initialsColor={user.initialsColor}
            className={avatarClassName}
          />
          {label}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align='end'
          sideOffset={12}
          className='z-50 w-72 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-800 dark:bg-neutral-900'
        >
          {/* blue-500/5 rather than brand/5: `brand` is a var() holding a hex, and
              Tailwind 3 cannot apply an opacity modifier to that. */}
          <div className='flex items-center gap-3 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5'>
            <EdgeAvatar
              className='size-10'
              name={user.name}
              imageSrc={user.profileImage}
              customInitials={user.customInitials}
              initialsColor={user.initialsColor}
            />
            {/* min-w-0 so the name and username truncate as one block instead of
                widening the menu. */}
            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100'>
                {user.name}
                <span className='ml-1 text-xs font-normal text-neutral-500 dark:text-neutral-400'>
                  ({user.username})
                </span>
              </div>
              {planCaption && (
                <div className='truncate text-[11px] text-neutral-500 dark:text-neutral-400'>{planCaption}</div>
              )}
            </div>
          </div>

          <DropdownMenu.Separator className='my-1.5 h-px bg-neutral-200 dark:bg-neutral-800' />

          {/* Account destinations. All live on Edge, so all open there. */}
          <div className='py-0.5'>
            <DropdownMenu.Item asChild>
              <a href={dashboardUrl} target='_blank' rel='noreferrer' className={ITEM_CLASSES}>
                <LayoutDashboard className={ICON_CLASSES} />
                <span className={LABEL_CLASSES}>Dashboard</span>
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a href={profileUrl} target='_blank' rel='noreferrer' className={ITEM_CLASSES}>
                <User className={ICON_CLASSES} />
                <span className={LABEL_CLASSES}>Profile</span>
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a href={settingsUrl} target='_blank' rel='noreferrer' className={ITEM_CLASSES}>
                <Settings className={ICON_CLASSES} />
                <span className={LABEL_CLASSES}>Settings</span>
              </a>
            </DropdownMenu.Item>
          </div>

          <DropdownMenu.Separator className='my-1.5 h-px bg-neutral-200 dark:bg-neutral-800' />

          <div className='py-0.5'>
            {/* Neutral, not red: Edge treats signing out as an ordinary item, and a
                red row here would read as destructive when nothing is lost by it. */}
            <DropdownMenu.Item onSelect={onSignOut} className={ITEM_CLASSES}>
              <LogOut className={ICON_CLASSES} />
              <span className={LABEL_CLASSES}>Sign out</span>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export { EdgeAccountMenu }
