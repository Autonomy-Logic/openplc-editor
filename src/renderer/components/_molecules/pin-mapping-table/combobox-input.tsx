import { boardSelectors, pinSelectors } from '@root/renderer/hooks'
import { DevicePin } from '@root/renderer/store/slices'
import { CellContext } from '@tanstack/react-table'
import { useCallback, useEffect, useState } from 'react'

import { GenericComboboxCell } from '../../_atoms/generic-table-inputs/generic-combobox-cell'
import { toast } from '../../_features/[app]/toast/use-toast'

type PinSelectInputCellProps = CellContext<DevicePin, unknown> & {
  selected?: boolean
  editable?: boolean
}
export const PinComboboxInputCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
}: PinSelectInputCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)

  const selectedDeviceBoard = boardSelectors.useDeviceBoard()
  const availableBoards = boardSelectors.useAvailableBoards()
  const existingPins = pinSelectors.usePins()

  const onValueChange = (value: string) => {
    if (value === initialValue) return

    const res = table.options.meta?.updateData(index, id, value)

    // Assume success when no structured response is returned
    if (res === undefined || res?.ok) return

    setCellValue(initialValue)
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  const selectableValues = useCallback(() => {
    const transformPins = (pins: string[]) =>
      pins.map((pin) => ({
        id: `${id}-${pin}`,
        value: pin,
        label: pin,
      }))

    const defaultAinPins = availableBoards.get(selectedDeviceBoard)?.pins?.defaultAin || []
    const defaultAoutPins = availableBoards.get(selectedDeviceBoard)?.pins?.defaultAout || []
    const defaultDinPins = availableBoards.get(selectedDeviceBoard)?.pins?.defaultDin || []
    const defaultDoutPins = availableBoards.get(selectedDeviceBoard)?.pins?.defaultDout || []

    return [
      ...transformPins(defaultAinPins),
      ...transformPins(defaultAoutPins),
      ...transformPins(defaultDinPins),
      ...transformPins(defaultDoutPins),
    ]
      .filter((pin) => !existingPins.some((existingPin) => existingPin.pin === pin.value))
      .sort((a, b) => {
        const isALetter = /^[A-Za-z]/.test(a.value)
        const isBLetter = /^[A-Za-z]/.test(b.value)
        if (isALetter && !isBLetter) return -1
        if (!isALetter && isBLetter) return 1
        if (!isALetter && !isBLetter) {
          // Both are numbers, sort numerically
          return parseInt(a.value, 10) - parseInt(b.value, 10)
        }
        // Both are letter-prefixed, sort alphabetically
        return a.value.localeCompare(b.value)
      })
  }, [id, selectedDeviceBoard, availableBoards, existingPins])

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <GenericComboboxCell
      value={cellValue}
      onValueChange={onValueChange}
      selectValues={selectableValues()}
      selected={selected}
      canAddACustomOption
    />
  )
}
