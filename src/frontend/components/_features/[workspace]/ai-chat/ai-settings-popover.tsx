import * as Popover from '@radix-ui/react-popover'
import * as Switch from '@radix-ui/react-switch'

import { useOpenPLCStore } from '../../../../store'
import type { AIPreferences } from '../../../../store/slices/ai/types'

const PREFERENCES_STORAGE_KEY = 'ai-preferences-v1'

function persistPreferences(prefs: AIPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage can throw (quota, disabled) — preference change is still reflected
    // in memory via the store, we just won't survive a reload.
  }
}

export const AISettingsPopover = () => {
  const preferences = useOpenPLCStore.useAi().preferences
  const { setPreference } = useOpenPLCStore.useAiActions()

  const handleInlineToggle = (enabled: boolean) => {
    setPreference('inlineCompletionsEnabled', enabled)
    persistPreferences({ ...preferences, inlineCompletionsEnabled: enabled })
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label='AI settings'
        title='AI settings'
        className='grid h-[26px] w-[26px] place-items-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
      >
        <svg
          width='15'
          height='15'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.75'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <circle cx='12' cy='12' r='3' />
          <path d='M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align='end'
          className='z-50 w-64 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900'
        >
          <div className='mb-2 text-xs font-semibold text-neutral-800 dark:text-neutral-100'>AI Settings</div>

          <div className='flex items-start justify-between gap-3'>
            <label htmlFor='ai-inline-completions-toggle' className='flex-1 cursor-pointer'>
              <div className='text-xs font-medium text-neutral-700 dark:text-neutral-200'>
                Inline suggestions in editor
              </div>
              <div className='mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400'>
                Show AI code suggestions as you type.
              </div>
            </label>
            <Switch.Root
              id='ai-inline-completions-toggle'
              checked={preferences.inlineCompletionsEnabled}
              onCheckedChange={handleInlineToggle}
              className='relative mt-0.5 h-4 w-[29px] shrink-0 cursor-pointer rounded-full bg-neutral-300 outline-none transition-all duration-150 data-[state=checked]:bg-brand dark:bg-neutral-700 dark:data-[state=checked]:bg-brand'
            >
              <Switch.Thumb className='block h-[14px] w-[14px] translate-x-0.5 rounded-full bg-white shadow transition-all duration-150 will-change-transform data-[state=checked]:translate-x-[14px]' />
            </Switch.Root>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
