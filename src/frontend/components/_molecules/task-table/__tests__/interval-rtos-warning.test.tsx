import { beforeEach, describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react'

import type { BoardInfo, PLCTask } from '../../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../../store'
import { TaskTable } from '..'

const boards = new Map<string, BoardInfo>([
  ['ESP32-S3', { compiler: 'arduino-cli', core: 'esp32:esp32', preview: '', specs: {} }],
])

const tasks: PLCTask[] = [
  { name: 'main', triggering: 'Cyclic', interval: 'T#10ms', priority: 0 },
  { name: 'fast', triggering: 'Cyclic', interval: 'T#500us', priority: 1 },
]

function select(vendorScreenData: Record<string, unknown>) {
  openPLCStoreBase.setState((state) => ({
    deviceAvailableOptions: { ...state.deviceAvailableOptions, availableBoards: boards },
    deviceDefinitions: {
      ...state.deviceDefinitions,
      configuration: { ...state.deviceDefinitions.configuration, deviceBoard: 'ESP32-S3', vendorScreenData },
    },
  }))
}

describe('the task table under RTOS mode', () => {
  beforeEach(() => select({}))

  it('flags an interval off the RTOS tick, and only that one', () => {
    render(<TaskTable tableData={tasks} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.getAllByLabelText('Interval RTOS mode cannot keep')).toHaveLength(1)
  })

  it('flags nothing when RTOS mode is off', () => {
    select({ rtos: { enabled: false } })
    render(<TaskTable tableData={tasks} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.queryByLabelText('Interval RTOS mode cannot keep')).toBeNull()
  })
})
