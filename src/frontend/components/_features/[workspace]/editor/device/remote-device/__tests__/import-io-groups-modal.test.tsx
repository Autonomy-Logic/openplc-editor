import { fireEvent, render, screen } from '@testing-library/react'

import type { IOGroupDraft } from '../../../../../../../utils/modbus/io-group-transfer'
import { ImportIOGroupsModal, type IOGroupImportPreview } from '../import-io-groups-modal'

const draft = (name: string): IOGroupDraft => ({
  name,
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 1,
  errorHandling: 'keep-last-value',
})

const preview = (names: string[], rows: number[]): IOGroupImportPreview => ({
  fileName: 'map.csv',
  result: { groups: names.map(draft), rows, errors: [], warnings: [] },
})

function setup(names: string[], rows: number[], existingGroupNames: string[]) {
  const onConfirm = jest.fn()
  render(
    <ImportIOGroupsModal
      preview={preview(names, rows)}
      existingGroupNames={existingGroupNames}
      onClose={jest.fn()}
      onConfirm={onConfirm}
    />,
  )
  const importButton = screen.getByRole<HTMLButtonElement>('button', { name: /^Import/ })
  return { onConfirm, importButton }
}

describe('ImportIOGroupsModal', () => {
  it('appends a clean file', () => {
    const { onConfirm, importButton } = setup(['A', 'B'], [2, 3], ['Other'])
    expect(importButton.disabled).toBe(false)
    fireEvent.click(importButton)
    expect(onConfirm).toHaveBeenCalledWith([draft('A'), draft('B')], 'append')
  })

  it('reports an append conflict with the row it came from', () => {
    const { importButton } = setup(['A', 'Pump'], [2, 5], ['pump'])
    expect(screen.getByRole('alert').textContent).toContain('Row 5 · name: "Pump" already exists on this device.')
    expect(importButton.disabled).toBe(true)
  })

  it('blocks appending to a device that already repeats a name, until replace is chosen', () => {
    const { onConfirm, importButton } = setup(['A'], [2], ['Pump', 'PUMP', 'Other'])
    expect(screen.getByRole('alert').textContent).toContain(
      'This device already has more than one IO group named "PUMP".',
    )
    expect(importButton.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Replace existing groups'))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(importButton)
    expect(onConfirm).toHaveBeenCalledWith([draft('A')], 'replace')
  })
})
