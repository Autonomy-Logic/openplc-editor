import { searchSelectors } from '@root/renderer/hooks'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import { cn } from '@root/utils'
import { useCallback, useState } from 'react'

import { InputWithRef } from '../input'

export const GenericTextCell = ({
  value,
  onChange,
  onBlur,
  editable = false,
  selected = false,
}: {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  editable?: boolean
  selected?: boolean
}) => {
  const searchQuery = searchSelectors.useSearchQuery()
  const formattedCellValue = searchQuery && value ? extractSearchQuery(value, searchQuery) : value

  const [isEditing, setIsEditing] = useState(false)
  const handleStartEditing = useCallback(() => {
    if (editable && selected) {
      setIsEditing(true)
    }
  }, [editable, selected])
  const handleStopEditing = useCallback(() => {
    setIsEditing(false)
  }, [])


  return isEditing ? (
    <InputWithRef
      value={value}
      onChange={(e) => {
        handleStopEditing()
        onChange(e.target.value)
      }}
      onBlur={onBlur}
      className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none')}
    />
  ) : (
    <div
      onClick={handleStartEditing}
      className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
        'pointer-events-none': !selected,
        'cursor-not-allowed': !editable,
      })}
    >
      <p
        className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
        dangerouslySetInnerHTML={{ __html: formattedCellValue }}
      />
    </div>
  )
}
