import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { DEFAULT_CONTACT_BLOCK_HEIGHT, DEFAULT_CONTACT_BLOCK_WIDTH, DEFAULT_CONTACT_TYPES } from './utils/constants'

export type ContactVisualProps = {
  variant: string
  selected?: boolean
  wrongVariable?: boolean
  debuggerStrokeColor?: string
  className?: string
  /** Optional slot to replace the default variable name text (e.g. with a HighlightedTextArea) */
  nameSlot?: ReactNode
  /** Variable name displayed above the contact (used when nameSlot is not provided) */
  variableName?: string
}

export const ContactVisual = ({
  variant,
  selected = false,
  wrongVariable = false,
  debuggerStrokeColor,
  className,
  nameSlot,
  variableName,
}: ContactVisualProps) => {
  const contact = DEFAULT_CONTACT_TYPES[variant as keyof typeof DEFAULT_CONTACT_TYPES] ?? DEFAULT_CONTACT_TYPES.default

  return (
    <div
      className={cn(
        'relative rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[3px] hover:outline-brand',
        {
          'outline outline-2 outline-offset-[3px] outline-brand': selected,
        },
        className,
      )}
      style={{ width: DEFAULT_CONTACT_BLOCK_WIDTH, height: DEFAULT_CONTACT_BLOCK_HEIGHT }}
    >
      {contact.svg(wrongVariable, debuggerStrokeColor)}
      {nameSlot !== undefined
        ? nameSlot
        : variableName && (
            <div className='absolute -top-5 left-1/2 w-[72px] -translate-x-1/2'>
              <div className='truncate text-center text-xs leading-3 text-neutral-1000 dark:text-neutral-50'>
                {variableName}
              </div>
            </div>
          )}
    </div>
  )
}
