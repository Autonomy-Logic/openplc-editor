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
 *
 * `builtin.libraries` points back at the sketchbook we just moved away from, and
 * that asymmetry is deliberate. Users install libraries through the Arduino IDE
 * and call them from C++ blocks here: a display driver, an Ethernet stack for a
 * W5500. Owning our directories must not cost them that. arduino-cli documents
 * this key as available to every platform without installation and at the LOWEST
 * priority, which is exactly the split wanted: their libraries stay reachable,
 * ours win any name collision, and nothing we install is ever written there.
 * Cores are untouched by it, which is the other half of the split.
 *
 * `userLibraries` pointing at a directory that does not exist is fine and is the
 * normal case on a machine that never had the Arduino IDE; arduino-cli ignores
 * it and the build succeeds.
 */
export function buildArduinoCliConfig(root: string, userLibraries: string): string {
  return `directories:
  data: ${yamlPath(join(root, 'data'))}
  user: ${yamlPath(join(root, 'user'))}
  builtin:
    libraries: ${yamlPath(userLibraries)}
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
library:
  # Required for \`lib install --git-url\`, which is how the editor installs the
  # third-party libraries some targets need (open62541 for OPC-UA, and more to
  # come). arduino-cli refuses --git-url outright without it:
  #
  #   --git-url and --zip-path are disabled by default
  #
  # There is no alternative: the library index URL is hardcoded in the
  # arduino-cli binary, so a private library registry is not possible, and
  # \`board_manager.additional_urls\` covers platforms only, not libraries.
  #
  # Scope is narrow. Every arduino-cli invocation the editor makes carries
  # \`--config-file\` pointing at THIS file, so the setting applies to the
  # editor's own commands and nothing else — a user's own arduino-cli, or the
  # Arduino IDE, keeps its default protection.
  enable_unsafe_install: true
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
