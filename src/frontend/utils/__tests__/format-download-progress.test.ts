import { downloadPercent, formatDownloadProgress } from '../format-download-progress'

describe('formatDownloadProgress', () => {
  it('names the received and total sizes in decimal megabytes when the total is known', () => {
    expect(formatDownloadProgress(4_200_000, 11_100_000)).toBe('4.2 of 11.1 MB')
  })

  it('names only the received size when the host sent no total', () => {
    expect(formatDownloadProgress(4_200_000, null)).toBe('4.2 MB downloaded')
  })

  it('rounds each size to one decimal', () => {
    expect(formatDownloadProgress(4_260_000, 11_140_000)).toBe('4.3 of 11.1 MB')
    expect(formatDownloadProgress(4_240_000, null)).toBe('4.2 MB downloaded')
  })

  it('keeps the decimal on whole megabytes', () => {
    expect(formatDownloadProgress(2_000_000, 10_000_000)).toBe('2.0 of 10.0 MB')
  })

  it('shows zero bytes received as 0.0', () => {
    expect(formatDownloadProgress(0, 11_100_000)).toBe('0.0 of 11.1 MB')
    expect(formatDownloadProgress(0, null)).toBe('0.0 MB downloaded')
  })
})

describe('downloadPercent', () => {
  it('is the floored share of the total received', () => {
    expect(downloadPercent(4_200_000, 11_100_000)).toBe(37)
  })

  it('stays below 100 until every byte has arrived', () => {
    expect(downloadPercent(999, 1_000)).toBe(99)
    expect(downloadPercent(1_000, 1_000)).toBe(100)
  })

  it('never exceeds 100 when more bytes arrive than the total announced', () => {
    expect(downloadPercent(1_200, 1_000)).toBe(100)
  })

  it('is 0 before any byte arrives', () => {
    expect(downloadPercent(0, 1_000)).toBe(0)
  })

  it('is null when the host sent no total', () => {
    expect(downloadPercent(4_200_000, null)).toBeNull()
  })
})
