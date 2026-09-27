import { act, renderHook } from '@testing-library/react'

import type { RtosStats, RtosStatsResult } from '@root/middleware/shared/ports/types'

const mockReadTaskStats = jest.fn<Promise<RtosStatsResult>, [boolean?]>()

jest.mock('@root/middleware/shared/providers/platform-context', () => ({
  useDevice: () => mockDevice,
}))
const mockDevice = { readTaskStats: (reset?: boolean) => mockReadTaskStats(reset) }

import {
  BOARD_TASK_STATS_MAX_FAILURES,
  BOARD_TASK_STATS_POLL_MS,
  BOARD_TASK_STATS_RETRY_MS,
  useBoardTaskStats,
} from '../use-board-task-stats'

const withBusy = (a: number, b: number): RtosStats => ({
  tasks: [],
  services: [
    { iterationMaxUs: 0, busyReplies: a, stackFreeBytes: 0 },
    { iterationMaxUs: 0, busyReplies: b, stackFreeBytes: 0 },
  ],
  dispatcherStackFreeBytes: 0,
  heapFreeBytes: 0,
  heapMinFreeBytes: 0,
  baseTickUs: 10_000,
  retainLateMaxUs: 0,
})
const STATS = withBusy(0, 0)

/** Let the pending read resolve and its state update land. */
const settle = () => act(async () => {})
const wait = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms)
  })

describe('useBoardTaskStats', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockReadTaskStats.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  it('reads at once, starting a new window it does not show, then shows each later read', async () => {
    mockReadTaskStats.mockResolvedValueOnce({ success: true, stats: withBusy(7, 1) })
    mockReadTaskStats.mockResolvedValue({ success: true, stats: STATS })
    const { result } = renderHook(() => useBoardTaskStats(true))
    await settle()
    expect(mockReadTaskStats).toHaveBeenLastCalledWith(true)
    // The first reply covers the time before the screen opened.
    expect(result.current).toMatchObject({ stats: null, answered: true })

    await wait(BOARD_TASK_STATS_POLL_MS)
    expect(mockReadTaskStats).toHaveBeenLastCalledWith(false)
    expect(result.current.stats).toEqual(STATS)
  })

  it('shows the busy replies since the screen opened, across the counter wrapping', async () => {
    mockReadTaskStats.mockResolvedValueOnce({ success: true, stats: withBusy(0xfffffffe, 5) })
    mockReadTaskStats.mockResolvedValue({ success: true, stats: withBusy(1, 9) })
    const { result } = renderHook(() => useBoardTaskStats(true))
    await settle()
    await wait(BOARD_TASK_STATS_POLL_MS)
    expect(result.current.busySinceOpen).toEqual([3, 4])
  })

  it('stops asking a board that is not in RTOS mode', async () => {
    mockReadTaskStats.mockResolvedValue({ success: false, unsupported: true })
    const { result } = renderHook(() => useBoardTaskStats(true))
    await settle()
    expect(result.current).toMatchObject({ unsupported: true, answered: false })
    await wait(BOARD_TASK_STATS_POLL_MS * 3)
    expect(mockReadTaskStats).toHaveBeenCalledTimes(1)
  })

  it('reports a failed read and keeps the last statistics', async () => {
    mockReadTaskStats.mockResolvedValueOnce({ success: true, stats: STATS })
    mockReadTaskStats.mockResolvedValueOnce({ success: true, stats: STATS })
    mockReadTaskStats.mockResolvedValueOnce({ success: false, error: 'Not connected to target' })
    const { result } = renderHook(() => useBoardTaskStats(true))
    await settle()
    await wait(BOARD_TASK_STATS_POLL_MS)
    await wait(BOARD_TASK_STATS_POLL_MS)
    expect(result.current.error).toBe('Not connected to target')
    expect(result.current.stats).toEqual(STATS)
  })

  it('slows down when reads keep failing, and recovers when the board answers again', async () => {
    mockReadTaskStats.mockResolvedValue({ success: false, error: 'Timeout' })
    const { result } = renderHook(() => useBoardTaskStats(true))
    await settle()
    for (let i = 1; i < BOARD_TASK_STATS_MAX_FAILURES; i++) await wait(BOARD_TASK_STATS_POLL_MS)
    expect(mockReadTaskStats).toHaveBeenCalledTimes(BOARD_TASK_STATS_MAX_FAILURES)
    expect(result.current).toMatchObject({ stalled: true, unsupported: false, error: 'Timeout' })

    // Not every second any more: every few.
    await wait(BOARD_TASK_STATS_POLL_MS * 2)
    expect(mockReadTaskStats).toHaveBeenCalledTimes(BOARD_TASK_STATS_MAX_FAILURES)
    mockReadTaskStats.mockResolvedValue({ success: true, stats: STATS })
    await wait(BOARD_TASK_STATS_RETRY_MS - BOARD_TASK_STATS_POLL_MS * 2)
    expect(mockReadTaskStats).toHaveBeenCalledTimes(BOARD_TASK_STATS_MAX_FAILURES + 1)
    expect(result.current).toMatchObject({ stalled: false, error: null, answered: true })
  })

  it('reads less often when a read takes long, so the link keeps time for the debugger', async () => {
    mockReadTaskStats.mockImplementation(async () => {
      jest.advanceTimersByTime(600)
      return { success: true, stats: STATS }
    })
    renderHook(() => useBoardTaskStats(true))
    await settle()
    // 600 ms a read: the next one waits four times that.
    await wait(BOARD_TASK_STATS_POLL_MS)
    expect(mockReadTaskStats).toHaveBeenCalledTimes(1)
    await wait(2400 - BOARD_TASK_STATS_POLL_MS)
    expect(mockReadTaskStats).toHaveBeenCalledTimes(2)
  })

  it('counts a rejected read as a failure rather than dropping it', async () => {
    mockReadTaskStats.mockRejectedValue(new Error('link lost'))
    const { result } = renderHook(() => useBoardTaskStats(true))
    await settle()
    expect(result.current.error).toBe('link lost')
    await wait(BOARD_TASK_STATS_POLL_MS / 2)
    expect(mockReadTaskStats).toHaveBeenCalledTimes(1)
  })

  it('keeps asking for a new window until a read succeeds', async () => {
    mockReadTaskStats.mockResolvedValueOnce({ success: false, error: 'busy' })
    mockReadTaskStats.mockResolvedValue({ success: true, stats: STATS })
    renderHook(() => useBoardTaskStats(true))
    await settle()
    await wait(BOARD_TASK_STATS_POLL_MS)
    await wait(BOARD_TASK_STATS_POLL_MS)
    expect(mockReadTaskStats.mock.calls.map((call) => call[0])).toEqual([true, true, false])
  })

  it('ignores a reply that lands after the screen closed', async () => {
    let answer: (value: RtosStatsResult) => void = () => {}
    mockReadTaskStats.mockReturnValue(new Promise<RtosStatsResult>((resolve) => (answer = resolve)))
    const { result, unmount } = renderHook(() => useBoardTaskStats(true))
    unmount()
    await act(async () => {
      answer({ success: true, stats: STATS })
    })
    expect(result.current.stats).toBeNull()
  })

  it('reads nothing while inactive', async () => {
    renderHook(() => useBoardTaskStats(false))
    await settle()
    expect(mockReadTaskStats).not.toHaveBeenCalled()
  })
})
