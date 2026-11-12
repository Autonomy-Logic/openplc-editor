export const INSTALLER_URL = 'https://runtime.getedge.me'

export const RUNTIME_CONTAINER = 'openplc-runtime'

export const BOOTLOADER_CONTAINER = 'openplc-bootloader'

export const NATIVE_UNIT = 'openplc-runtime.service'

export const V3_UNITS: readonly string[] = ['openplc.service', 'openplc_v3.service', 'openplc-v3.service']

export const SUDO_PATH = '/usr/bin/sudo'

export const DOCKER_CONTAINER_RECORDS = '/var/lib/docker/containers'

export const INSTALLER_DOWNLOAD_FAILURE_MARKERS: readonly (readonly string[])[] = [
  ['Could not download the Docker installer.'],
  ['Could not pull ', 'and no local copy is present'],
]
