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

  const onValueChange = (value: string) => {
    if (value === initialValue) return

    const res = table.options.meta?.updateData(index, id, value)

    // Assume success when no structured response is returned
    if (res === undefined || res?.ok) return

    setCellValue(initialValue)
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  const selectableValues = useCallback(() => {
    return [
      { id: "1", label: 'Digital Input', value: 'digital_input' },
      { id: "2", label: 'Digital Output', value: 'digital_output' },
      { id: "3", label: 'Analog Input', value: 'analog_input' },
      { id: "4", label: 'Analog Output', value: 'analog_output' },
      { id: "5", label: 'PWM', value: 'pwm' },
      { id: "6", label: 'I2C', value: 'i2c' },
      { id: "7", label: 'SPI', value: 'spi' },
      { id: "8", label: 'UART', value: 'uart' },
      { id: "9", label: 'CAN', value: 'can' },
      { id: "10", label: 'Other', value: 'other' },
    ]
  }, [id])

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
    />
  )
}
