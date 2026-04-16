import type { ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'

import { ESIRepository } from './esi-repository'

type RepositoryTabProps = {
  repository: ESIRepositoryItemLight[]
  onRepositoryChange: (items: ESIRepositoryItemLight[]) => void
  projectPath: string
  isLoadingRepository: boolean
  repositoryError: string | null
  onRetryRepository: () => void
}

const RepositoryTab = ({
  repository,
  onRepositoryChange,
  projectPath,
  isLoadingRepository,
  repositoryError,
  onRetryRepository,
}: RepositoryTabProps) => {
  return (
    <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
      <div className='flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900'>
        {repositoryError && (
          <div className='mb-3 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
            <p className='text-sm text-red-700 dark:text-red-300'>Failed to load repository: {repositoryError}</p>
            <button
              onClick={onRetryRepository}
              className='text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300'
            >
              Retry
            </button>
          </div>
        )}
        <ESIRepository
          repository={repository}
          onRepositoryChange={onRepositoryChange}
          projectPath={projectPath}
          isLoading={isLoadingRepository}
        />
      </div>
    </div>
  )
}

export { RepositoryTab }
