/** The devices a screen can be designed and previewed on: logical size in lu and device pixels per lu. */
export interface HmiDevicePreset {
  id: string
  label: string
  width: number
  height: number
  density: number
}

export const HMI_DEVICE_PRESETS: readonly HmiDevicePreset[] = [
  { id: 'browser', label: 'Browser', width: 640, height: 400, density: 2 },
  { id: 'browser-1x', label: 'Browser @1x', width: 1280, height: 800, density: 1 },
  { id: 'panel-7', label: '7" panel', width: 800, height: 480, density: 1 },
  { id: 'cyd', label: 'ESP32 CYD', width: 320, height: 240, density: 1 },
  { id: 'phone', label: 'Phone', width: 390, height: 844, density: 3 },
]

export const DEFAULT_HMI_DEVICE = 'browser'

export function hmiDevicePreset(id: string): HmiDevicePreset {
  return HMI_DEVICE_PRESETS.find((d) => d.id === id) ?? HMI_DEVICE_PRESETS[0]
}
