import { useOpenPLCStore } from '../../../../store'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const ChatButton = () => {
  const { isChatOpen, isEnabled, hasConsented } = useOpenPLCStore.useAi()
  const { toggleChat } = useOpenPLCStore.useAiActions()
  const { openModal } = useOpenPLCStore.useModalActions()

  if (!isEnabled) return null

  const handleClick = () => {
    if (!hasConsented) {
      openModal('ai-consent')
      return
    }
    toggleChat()
  }

  return (
    <ActivityBarButton aria-label='AI Chat' onClick={handleClick} data-active={isChatOpen ? 'true' : undefined}>
      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <rect x='4' y='4' width='17' height='17' rx='3.5' stroke='#B4D0FE' strokeWidth='1.8' />
        <text
          x='12.5'
          y='16.5'
          textAnchor='middle'
          fontFamily='system-ui, sans-serif'
          fontSize='10'
          fontWeight='700'
          fill='#B4D0FE'
        >
          AI
        </text>
        <path d='M5.5 1L6.2 3L8 3.5L6.2 4L5.5 6L4.8 4L3 3.5L4.8 3L5.5 1Z' fill='#B4D0FE' />
        <path
          opacity='0.5'
          d='M1.5 5.5L1.85 6.5L2.75 6.75L1.85 7L1.5 8L1.15 7L0.25 6.75L1.15 6.5L1.5 5.5Z'
          fill='#B4D0FE'
        />
      </svg>
    </ActivityBarButton>
  )
}
