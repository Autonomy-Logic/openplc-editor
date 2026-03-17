import { useOpenPLCStore } from '../../../../store'

export const LoadingOverlay = () => {
  const {
    workspace: { isProjectLoading, projectLoadingMessage },
  } = useOpenPLCStore()

  if (!isProjectLoading) {
    return null
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm'>
      <div className='flex flex-col items-center gap-4'>
        <div className='h-12 w-12 animate-spin rounded-full border-4 border-neutral-700 border-t-brand' />
        <p className='text-lg font-medium text-neutral-100'>{projectLoadingMessage}</p>
      </div>
    </div>
  )
}
