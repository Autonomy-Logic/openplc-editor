import { ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows Tailwind's default scales. Our type scale adds
 * custom font sizes (`text-cp-xs` / `text-cp-sm` / `text-cp-base`, see
 * tailwind.config.ts). Without registering them, tailwind-merge can't tell
 * `text-cp-xs` is a font size, mistakes it for a `text-<color>` utility, and
 * silently DROPS it whenever a real text-color sits in the same class list —
 * so `cn('text-cp-xs', 'text-neutral-700')` used to collapse to just the color,
 * losing the size. Teaching it the `cp-*` sizes keeps size and color in their
 * own groups so both survive the merge.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['cp-xs', 'cp-sm', 'cp-base'] }],
    },
  },
})

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
