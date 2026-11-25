import {
  CLANG_MAX_WORKERS,
  clangWorkerLimit,
  darwinAvailableBytes,
  linuxAvailableBytes,
  webAvailableBytes,
} from '../worker-limit'

const GIB = 1024 * 1024 * 1024
const MIB = 1024 * 1024

describe('clangWorkerLimit', () => {
  it('runs one worker when the free memory is unknown', () => {
    expect(clangWorkerLimit(undefined, 16)).toBe(1)
    expect(clangWorkerLimit(Number.NaN, 16)).toBe(1)
  })

  it('adds a worker for each 640 MB free beyond a 1 GB reserve, up to one less than the processors and four', () => {
    expect(clangWorkerLimit(GIB + 639 * MIB, 16)).toBe(1)
    expect(clangWorkerLimit(GIB + 640 * MIB, 16)).toBe(2)
    expect(clangWorkerLimit(GIB + 3 * 640 * MIB, 16)).toBe(CLANG_MAX_WORKERS)
    expect(clangWorkerLimit(64 * GIB, 16)).toBe(CLANG_MAX_WORKERS)
    expect(clangWorkerLimit(64 * GIB, 3)).toBe(2)
    expect(clangWorkerLimit(64 * GIB, 1)).toBe(1)
    expect(clangWorkerLimit(256 * MIB, 16)).toBe(1)
  })
})

describe('available memory as the OS reports it', () => {
  it('counts free, inactive, purgeable and speculative pages of vm_stat on macOS', () => {
    const vmStat = [
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages free:                                     8833.',
      'Pages active:                                 448286.',
      'Pages inactive:                               445196.',
      'Pages speculative:                              2206.',
      'Pages wired down:                             227925.',
      'Pages purgeable:                               26571.',
    ].join('\n')
    expect(darwinAvailableBytes(vmStat)).toBe((8833 + 445196 + 26571 + 2206) * 16384)
    expect(darwinAvailableBytes('Pages free: 12.')).toBeUndefined()
  })

  it("reads MemAvailable of Linux's /proc/meminfo", () => {
    expect(linuxAvailableBytes('MemTotal:       16000000 kB\nMemAvailable:    8000000 kB\n')).toBe(8000000 * 1024)
    expect(linuxAvailableBytes('MemTotal:       16000000 kB\n')).toBeUndefined()
  })

  it('counts a quarter of the device memory a browser reports, and nothing where it reports none', () => {
    expect(webAvailableBytes(8)).toBe(2 * GIB)
    expect(webAvailableBytes(undefined)).toBeUndefined()
    expect(webAvailableBytes(0)).toBeUndefined()
  })
})
