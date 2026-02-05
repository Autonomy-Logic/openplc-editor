import { ArrowIcon } from '@root/renderer/assets/icons'
import type { ESIParseResult, ESIRepositoryItem } from '@root/types/ethercat/esi-types'
import { cn } from '@root/utils'
import { parseESI } from '@root/utils/ethercat/esi-parser'
import { useCallback, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

type ESIUploadProps = {
  onFilesLoaded: (results: Array<{ result: ESIParseResult; filename: string }>) => void
  repositoryCount?: number
  isLoading?: boolean
}

/**
 * ESI File Upload Component
 *
 * Allows users to upload multiple EtherCAT ESI XML files via drag-and-drop or file picker.
 * Supports batch processing with non-blocking error handling.
 */
const ESIUpload = ({ onFilesLoaded, repositoryCount = 0, isLoading = false }: ESIUploadProps) => {
  const [isDragging, setIsDragging] = useState(false)
  const [processingCount, setProcessingCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFiles = useCallback(
    async (files: FileList) => {
      const xmlFiles = Array.from(files).filter((file) => file.name.endsWith('.xml'))

      if (xmlFiles.length === 0) {
        onFilesLoaded([
          {
            result: { success: false, error: 'No XML files found. Please upload .xml ESI files.' },
            filename: '',
          },
        ])
        return
      }

      setProcessingCount(xmlFiles.length)

      const results: Array<{ result: ESIParseResult; filename: string }> = []

      for (const file of xmlFiles) {
        try {
          const text = await file.text()
          const result = parseESI(text, file.name)
          results.push({ result, filename: file.name })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to read file'
          results.push({
            result: { success: false, error: errorMessage },
            filename: file.name,
          })
        }
      }

      setProcessingCount(0)
      onFilesLoaded(results)
    },
    [onFilesLoaded],
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

  const isProcessing = isLoading || processingCount > 0

  return (
    <div className='flex flex-col gap-2'>
      <label className='text-xs font-medium text-neutral-950 dark:text-white'>ESI Device Files</label>

      {/* Drop zone */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
          isDragging
            ? 'bg-brand/10 dark:bg-brand/20 border-brand'
            : 'border-neutral-300 hover:border-brand hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/50',
          isProcessing && 'pointer-events-none opacity-50',
        )}
      >
        <input ref={fileInputRef} type='file' accept='.xml' multiple onChange={handleFileSelect} className='hidden' />

        {isProcessing ? (
          <div className='flex items-center gap-2'>
            <ArrowIcon size='sm' className='animate-spin stroke-brand' />
            <span className='text-sm text-neutral-600 dark:text-neutral-400'>
              Processing {processingCount > 0 ? `${processingCount} file(s)` : ''}...
            </span>
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
            {repositoryCount > 0 && (
              <span className='mt-1 text-xs text-neutral-500 dark:text-neutral-400'>
                {repositoryCount} file(s) currently loaded
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Convert parse results to repository items
 */
export function parseResultsToRepositoryItems(results: Array<{ result: ESIParseResult; filename: string }>): {
  items: ESIRepositoryItem[]
  errors: Array<{ filename: string; error: string }>
} {
  const items: ESIRepositoryItem[] = []
  const errors: Array<{ filename: string; error: string }> = []

  for (const { result, filename } of results) {
    if (result.success && result.data) {
      items.push({
        id: uuidv4(),
        filename: result.data.filename || filename,
        vendor: result.data.vendor,
        devices: result.data.devices,
        loadedAt: Date.now(),
        warnings: result.warnings,
      })
    } else {
      errors.push({
        filename,
        error: result.error || 'Unknown parsing error',
      })
    }
  }

  return { items, errors }
}

export { ESIUpload }
