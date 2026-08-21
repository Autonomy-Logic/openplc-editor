import { useState } from 'react'

import { cn } from '../../../utils/cn'
import { resolveInitials } from './resolve-initials'

/**
 * The signed-in user's picture, mirroring how Edge renders it.
 *
 * Reimplemented rather than imported: the Edge avatar lives in
 * `@autonomy-edge/design-system`, which is a package of a different repository
 * that this project does not depend on. The behaviour is what has to match —
 * photo when there is one, otherwise initials over the colour the account picked
 * — so the same user looks the same in both apps.
 */
interface EdgeAvatarProps {
  name: string
  imageSrc?: string | null
  customInitials?: string | null
  initialsColor?: string | null
  className?: string
}

const EdgeAvatar = ({ name, imageSrc, customInitials, initialsColor, className }: EdgeAvatarProps) => {
  // A profileImage URL can 404 (deleted upload, expired link). Falling back to
  // initials keeps a broken-image icon out of the title bar.
  //
  // The failed URL is remembered, not a boolean: a user who replaces their photo
  // arrives here with a different `imageSrc`, and a flag would keep showing
  // initials for a URL that was never actually tried.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(imageSrc) && imageSrc !== failedSrc

  return (
    <span
      // `cn`, not string concatenation: a caller passing `size-10` has to actually
      // override the `size-7` here, and with plain concatenation both survive and
      // CSS declaration order decides — which is not the caller's intent.
      className={cn(
        'relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full',
        className,
      )}
      style={initialsColor && !showImage ? { backgroundColor: initialsColor } : undefined}
    >
      {showImage ? (
        <img
          src={imageSrc ?? undefined}
          alt={name}
          className='size-full object-cover'
          onError={() => setFailedSrc(imageSrc ?? null)}
        />
      ) : (
        <span
          aria-hidden
          className={`text-[11px] font-medium ${
            initialsColor ? 'text-white' : 'bg-neutral-300 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'
          } flex size-full items-center justify-center`}
        >
          {resolveInitials(name, customInitials)}
        </span>
      )}
    </span>
  )
}

export { EdgeAvatar }
