import type { ESIParseResult, ESIRepositoryItem } from '@root/types/ethercat/esi-types'
import { useCallback, useState } from 'react'

import { ESIRepositoryTable } from './esi-repository-table'
import { ESIUpload, parseResultsToRepositoryItems } from './esi-upload'

type ESIServiceResponse = { success: boolean; error?: string }

type ESIRepositoryProps = {
  repository: ESIRepositoryItem[]
  onRepositoryChange: (repository: ESIRepositoryItem[]) => void
  projectPath: string
  isLoading?: boolean
}

/**
 * ESI Repository Component
 *
 * Manages the ESI file repository with upload and display functionality.
 * Combines upload zone with repository table.
 * Automatically persists changes to disk.
 */
const ESIRepository = ({ repository, onRepositoryChange, projectPath, isLoading = false }: ESIRepositoryProps) => {
  const [uploadErrors, setUploadErrors] = useState<Array<{ filename: string; error: string }>>([])
  const [isSaving, setIsSaving] = useState(false)

  const handleFilesLoaded = useCallback(
    async (results: Array<{ result: ESIParseResult; filename: string; xmlContent: string }>) => {
      const { items, errors } = parseResultsToRepositoryItems(results)

      // Add new items to existing repository (avoiding duplicates by filename)
      const existingFilenames = new Set(repository.map((r) => r.filename))
      const newItems = items.filter((item) => !existingFilenames.has(item.filename))

      if (newItems.length > 0) {
        setIsSaving(true)

        // Save each new item to disk
        const saveErrors: Array<{ filename: string; error: string }> = []
        const savedItems: ESIRepositoryItem[] = []

        for (let i = 0; i < newItems.length; i++) {
          const item = newItems[i]
          // Find the corresponding XML content from the results
          const resultEntry = results.find(
            (r) => r.result.success && r.result.data && r.result.data.filename === item.filename,
          )

          if (resultEntry && resultEntry.xmlContent) {
            try {
              const saveResult: ESIServiceResponse = await window.bridge.esiSaveRepositoryItem(
                projectPath,
                item,
                resultEntry.xmlContent,
                [...repository, ...savedItems],
              )

              if (saveResult.success) {
                savedItems.push(item)
              } else {
                saveErrors.push({
                  filename: item.filename,
                  error: saveResult.error ?? 'Failed to save file',
                })
              }
            } catch (err) {
              saveErrors.push({
                filename: item.filename,
                error: String(err),
              })
            }
          }
        }

        setIsSaving(false)

        // Update repository with successfully saved items
        if (savedItems.length > 0) {
          onRepositoryChange([...repository, ...savedItems])
        }

        // Show errors for failed files (both parse errors and save errors)
        setUploadErrors([...errors, ...saveErrors])
      } else {
        // Show only parse errors
        setUploadErrors(errors)
      }
    },
    [repository, onRepositoryChange, projectPath],
  )

  const handleRemoveItem = useCallback(
    async (itemId: string) => {
      setIsSaving(true)

      try {
        const result: ESIServiceResponse = await window.bridge.esiDeleteRepositoryItem(projectPath, itemId, repository)

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
      // Delete all items from disk
      for (const item of repository) {
        await (window.bridge.esiDeleteXmlFile(projectPath, item.id) as Promise<ESIServiceResponse>)
      }

      // Save empty repository index
      await (window.bridge.esiSaveRepositoryIndex(projectPath, []) as Promise<ESIServiceResponse>)

      onRepositoryChange([])
      setUploadErrors([])
    } catch (err) {
      console.error('Error clearing ESI repository:', err)
    } finally {
      setIsSaving(false)
    }
  }, [repository, onRepositoryChange, projectPath])

  const handleDismissError = useCallback((filename: string) => {
    setUploadErrors((prev) => prev.filter((e) => e.filename !== filename))
  }, [])

  const isProcessing = isLoading || isSaving

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
      {/* Upload Area */}
      <ESIUpload
        onFilesLoaded={(results) => void handleFilesLoaded(results)}
        repositoryCount={repository.length}
        isLoading={isProcessing}
      />

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
