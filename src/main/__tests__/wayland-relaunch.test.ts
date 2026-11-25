import { WAYLAND_HINT_SWITCH, waylandRelaunchArgs } from '../wayland-relaunch'

jest.mock('electron', () => ({ app: { exit: jest.fn() } }))

const argv = ['/opt/openplc/open-plc-editor', '/home/user/project']
const wayland = { WAYLAND_DISPLAY: 'wayland-0' }

describe('waylandRelaunchArgs', () => {
  it('relaunches a packaged Linux GUI in a Wayland session with the hint first and the original arguments kept', () => {
    expect(waylandRelaunchArgs(argv, wayland, 'linux', true)).toEqual([WAYLAND_HINT_SWITCH, '/home/user/project'])
  })

  it('does not relaunch outside Linux', () => {
    expect(waylandRelaunchArgs(argv, wayland, 'win32', true)).toBeNull()
    expect(waylandRelaunchArgs(argv, wayland, 'darwin', true)).toBeNull()
  })

  it('does not relaunch an unpackaged run', () => {
    expect(waylandRelaunchArgs(argv, wayland, 'linux', false)).toBeNull()
  })

  it('does not relaunch outside a Wayland session', () => {
    expect(waylandRelaunchArgs(argv, {}, 'linux', true)).toBeNull()
    expect(waylandRelaunchArgs(argv, { WAYLAND_DISPLAY: '' }, 'linux', true)).toBeNull()
  })

  it('keeps an Ozone choice the user made on the command line or in the environment', () => {
    expect(waylandRelaunchArgs([...argv, '--ozone-platform=x11'], wayland, 'linux', true)).toBeNull()
    expect(waylandRelaunchArgs([...argv, '--ozone-platform-hint=wayland'], wayland, 'linux', true)).toBeNull()
    expect(waylandRelaunchArgs(argv, { ...wayland, ELECTRON_OZONE_PLATFORM_HINT: 'x11' }, 'linux', true)).toBeNull()
  })

  it('does not relaunch the relaunched process again', () => {
    const relaunched = waylandRelaunchArgs(argv, wayland, 'linux', true)
    expect(relaunched).not.toBeNull()
    expect(
      waylandRelaunchArgs(['/opt/openplc/open-plc-editor', ...(relaunched ?? [])], wayland, 'linux', true),
    ).toBeNull()
  })
})
