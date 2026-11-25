import * as Tabs from '@radix-ui/react-tabs'
import { fireEvent, render, screen } from '@testing-library/react'

import { BottomPanelHideButton, BottomPanelStrip, BottomPanelTabTrigger } from '..'
import { isBottomPanelTabId, visibleBottomPanelTabs } from '../tabs'

const NONE = { debug: false, search: false, plcLogs: false }

describe('visibleBottomPanelTabs', () => {
  it('always shows Console', () => {
    expect(visibleBottomPanelTabs(NONE).map((tab) => tab.id)).toEqual(['console'])
  })

  it('adds each optional tab under its own condition, in display order', () => {
    expect(visibleBottomPanelTabs({ debug: true, search: true, plcLogs: true }).map((tab) => tab.label)).toEqual([
      'Console',
      'Debugger',
      'Search',
      'PLC Logs',
    ])
    expect(visibleBottomPanelTabs({ ...NONE, plcLogs: true }).map((tab) => tab.id)).toEqual(['console', 'plc-logs'])
    expect(visibleBottomPanelTabs({ ...NONE, debug: true }).map((tab) => tab.id)).toEqual(['console', 'debug'])
  })
})

describe('isBottomPanelTabId', () => {
  it('accepts the four tab ids and nothing else', () => {
    expect(['console', 'debug', 'search', 'plc-logs'].every(isBottomPanelTabId)).toBe(true)
    expect(isBottomPanelTabId('variables')).toBe(false)
    expect(isBottomPanelTabId('')).toBe(false)
  })
})

describe('BottomPanelStrip', () => {
  it('opens the panel on the tab whose button is clicked', () => {
    const onOpenTab = jest.fn()
    const onReopen = jest.fn()
    render(
      <BottomPanelStrip
        tabs={visibleBottomPanelTabs({ debug: true, search: false, plcLogs: true })}
        onOpenTab={onOpenTab}
        onReopen={onReopen}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'PLC Logs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Debugger' }))

    expect(onOpenTab.mock.calls).toEqual([['plc-logs'], ['debug']])
    expect(onReopen).not.toHaveBeenCalled()
  })

  it('reopens on the last tab used from the chevron', () => {
    const onOpenTab = jest.fn()
    const onReopen = jest.fn()
    render(<BottomPanelStrip tabs={visibleBottomPanelTabs(NONE)} onOpenTab={onOpenTab} onReopen={onReopen} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show panel' }))

    expect(onReopen).toHaveBeenCalledTimes(1)
    expect(onOpenTab).not.toHaveBeenCalled()
  })
})

describe('panel header', () => {
  it('marks the active text tab and hides the panel from the X', () => {
    const onHide = jest.fn()
    render(
      <Tabs.Root value='debug'>
        <Tabs.List>
          {visibleBottomPanelTabs({ debug: true, search: false, plcLogs: false }).map((tab) => (
            <BottomPanelTabTrigger key={tab.id} tab={tab} />
          ))}
        </Tabs.List>
        <BottomPanelHideButton onHide={onHide} />
      </Tabs.Root>,
    )

    expect(screen.getByRole('tab', { name: 'Debugger' }).getAttribute('data-state')).toBe('active')
    expect(screen.getByRole('tab', { name: 'Console' }).getAttribute('data-state')).toBe('inactive')
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }))
    expect(onHide).toHaveBeenCalledTimes(1)
  })
})
