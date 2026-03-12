import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils'

import { ActivityBarButton } from '../../../_atoms/buttons'

export const ChatButton = () => {
  const { isChatOpen, isEnabled, hasConsented } = useOpenPLCStore.useAi()
  const { toggleChat } = useOpenPLCStore.useAiActions()

  if (!isEnabled || !hasConsented) return null

  return (
    <ActivityBarButton
      aria-label='AI Chat'
      onClick={toggleChat}
      className={cn(isChatOpen && 'bg-brand-medium-dark dark:bg-neutral-700')}
    >
      <svg
        width='20'
        height='20'
        viewBox='0 0 20 20'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        className='stroke-white'
      >
        <path
          d='M3 4C3 3.44772 3.44772 3 4 3H16C16.5523 3 17 3.44772 17 4V13C17 13.5523 16.5523 14 16 14H7L3 17V4Z'
          strokeWidth='1.5'
          strokeLinejoin='round'
        />
        <path d='M7 7H13' strokeWidth='1.5' strokeLinecap='round' />
        <path d='M7 10H11' strokeWidth='1.5' strokeLinecap='round' />
      </svg>
    </ActivityBarButton>
  )
}
