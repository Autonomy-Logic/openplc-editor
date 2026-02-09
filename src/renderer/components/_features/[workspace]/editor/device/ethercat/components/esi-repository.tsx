import type { ESIRepositoryItemLight } from '@root/types/ethercat/esi-types'
import { useCallback, useState } from 'react'

import { ESIRepositoryTable } from './esi-repository-table'
import { ESIUpload } from './esi-upload'

type ESIServiceResponse = { success: boolean; error?: string }

type ESIRepositoryProps = {
  repository: ESIRepositoryItemLight[]
  onRepositoryChange: (repository: ESIRepositoryItemLight[]) => void
  projectPath: string
  isLoading?: boolean
}

/**
 * ESI Repository Component
 *
 * Manages the ESI file repository with upload and display functionality.
 * Combines upload zone with repository table.
 * Files are parsed and saved in the main process; this component receives ready items.
 */
const ESIRepository = ({ repository, onRepositoryChange, projectPath, isLoading = false }: ESIRepositoryProps) => {
  const [uploadErrors, setUploadErrors] = useState<Array<{ filename: string; error: string }>>([])
  const [isSaving, setIsSaving] = useState(false)

  const handleFilesLoaded = useCallback(
    (items: ESIRepositoryItemLight[], errors?: Array<{ filename: string; error: string }>) => {
      // Items are already parsed and saved by the main process
      onRepositoryChange(items)
      setUploadErrors(errors ?? [])
    },
    [onRepositoryChange],
  )

  const handleRemoveItem = useCallback(
    async (itemId: string) => {
      setIsSaving(true)

      try {
        const result: ESIServiceResponse = await window.bridge.esiDeleteXmlFile(projectPath, itemId)

        if (result.success) {
          onRepositoryChange(repository.filter((item) => item.id !== itemId))
        } else {
          console.error('Failed to delete ESI item:', result.error)
        }
      } catch (err) {
        console.error('Error deleting ESI item:', err)
      } finally {
        setIsSaving(false)
      }
    },
    [repository, onRepositoryChange, projectPath],
  )

  const handleClearAll = useCallback(async () => {
    setIsSaving(true)

    try {
      const result: ESIServiceResponse = await window.bridge.esiClearRepository(projectPath)
      if (result.success) {
        onRepositoryChange([])
        setUploadErrors([])
      } else {
        console.error('Failed to clear ESI repository:', result.error)
      }
    } catch (err) {
      console.error('Error clearing ESI repository:', err)
    } finally {
      setIsSaving(false)
    }
  }, [onRepositoryChange, projectPath])

  const [errorsExpanded, setErrorsExpanded] = useState(false)

  const isProcessing = isLoading || isSaving

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
      {/* Upload Area */}
      <ESIUpload
        onFilesLoaded={handleFilesLoaded}
        repository={repository}
        isLoading={isProcessing}
        projectPath={projectPath}
      />

      {/* Error Summary (collapsible) */}
      {uploadErrors.length > 0 && (
        <div className='shrink-0 rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'>
          <div className='flex items-center justify-between px-3 py-2'>
            <button onClick={() => setErrorsExpanded((prev) => !prev)} className='flex items-center gap-2'>
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
                {uploadErrors.length} file(s) failed to parse
              </span>
              <svg
                className={`h-3 w-3 text-red-500 transition-transform dark:text-red-400 ${errorsExpanded ? 'rotate-180' : ''}`}
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
              </svg>
            </button>
            <button
              onClick={() => setUploadErrors([])}
              className='text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
            >
              Dismiss
            </button>
          </div>
          {errorsExpanded && (
            <div className='max-h-32 overflow-auto border-t border-red-200 px-3 py-2 dark:border-red-800'>
              {uploadErrors.map((error) => (
                <div key={error.filename} className='py-0.5 text-xs text-red-600 dark:text-red-400'>
                  <strong>{error.filename || 'File'}</strong>: {error.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Repository Table */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <ESIRepositoryTable
          repository={repository}
          onRemoveItem={handleRemoveItem}
          onClearAll={handleClearAll}
          isLoading={isSaving}
        />
      </div>
    </div>
  )
}

export { ESIRepository }
