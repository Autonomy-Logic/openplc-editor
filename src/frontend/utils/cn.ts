import { ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Class merger that knows this project's custom `cp-*` font scale.
 *
 * Plain `twMerge` does not. Faced with `text-cp-sm text-white` it cannot tell that
 * the first is a size, assumes both are text colours, and keeps only the last --
 * silently dropping the size. Anything styled that way rendered at the browser
 * default instead: the Connect button came out visibly larger than its
 * neighbours, with no warning and no build error. Buttons that escaped it did so
 * only by passing a plain string instead of calling this.
 *
 * Declaring the scale here fixes every call site at once, rather than each caller
 * having to know that its size class might evaporate. Keep this list in step with
 * `fontSize` in tailwind.config.ts.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['cp-xs', 'cp-sm', 'cp-base'] }],
    },
  },
})

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
