import { cn } from '@root/frontend/utils/cn'
import type { ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import { useEsi } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useRef, useState } from 'react'

import { ESIParseProgress } from './esi-parse-progress'

type ParseProgress = {
  active: boolean
  currentFile?: string
  currentFileIndex: number
  totalFiles: number
  percentage: number
}

type ESIUploadProps = {
  onFilesLoaded: (items: ESIRepositoryItemLight[], errors?: Array<{ filename: string; error: string }>) => void
  repository: ESIRepositoryItemLight[]
  isLoading?: boolean
}

/**
 * ESI File Upload Component
 *
 * Allows users to upload multiple EtherCAT ESI XML files via drag-and-drop or file picker.
 * Files are read and sent to the main process one at a time to avoid memory issues.
 */
const ESIUpload = ({ onFilesLoaded, repository, isLoading = false }: ESIUploadProps) => {
  const esi = useEsi()
  const [isDragging, setIsDragging] = useState(false)
  const [parseProgress, setParseProgress] = useState<ParseProgress>({
    active: false,
    currentFileIndex: 0,
    totalFiles: 0,
    percentage: 0,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFiles = useCallback(
    async (files: FileList) => {
      const xmlFiles = Array.from(files).filter((file) => file.name.toLowerCase().endsWith('.xml'))

      if (xmlFiles.length === 0) {
        onFilesLoaded(repository, [{ filename: '', error: 'No XML files found. Please upload .xml ESI files.' }])
        return
      }

      setParseProgress({
        active: true,
        currentFile: xmlFiles[0].name,
        currentFileIndex: 0,
        totalFiles: xmlFiles.length,
        percentage: 0,
      })

      const newItems: ESIRepositoryItemLight[] = []
      const errors: Array<{ filename: string; error: string }> = []
      // A dedup-after-retry result means the file was persisted on the backend
      // but its row was missing from the upload response (and the adapter's own
      // recovery lookup also failed). Honor the EsiPort contract by re-listing
      // the repository after the batch so the file appears instead of silently
      // vanishing — see EsiPort.parseAndSaveFile (`dedupAfterRetry`).
      let needsRepositoryRefresh = false

      const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

      // Process files one at a time to avoid memory issues
      for (let i = 0; i < xmlFiles.length; i++) {
        const file = xmlFiles[i]

        setParseProgress({
          active: true,
          currentFile: file.name,
          currentFileIndex: i,
          totalFiles: xmlFiles.length,
          percentage: Math.round((i / xmlFiles.length) * 100),
        })

        if (file.size > MAX_FILE_SIZE) {
          errors.push({
            filename: file.name,
            error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum is 100MB.`,
          })
          continue
        }

        try {
          const text = await file.text()
          const result = await esi!.parseAndSaveFile(file.name, text)

          if (result.success && result.item) {
            newItems.push(result.item)
          } else if (result.success && result.dedupAfterRetry) {
            // Uploaded but absent from the response: a transient-failure retry
            // hit the backend dedup and the adapter couldn't recover the row.
            // Flag a repository refresh so the file surfaces after the batch.
            needsRepositoryRefresh = true
          } else if (result.success) {
            // Real duplicate — content already in the repository. Skip silently.
            // See EsiPort.parseAndSaveFile for the duplicate-handling contract.
          } else {
            errors.push({ filename: file.name, error: result.error ?? 'Parse failed' })
          }
        } catch (err) {
          errors.push({ filename: file.name, error: err instanceof Error ? err.message : String(err) })
        }
      }

      setParseProgress({
        active: false,
        currentFileIndex: 0,
        totalFiles: 0,
        percentage: 100,
      })

      // A recovered-but-unlisted upload (dedupAfterRetry) is on the backend yet
      // missing from `newItems`. Re-list the repository so it shows up; fall
      // back to the locally accumulated list if the refresh itself fails.
      if (needsRepositoryRefresh) {
        const refreshed = await esi!.loadRepositoryLight()
        if (refreshed.success && refreshed.items) {
          onFilesLoaded(refreshed.items, errors.length > 0 ? errors : undefined)
          return
        }
      }

      // A recovered add (item + dedupAfterRetry) can return a row that already
      // exists in `repository` — the retry hit the backend dedup against a
      // pre-existing entry. Dedup the merged list by id (repository wins) so the
      // same row isn't rendered twice or assigned a duplicate React key.
      const mergedById = new Map<ESIRepositoryItemLight['id'], ESIRepositoryItemLight>()
      for (const item of [...repository, ...newItems]) {
        if (!mergedById.has(item.id)) {
          mergedById.set(item.id, item)
        }
      }
      onFilesLoaded([...mergedById.values()], errors.length > 0 ? errors : undefined)
    },
    [onFilesLoaded, repository, esi],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        void processFiles(files)
      }
    },
    [processFiles],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        void processFiles(files)
      }
      // Reset input so same files can be selected again
      e.target.value = ''
    },
    [processFiles],
  )

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const isProcessing = isLoading || parseProgress.active

  return (
    <div className='flex flex-col gap-2'>
      <label className='text-xs font-medium text-neutral-950 dark:text-white'>ESI Device Files</label>

      {/* Drop zone */}
      <div
        role='button'
        tabIndex={isProcessing ? -1 : 0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick()
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label='Upload ESI XML files. Click or drag and drop.'
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
          isDragging
            ? 'bg-brand/10 dark:bg-brand/20 border-brand'
            : 'border-neutral-300 hover:border-brand hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/50',
          isProcessing && 'pointer-events-none opacity-50',
        )}
      >
        <input ref={fileInputRef} type='file' accept='.xml' multiple onChange={handleFileSelect} className='hidden' />

        {parseProgress.active ? (
          <div className='w-full max-w-sm'>
            <ESIParseProgress
              currentFile={parseProgress.currentFile}
              currentFileIndex={parseProgress.currentFileIndex}
              totalFiles={parseProgress.totalFiles}
              percentage={parseProgress.percentage}
            />
          </div>
        ) : (
          <div className='flex flex-col items-center gap-1'>
            <svg
              className='h-8 w-8 text-neutral-400 dark:text-neutral-500'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={1.5}
                d='M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12'
              />
            </svg>
            <span className='text-sm text-neutral-600 dark:text-neutral-400'>
              Drop ESI files here or <span className='text-brand'>browse</span>
            </span>
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              Supports multiple .xml ESI files (ETG.2000)
            </span>
            {repository.length > 0 && (
              <span className='mt-1 text-xs text-neutral-500 dark:text-neutral-400'>
                {repository.length} file(s) currently loaded
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export { ESIUpload }
