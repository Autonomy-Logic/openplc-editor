import {
  BOOTLOADER_CONTAINER,
  DOCKER_CONTAINER_RECORDS,
  INSTALLER_URL,
  NATIVE_UNIT,
  RUNTIME_CONTAINER,
  SUDO_PATH,
  V3_UNITS,
} from './runtime-names'

export type Account = 'root' | 'sudo'

export interface DeviceCommand {
  command: string
  elevated: boolean
}

const PROBE_SYSTEM = [
  'echo "os=$(uname -s)"',
  'if [ -d /run/systemd/system ]; then echo systemd=yes; else echo systemd=no; fi',
  'echo "dpkg_arch=$(dpkg --print-architecture 2>/dev/null)"',
  'echo "machine=$(uname -m)"',
  'echo "long_bit=$(getconf LONG_BIT 2>/dev/null)"',
  'echo "uid=$(id -u)"',
].join('; ')

const UNIT_STATE_FUNCTION =
  'us() { l=$(systemctl show -p LoadState "$1" 2>/dev/null); ' +
  'if [ -z "${l#LoadState=}" ] || [ "$l" = LoadState=not-found ]; then echo absent; ' +
  'elif systemctl is-active --quiet "$1"; then echo active; else echo inactive; fi; }'

const CONTAINER_STATE_FUNCTION =
  'cs() { s=$(docker container inspect -f \'{{.State.Running}}\' "$1" 2>/dev/null) || { echo absent; return; }; ' +
  'if [ "$s" = true ]; then echo running; else echo stopped; fi; }'

const CONTAINER_RECORD_FUNCTION =
  `cr() { st=absent; for f in ${DOCKER_CONTAINER_RECORDS}/*/config.v2.json; do [ -f "$f" ] || continue; ` +
  'if grep -q "\\"Name\\":\\"/$1\\"" "$f"; then ' +
  `if grep -q '"Running":true' "$f"; then st=running; else st=stopped; fi; fi; done; echo "$st"; }`

const INSPECT_RUNTIME = [
  UNIT_STATE_FUNCTION,
  CONTAINER_STATE_FUNCTION,
  CONTAINER_RECORD_FUNCTION,
  'if command -v docker >/dev/null 2>&1; then if systemctl is-active --quiet docker; then dk=active; else dk=inactive; fi; else dk=absent; fi',
  `if [ "$dk" = active ]; then b=$(cs ${BOOTLOADER_CONTAINER}); r=$(cs ${RUNTIME_CONTAINER}); ` +
    `elif [ "$dk" = inactive ]; then b=$(cr ${BOOTLOADER_CONTAINER}); r=$(cr ${RUNTIME_CONTAINER}); ` +
    'else b=absent; r=absent; fi',
  'v=',
  `for u in ${V3_UNITS.join(' ')}; do if [ "$(us "$u")" != absent ]; then v="$v\${v:+,}$u"; fi; done`,
  'echo "docker=$dk"',
  'echo "bootloader=$b"',
  'echo "runtime_container=$r"',
  `echo "native=$(us ${NATIVE_UNIT})"`,
  'echo "v3=${v:-none}"',
].join('; ')

const PREPARE_INSTALLER = [
  'd=$(mktemp -d) || exit 1',
  'echo "dir=$d"',
  `if curl --proto '=https' --proto-redir '=https' -fsSL ${INSTALLER_URL} -o "$d/install.sh"; ` +
    'then echo download=ok; else echo download=failed; fi',
].join('; ')

const DOCKER_PRESENT = 'if command -v docker >/dev/null 2>&1; then echo docker=yes; else echo docker=no; fi'

export const PROVISIONING_COMMANDS: {
  probeSystem: DeviceCommand
  privilegeCheck: DeviceCommand
  inspectRuntime: DeviceCommand
  startDockerAndBootloader: DeviceCommand
  startBootloader: DeviceCommand
  startRuntimeContainer: DeviceCommand
  startNativeService: DeviceCommand
  prepareInstaller: DeviceCommand
  dockerPresent: DeviceCommand
} = {
  probeSystem: { command: PROBE_SYSTEM, elevated: false },
  privilegeCheck: { command: '/bin/true', elevated: true },
  inspectRuntime: { command: INSPECT_RUNTIME, elevated: true },
  startDockerAndBootloader: {
    command: `systemctl start docker && docker start ${BOOTLOADER_CONTAINER}`,
    elevated: true,
  },
  startBootloader: { command: `docker start ${BOOTLOADER_CONTAINER}`, elevated: true },
  startRuntimeContainer: { command: `docker start ${RUNTIME_CONTAINER}`, elevated: true },
  startNativeService: { command: `systemctl start ${NATIVE_UNIT}`, elevated: true },
  prepareInstaller: { command: PREPARE_INSTALLER, elevated: true },
  dockerPresent: { command: DOCKER_PRESENT, elevated: true },
}

export function startInstallerCommand(dir: string): DeviceCommand {
  const job = `bash ${dir}/install.sh >${dir}/install.log 2>&1; echo $? >${dir}/exit.tmp && mv ${dir}/exit.tmp ${dir}/exit`
  return { command: `setsid sh -c '${job}' </dev/null >/dev/null 2>&1 &`, elevated: true }
}

export function pollInstallerCommand(dir: string, offset: number, maxBytes: number): DeviceCommand {
  const command = [
    `if [ -f ${dir}/exit ]; then e=$(cat ${dir}/exit); else e=running; fi`,
    `s=$(wc -c <${dir}/install.log 2>/dev/null) || s=0`,
    `f=${offset}`,
    `t=$((s - ${maxBytes}))`,
    'if [ "$t" -gt "$f" ]; then f=$t; fi',
    'printf \'exit=%s\\nsize=%s\\nfrom=%s\\n---\\n\' "$e" "$s" "$f"',
    `if [ "$s" -gt "$f" ]; then tail -c +$((f + 1)) ${dir}/install.log | head -c $((s - f)); fi`,
  ].join('; ')
  return { command, elevated: true }
}

function singleQuoted(text: string): string {
  return `'${text.split("'").join("'\\''")}'`
}

export function buildExec(cmd: DeviceCommand, account: Account): { command: string; sendsPassword: boolean } {
  if (!cmd.elevated || account === 'root') return { command: cmd.command, sendsPassword: false }
  return {
    command: `${SUDO_PATH} -S -k -p '' sh -c ${singleQuoted(`${cmd.command} </dev/null`)}`,
    sendsPassword: true,
  }
}
