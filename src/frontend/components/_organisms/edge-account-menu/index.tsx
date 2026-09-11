import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LayoutDashboard, LogOut, Settings, User } from 'lucide-react'
import type { ReactNode } from 'react'

import type { EdgeUser } from '../../../../middleware/shared/ports/edge-account-port'
import { cn } from '../../../utils/cn'
import { EdgeAvatar } from '../../_atoms/edge-avatar'

/**
 * The signed-in user's menu, built to Edge's user-dropdown pattern: a tinted
 * header card identifying the account, then sections of icon-and-label items
 * separated by rules, with Sign out last.
 *
 * Same pattern, not the same code: Edge's version lives in a design system this
 * repo cannot import, so the treatment is rebuilt from the palette available here
 * in place of Edge's `primary`/`muted` tokens.
 *
 * Signing out ends the ONE session both apps share, so Edge goes too. That is the
 * point of this menu existing in the editor at all.
 *
 * Deliberately fewer items than Edge's. Context switching, Admin, Forum, What's
 * new and the theme toggle are either Edge-only concerns or features this app does
 * not have; inventing entries to pad out the shape would give the user dead ends.
 */
interface EdgeAccountMenuProps {
  user: EdgeUser
  /**
   * e.g. `Pro Plan`. Omitted from the card when null rather than replaced with a
   * guess, which is how Edge handles an account with no active subscription.
   */
  planCaption?: string | null
  onSignOut: () => void
  /**
   * Origin of the Edge SPA. Passed in rather than read from the environment: this
   * component lives in a surface the desktop editor mirrors, where no such
   * environment exists.
   */
  edgeBaseUrl: string
  /**
   * Size/shape for the trigger avatar.
   *
   * The activity bar wants the default — it is a column of its own and the avatar is
   * the whole control. The start screen is a text menu whose icons are 20px, and an
   * avatar that ignores that reads as misaligned rather than prominent.
   */
  avatarClassName?: string
  /**
   * Rendered inside the trigger, after the avatar.
   *
   * Exists so the whole row can be the trigger rather than just the avatar. In the
   * activity bar a bare avatar is an obvious target, because it is the only thing in
   * its column. In a text menu the name sits right beside it and is what a person
   * actually aims at — leaving that outside the trigger means clicking the obvious
   * place does nothing.
   */
  label?: ReactNode
  /** Trigger geometry, for a caller that needs it to match a row of other controls. */
  triggerClassName?: string
  /**
   * Which way the menu opens. Defaults to `right` because this lives in the
   * activity bar, a ~48px strip — a menu dropping straight down would be clipped
   * by the window edge on short viewports.
   */
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
  // Same destinations Edge's own dropdown navigates to. `/profile` rather than
  // `/{username}`: the latter is the public profile page, not the account one the
  // menu item means. `/dashboard` redirects itself to `/{slug}/dashboard`.
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
          {/* Header card. The tint marks the account as this menu's subject rather
              than one of its actions, the same way Edge treats it. Uses the palette
              blue with an opacity modifier — the idiom the activity bar already
              uses for its own highlights — rather than `brand/5`, because `brand`
              resolves to a `var()` holding a hex and Tailwind 3 cannot reliably
              apply an opacity modifier to that. */}
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
