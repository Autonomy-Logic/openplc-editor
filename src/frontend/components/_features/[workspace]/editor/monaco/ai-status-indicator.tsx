import { useOpenPLCStore } from '../../../../../store'

type AIStatus = 'ready' | 'loading' | 'error' | 'disabled'

function useAIStatus(): AIStatus {
  const { isEnabled, isLoading, error, hasConsented } = useOpenPLCStore().ai
  if (!isEnabled || !hasConsented) return 'disabled'
  if (error) return 'error'
  if (isLoading) return 'loading'
  return 'ready'
}

const statusConfig: Record<AIStatus, { label: string; dotClass: string; title: string }> = {
  ready: {
    label: 'AI',
    dotClass: 'bg-green-500',
    title: 'AI completions active',
  },
  loading: {
    label: 'AI',
    dotClass: 'bg-yellow-400 animate-pulse',
    title: 'AI completion in progress...',
  },
  error: {
    label: 'AI',
    dotClass: 'bg-red-500',
    title: 'AI error — check console for details',
  },
  disabled: {
    label: 'AI',
    dotClass: 'bg-neutral-400',
    title: 'AI completions disabled',
  },
}

const AIStatusIndicator = () => {
  const status = useAIStatus()
  const { label, dotClass, title } = statusConfig[status]

  return (
    <div
      title={title}
      className='absolute bottom-2 right-4 z-10 flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-0.5 text-xs text-neutral-600 shadow-sm backdrop-blur-sm dark:bg-neutral-900/80 dark:text-neutral-400'
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      {label}
    </div>
  )
}

export { AIStatusIndicator }
