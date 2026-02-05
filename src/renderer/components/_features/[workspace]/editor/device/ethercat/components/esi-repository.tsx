import type { ESIParseResult, ESIRepositoryItem } from '@root/types/ethercat/esi-types'
import { useCallback, useState } from 'react'

import { ESIRepositoryTable } from './esi-repository-table'
import { ESIUpload, parseResultsToRepositoryItems } from './esi-upload'

type ESIRepositoryProps = {
  repository: ESIRepositoryItem[]
  onRepositoryChange: (repository: ESIRepositoryItem[]) => void
}

/**
 * ESI Repository Component
 *
 * Manages the ESI file repository with upload and display functionality.
 * Combines upload zone with repository table.
 */
const ESIRepository = ({ repository, onRepositoryChange }: ESIRepositoryProps) => {
  const [uploadErrors, setUploadErrors] = useState<Array<{ filename: string; error: string }>>([])
  const [isLoading] = useState(false)

  const handleFilesLoaded = useCallback(
    (results: Array<{ result: ESIParseResult; filename: string }>) => {
      const { items, errors } = parseResultsToRepositoryItems(results)

      // Add new items to existing repository (avoiding duplicates by filename)
      const existingFilenames = new Set(repository.map((r) => r.filename))
      const newItems = items.filter((item) => !existingFilenames.has(item.filename))

      if (newItems.length > 0) {
        onRepositoryChange([...repository, ...newItems])
      }

      // Show errors for failed files
      setUploadErrors(errors)
    },
    [repository, onRepositoryChange],
  )

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      onRepositoryChange(repository.filter((item) => item.id !== itemId))
    },
    [repository, onRepositoryChange],
  )

  const handleClearAll = useCallback(() => {
    onRepositoryChange([])
    setUploadErrors([])
  }, [onRepositoryChange])

  const handleDismissError = useCallback((filename: string) => {
    setUploadErrors((prev) => prev.filter((e) => e.filename !== filename))
  }, [])

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
      {/* Upload Area */}
      <ESIUpload onFilesLoaded={handleFilesLoaded} repositoryCount={repository.length} isLoading={isLoading} />

      {/* Error Messages */}
      {uploadErrors.length > 0 && (
        <div className='flex flex-col gap-2'>
          {uploadErrors.map((error) => (
            <div
              key={error.filename}
              className='flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'
            >
              <div className='flex items-center gap-2'>
                <svg
                  className='h-4 w-4 text-red-500 dark:text-red-400'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                <span className='text-sm text-red-700 dark:text-red-300'>
                  <strong>{error.filename || 'File'}</strong>: {error.error}
                </span>
              </div>
              <button
                onClick={() => handleDismissError(error.filename)}
                className='text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
              >
                <svg className='h-4 w-4' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Repository Table */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <ESIRepositoryTable repository={repository} onRemoveItem={handleRemoveItem} onClearAll={handleClearAll} />
      </div>
    </div>
  )
}

export { ESIRepository }
