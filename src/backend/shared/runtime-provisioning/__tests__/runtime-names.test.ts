import {
  BOOTLOADER_CONTAINER,
  DOCKER_CONTAINER_RECORDS,
  INSTALLER_DOWNLOAD_FAILURE_MARKERS,
  INSTALLER_URL,
  NATIVE_UNIT,
  RUNTIME_CONTAINER,
  SUDO_PATH,
  V3_UNITS,
} from '../runtime-names'

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringLeaves)
  return []
}

describe('runtime names pinned to the openplc-runtime installer', () => {
  it('downloads the installer only from runtime.getedge.me over HTTPS', () => {
    expect(INSTALLER_URL).toBe('https://runtime.getedge.me')
  })

  it('names the runtime and bootloader containers as the installer creates them', () => {
    expect(RUNTIME_CONTAINER).toBe('openplc-runtime')
    expect(BOOTLOADER_CONTAINER).toBe('openplc-bootloader')
  })

  it('names the native v4 systemd unit', () => {
    expect(NATIVE_UNIT).toBe('openplc-runtime.service')
  })

  it('lists the three OpenPLC v3 systemd units in the installer order', () => {
    expect([...V3_UNITS]).toEqual(['openplc.service', 'openplc_v3.service', 'openplc-v3.service'])
  })

  it('runs sudo by its absolute path', () => {
    expect(SUDO_PATH).toBe('/usr/bin/sudo')
  })

  it('reads Docker container records from the default Docker data directory', () => {
    expect(DOCKER_CONTAINER_RECORDS).toBe('/var/lib/docker/containers')
  })

  it('holds exactly the installer download-failure marker texts', () => {
    expect(stringLeaves(INSTALLER_DOWNLOAD_FAILURE_MARKERS).sort()).toEqual(
      ['Could not download the Docker installer.', 'Could not pull ', 'and no local copy is present'].sort(),
    )
  })
})
