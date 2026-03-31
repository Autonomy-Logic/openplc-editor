type ESIParseProgressProps = {
  currentFile?: string
  currentFileIndex: number
  totalFiles: number
  percentage: number
}

/**
 * ESI Parse Progress Component
 *
 * Shows a progress bar with file-by-file status during ESI XML parsing.
 */
const ESIParseProgress = ({ currentFile, currentFileIndex, totalFiles, percentage }: ESIParseProgressProps) => {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400'>
        <span>
          Processing file {currentFileIndex + 1} / {totalFiles}
        </span>
        <span>{percentage}%</span>
      </div>

      {/* Progress bar */}
      <div className='h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700'>
        <div
          className='h-full rounded-full bg-brand transition-all duration-200'
          style={{ width: `${Math.max(percentage, 2)}%` }}
        />
      </div>

      {/* Current file name */}
      {currentFile && (
        <span className='truncate text-xs text-neutral-500 dark:text-neutral-400' title={currentFile}>
          {currentFile}
        </span>
      )}
    </div>
  )
}

export { ESIParseProgress }
