import { beforeEach, describe, expect, it } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'

import type { BoardInfo, PLCTask } from '../../../../../../../../middleware/shared/ports/types'
import { RTOS_DEFAULT_ENABLED } from '../../../../../../../../middleware/shared/utils/rtos'
import { openPLCStoreBase } from '../../../../../../../store'
import { RtosModeSwitch } from '../components/rtos-mode-switch'

const esp32: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'esp32:esp32',
  preview: '',
  specs: {},
}

/** The switch's state, read off the checkbox it is. */
function checked(): boolean {
  const toggle = screen.getByRole('checkbox', { name: 'RTOS mode' })
  return toggle instanceof HTMLInputElement && toggle.checked
}

function setUp(settings: Record<string, unknown>, tasks: PLCTask[]) {
  openPLCStoreBase.setState((state) => ({
    deviceDefinitions: {
      ...state.deviceDefinitions,
      configuration: { ...state.deviceDefinitions.configuration, vendorScreenData: settings },
    },
    project: {
      ...state.project,
      data: {
        ...state.project.data,
        configurations: {
          ...state.project.data.configurations,
          resource: { ...state.project.data.configurations.resource, tasks },
        },
      },
    },
  }))
}

function vendorScreenData() {
  return openPLCStoreBase.getState().deviceDefinitions.configuration.vendorScreenData
}

describe('RtosModeSwitch', () => {
  beforeEach(() => setUp({}, [{ name: 'main', triggering: 'Cyclic', interval: 'T#10ms', priority: 0 }]))

  it('is offered on a board whose core has an RTOS, in its default state', () => {
    render(<RtosModeSwitch boardInfo={esp32} />)
    expect(checked()).toBe(RTOS_DEFAULT_ENABLED)
  })

  it('is not offered where there is no RTOS, nor to the simulator', () => {
    const { container, rerender } = render(<RtosModeSwitch boardInfo={{ ...esp32, core: 'arduino:avr' }} />)
    expect(container.firstChild).toBeNull()
    rerender(<RtosModeSwitch boardInfo={{ ...esp32, compiler: 'simulator' }} />)
    expect(container.firstChild).toBeNull()
    rerender(<RtosModeSwitch boardInfo={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('keeps the choice in the board’s settings, where the build reads it', () => {
    render(<RtosModeSwitch boardInfo={esp32} />)
    const toggle = screen.getByRole('checkbox', { name: 'RTOS mode' })

    fireEvent.click(toggle)
    expect(vendorScreenData()?.rtos).toEqual({ enabled: !RTOS_DEFAULT_ENABLED })
    expect(checked()).toBe(!RTOS_DEFAULT_ENABLED)

    fireEvent.click(toggle)
    expect(vendorScreenData()?.rtos).toEqual({ enabled: RTOS_DEFAULT_ENABLED })
  })

  it('says beside the switch what a project RTOS mode cannot run gets', () => {
    const fast: PLCTask[] = [{ name: 'fast', triggering: 'Cyclic', interval: 'T#500us', priority: 0 }]
    setUp({}, fast)
    const { unmount } = render(<RtosModeSwitch boardInfo={esp32} />)
    expect(screen.getByText(/builds as a single scan loop: .*fast \(T#500us\)/)).toBeTruthy()
    unmount()
    setUp({ rtos: { enabled: true } }, fast)
    render(<RtosModeSwitch boardInfo={esp32} />)
    expect(screen.getByText(/Builds will fail: .*fast/)).toBeTruthy()
  })
})
