import { join } from 'node:path'

/**
 * Quote a filesystem path for YAML.
 *
 * Single quotes rather than double: a Windows path is full of backslashes, and
 * YAML's double-quoted style would read them as escapes.
 */
function yamlPath(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * The `arduino-cli.yaml` the editor ships, rooted at a directory it owns.
 *
 * `directories` is why this is composed at runtime instead of being a constant:
 * left unset, arduino-cli defaults to `~/.arduino15` (`AppData/Local/Arduino15`,
 * `~/Library/Arduino15`) and to the user's sketchbook — which are the Arduino
 * IDE's own directories, not ours. Every core and library the editor installs
 * would otherwise land in the middle of whatever the user has set up there, and
 * a pinned core version would change the version their IDE builds against.
 *
 * `directories.downloads` is deliberately left out: arduino-cli defaults it to
 * `{directories.data}/staging`, so it follows along on its own.
 */
export function buildArduinoCliConfig(root: string): string {
  return `directories:
  data: ${yamlPath(join(root, 'data'))}
  user: ${yamlPath(join(root, 'user'))}
${ARDUINO_DATA.trimStart()}`
}

export const ARDUINO_DATA = `
board_manager:
  additional_urls:
      - https://arduino.esp8266.com/stable/package_esp8266com_index.json
      - https://espressif.github.io/arduino-esp32/package_esp32_index.json
      - https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json
      - https://raw.githubusercontent.com/CONTROLLINO-PLC/CONTROLLINO_Library/master/Boards/package_ControllinoHardware_index.json
      - https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
      - https://facts-engineering.gitlab.io/facts-open-source/p1am/beta_file_hosting/package_productivity-P1AM_200-boardmanagermodule_index.json
      - https://raw.githubusercontent.com/facts-engineering/facts-engineering.github.io/master/package_productivity-P1AM-boardmanagermodule_index.json
      - https://raw.githubusercontent.com/VEA-SRL/IRUINO_Library/main/package_vea_index.json
      - https://github.com/CONTROLLINO-PLC/controllino_rp2/releases/download/global/package_controllino_rp2_index.json
      - https://downloads.arduino.cc/packages/package_zephyr_index.json
`

export const HISTORY_DATA = {
  projects: [],
  libraries: [],
}

export const SETTINGS_DATA = {
  'theme-preference': 'light',
  window: {
    bounds: {
      width: 1124,
      height: 628,
      x: 0,
      y: 0,
    },
  },
}
