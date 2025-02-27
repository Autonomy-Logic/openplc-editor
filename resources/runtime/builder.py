import json
import os
import platform as os_platform
import shutil
import subprocess
import multiprocessing as os_multiprocessing
from datetime import datetime
from enum import Enum, auto, unique
from typing import List, Set
import sys
import time
import select
from typing import Tuple, Optional
import re
from gettext import ngettext as _n
# from asciidoc.a2x import cli

# List of OPLC dependencies
# This list can be reduced, as soon as the HALs list provides board specific library dependencies.
OPLC_DEPS = [
    'WiFiNINA',
    'Ethernet',
    'Arduino_MachineControl',
    'Arduino_EdgeControl',
    'OneWire',
    'DallasTemperature',
    'P1AM',
    'CONTROLLINO',
    'PubSubClient',
    'ArduinoJson',
    'ArduinoMqttClient',
    'RP2040_PWM',
    'AVR_PWM',
    'megaAVR_PWM',
    'SAMD_PWM',
    'SAMDUE_PWM',
    'Portenta_H7_PWM',
    'CAN',
    'STM32_CAN',
    'STM32_PWM'
]


_arduino_src_path = 'editor/arduino/src'
_arduino_ino_base_path = 'editor/arduino/examples/Baremetal'
_cli_command = []
_iec_transpiler = ''

@unique
class BuildCacheOption(Enum):
    USE_CACHE = auto()
    CLEAN_BUILD = auto()
    UPGRADE_CORE = auto()
    UPGRADE_LIBS = auto()
    CLEAN_LIBS = auto()
    MR_PROPER = auto()

    def __lt__(self, other):
        if self.__class__ is other.__class__:
            return self.value < other.value
        return NotImplemented

    def __le__(self, other):
        if self.__class__ is other.__class__:
            return self.value <= other.value
        return NotImplemented

    def __gt__(self, other):
        if self.__class__ is other.__class__:
            return self.value > other.value
        return NotImplemented

    def __ge__(self, other):
        if self.__class__ is other.__class__:
            return self.value >= other.value
        return NotImplemented

    def __eq__(self, other):
        if self.__class__ is other.__class__:
            return self.value == other.value
        return NotImplemented

    def __ne__(self, other):
        if self.__class__ is other.__class__:
            return self.value != other.value
        return NotImplemented

def append_compiler_log(send_text, output):
    log_file_path = os.path.join(_arduino_src_path, 'build.log')
    try:
        with open(log_file_path, 'a', newline='') as log_file:
            lines = output.splitlines()
            for line in lines:
                timestamp = datetime.now().isoformat(timespec='milliseconds')
                log_file.write(f"[{timestamp}] {line}\n")
    except IOError as e:
        print(f"Fehler beim Schreiben in die Logdatei: {e}")

    send_text(output)

def runCommand(command):
    """
    Executes a command and returns its output.
    
    Args:
        command: Command to execute, either as a list of arguments or as a string.
                List format is preferred for safe handling of paths containing spaces.
                Example list: ['path/to/program', '--arg1', 'value1', '--arg2']
                
    Returns:
        str: Command output as UTF-8 string
        
    Raises:
        subprocess.CalledProcessError: If command execution fails
    """
    cmd_response = None
    kwargs = {
        'stderr': subprocess.STDOUT
    }
    
    # Add Windows-specific flags to prevent console window popup
    if os.name in ("nt", "ce"):
        kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
    
    try:
        if isinstance(command, str):
            # Legacy support for string commands
            kwargs['shell'] = True
            cmd_response = subprocess.check_output(command, **kwargs)
        else:
            # List commands executed without shell - safe for paths with spaces
            kwargs['shell'] = False
            cmd_response = subprocess.check_output(command, **kwargs)
            
    except subprocess.CalledProcessError as exc:
        cmd_response = exc.output
        
    if cmd_response is None:
        return ''
        
    return cmd_response.decode('utf-8', errors='backslashreplace')
def read_output(process, send_text, timeout=None):
    start_time = time.time()
    return_code = 0

    while True:
        output = process.stdout.readline()
        if output:
            append_compiler_log(send_text, output)

        # check for process exit
        poll_result = process.poll()
        if poll_result is not None:
            # process terminated, read remaining output data
            for line in process.stdout:
                append_compiler_log(send_text, line)
            return_code = poll_result
            break

        # watch for the timeout
        if (timeout is not None) and ((time.time() - start_time) > timeout):
            process.kill()
            return_code = -1  # timeout error code
            break

        # brief sleep to reduce CPU load
        time.sleep(0.02)

    return return_code

def runCommandToWin(send_text, command, cwd=None, timeout=None):
    return_code = -2  # default value for unexpected errors
    append_compiler_log(send_text, '$ ' + ' '.join(map(str, command)) + '\n')

    popenargs = {
            "cwd":    os.getcwd() if cwd is None else cwd,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "bufsize": 1,
            "universal_newlines": True,
            "close_fds": True,
            "encoding": "utf-8",
            "errors": "backslashreplace"
        }

    try:
        # add extra flags for Windows
        if os.name in ("nt", "ce"):
            popenargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        # start the sub process
        compilation = subprocess.Popen(command, **popenargs)

        return_code = read_output(compilation, send_text, timeout)
        append_compiler_log(send_text, '$? = ' + str(return_code) + '\n')

    except subprocess.CalledProcessError as exc:
        append_compiler_log(send_text, exc.output)
        return_code = exc.returncode if exc.returncode is not None else -3

    return return_code

def log_host_info(send_text):
    # Number of logical CPU cores
    logical_cores = os_multiprocessing.cpu_count()

    # System architecture
    architecture = os_platform.architecture()[0]

    # Processor name
    processor = os_platform.processor()

    # Operating system
    os_name = os_platform.system()

    append_compiler_log(send_text, f"Host architecture: {architecture}\n")
    append_compiler_log(send_text, f"Processor: {processor}\n")
    append_compiler_log(send_text, f"Logical CPU cores: {logical_cores}\n")
    append_compiler_log(send_text, f"Operating system: {os_name}\n")

    # Additional information for Linux systems
    if os_name == "Linux":
        try:
            with open("/proc/cpuinfo", "r") as f:
                cpu_info = f.read()

            # Physical cores (rough estimate)
            physical_cores = len([line for line in cpu_info.split('\n') if line.startswith("physical id")])
            append_compiler_log(send_text, f"Estimated physical CPU cores: {physical_cores or 'Not available'}\n")

            # CPU frequency
            cpu_mhz = [line for line in cpu_info.split('\n') if "cpu MHz" in line]
            if cpu_mhz:
                append_compiler_log(send_text, f"CPU frequency: {cpu_mhz[0].split(':')[1].strip()} MHz\n")
            else:
                append_compiler_log(send_text, "CPU frequency: Not available\n")

        except Exception as e:
            append_compiler_log(send_text, f"Error reading /proc/cpuinfo: {e}\n")

    # Additional information for macOS systems
    elif os_name == "Darwin":  # Darwin is the core of macOS
        try:
            # Physical cores
            physical_cores = int(subprocess.check_output(["sysctl", "-n", "hw.physicalcpu"]).decode().strip())
            append_compiler_log(send_text, f"Physical CPU cores: {physical_cores}\n")

            # CPU frequency
            cpu_freq = subprocess.check_output(["sysctl", "-n", "hw.cpufrequency"]).decode().strip()
            cpu_freq_mhz = int(cpu_freq) / 1000000  # Convert Hz to MHz
            append_compiler_log(send_text, f"CPU frequency: {cpu_freq_mhz:.2f} MHz\n")

            # CPU model
            cpu_model = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"]).decode().strip()
            append_compiler_log(send_text, f"CPU model: {cpu_model}\n")

        except Exception as e:
            append_compiler_log(send_text, f"Error getting macOS CPU info: {e}\n")

    path_content = os.environ.get('PATH', '')
    append_compiler_log(send_text, "\n" + _("active PATH Variable") + ":\n" + path_content + "\n\n")

def are_libraries_installed(lib_list: List[str]) -> List[str]:
    """
    Check if the specified Arduino libraries are installed.
    
    Args:
        lib_list: List of library names to check
        
    Returns:
        List[str]: List of libraries that are not installed
    """
    try:
        # Get list of installed libraries in JSON format
        cmd = _cli_command + ['--json', 'lib', 'list']
        result = runCommand(cmd)
        
        if not result:
            return lib_list
            
        # Parse JSON output
        libraries_data = json.loads(result)
        
        # Get set of installed library names
        installed_libs = {
            lib.get('library', {}).get('name')
            for lib in libraries_data.get('installed_libraries', [])
        }
        
        # Return list of libraries that are not in installed set
        return [lib for lib in lib_list if lib not in installed_libs]
        
    except json.JSONDecodeError as e:
        append_compiler_log(send_text, _("Error parsing JSON output while checking libraries: {error}").format(error=str(e)) + '\n')
        return lib_list
    except Exception as e:
        append_compiler_log(send_text, _("Error checking libraries: {error}").format(error=str(e)) + '\n')
        return lib_list

def check_libraries_status() -> Tuple[int, str]:
    """
    Check the status of Arduino libraries using JSON output format.
    
    Returns:
        Tuple[int, str]: (Status code, Description)
        Status codes:
        0 - All up to date
        1 - Updates available
        2 - Error checking libraries
    """
    try:
        # Check for available updates using JSON format
        cmd = _cli_command + ['--json', 'lib', 'list', '--updatable']
        json_output = runCommand(cmd)
        
        # Parse JSON output
        lib_data = json.loads(json_output)
        updatable_libs = lib_data.get('installed_libraries', [])
        
        if not updatable_libs:
            return (0, _("All libraries are up to date"))
        
        lib_count = len(updatable_libs)
        return (1, _n(
            "Update available for {count} library",
            "Updates available for {count} libraries",
            lib_count
        ).format(count=lib_count))
            
    except json.JSONDecodeError as e:
        return (2, _("Error parsing JSON output: {error_message}").format(error_message=str(e)))
    except Exception as e:
        return (2, _("Error checking libraries: {error_message}").format(error_message=str(e)))
    
def get_installed_libraries(cli_command_str) -> List[str]:
    #print("Executing command:", cli_command_str + " lib list --json")
    cmd = _cli_command + ['--json', 'lib', 'list']
    libraries_json = runCommand(cmd)

    libraries_data = json.loads(libraries_json)
    installed_libs = []

    for lib in libraries_data.get("installed_libraries", []):
        lib_name = lib.get("library", {}).get("name")
        if lib_name:
            installed_libs.append(lib_name)

    #print("Installed libraries:", installed_libs)
    return installed_libs

def clean_libraries(send_text, _cli_command):
    # the intended behavior is to keep the list of installed libraries identical, but remove all and re-install all of them
    return_code = 0
    append_compiler_log(send_text, _("Cleaning libraries") + "...\n")
    installed_libraries = get_installed_libraries(' '.join(_cli_command))

    # Merge installed libraries with OPLC_DEPS and remove duplicates
    all_libraries: Set[str] = set(installed_libraries + OPLC_DEPS)

    append_compiler_log(send_text, _n(
        "Processing {count} library",
        "Processing {count} libraries",
        len(all_libraries)
    ).format(count=len(all_libraries)) + "\n")
    
    for lib in all_libraries:
        append_compiler_log(send_text, _("Processing library: {lib}").format(lib=lib) + "\n")
        runCommandToWin(send_text, _cli_command + ['lib', 'uninstall', lib])
        return_code = runCommandToWin(send_text, _cli_command + ['lib', 'install', lib])
        if (return_code != 0):
            append_compiler_log(send_text, '\n' + _('LIBRARIES INSTALLATION FAILED') + ': ' + lib + '\n')
            return

    return return_code

def upgrade_libraries(send_text) -> Tuple[bool, str]:
    """
    Performs upgrade of all outdated libraries.
    
    Returns:
        Tuple[bool, str]: (Success, Description)
    """
    try:
        # Update library index
        cmd = _cli_command + ['lib', 'update-index']
        runCommandToWin(send_text, cmd)
        
        # Check for updates
        status, message = check_libraries_status()
        if status == 0:  # All up to date
            return (True, message)
        elif status == 2:  # Error
            return (False, message)
            
        # Perform upgrade
        cmd = _cli_command + ['lib', 'upgrade']
        result = runCommandToWin(send_text, cmd)
        return (True, _("Libraries upgrade completed."))
            
    except Exception as e:
        return (False, _("Libraries upgrade failed: {error_message}").format(error_message=str(e)))

def get_cores_json(updatable: bool = False) -> dict:
    """
    Get JSON data of available Arduino cores.
    
    Args:
        updatable: If True, only return cores with available updates
        
    Returns:
        dict: Parsed JSON data of available cores. Empty dict if input is not a dict.
        The 'platforms' member will always be a list/tuple.
        
    Raises:
        json.JSONDecodeError: If JSON parsing fails
        subprocess.CalledProcessError: If command execution fails
    """
    # Build command
    cmd = _cli_command + ['--json', 'core', 'list']
    if updatable:
        cmd.append('--updatable')
        
    # Run command and get output
    result = runCommand(cmd)
    
    # Parse JSON output
    cores_data = json.loads(result)
    
    # Return empty dict if input is not a dict
    if not isinstance(cores_data, dict):
        return {}
        
    # Extract and validate platforms array, defaulting to empty list if not found
    platforms = cores_data.get('platforms', [])
    if not isinstance(platforms, (list, tuple)):
        platforms = []
    
    # Update platforms member with validated data
    cores_data['platforms'] = platforms
    
    return cores_data

def get_core_version(core_id: str) -> Optional[str]:
    """
    Get the installed version of a specific Arduino core.
    
    Args:
        core_id: The ID of the core (e.g. 'esp32:esp32')
        
    Returns:
        The installed version as string or None if core is not installed
    """
    cores_data = get_cores_json()
    
    # Search for the specified core
    for platform in cores_data['platforms']:
        if platform.get('id') == core_id:
            return platform.get('installed_version')
            
    return None

def check_core_status(core_name: str, updateCheck: bool = True) -> Tuple[int, str]:
    """
    Check the status of an Arduino core using JSON output.
    
    Args:
        core_name: Name of the core (e.g. "esp32:esp32")
        
    Returns:
        Tuple[int, str]: (Status code, Description)
        Status codes:
        0 - Up to date or no action needed
        1 - Reinstallation recommended
        2 - First installation needed
    """
    if updateCheck:
        cmd = _cli_command + ['--json', 'core', 'update-index']
        result = runCommand(cmd)
        update_data = json.loads(result)
        
        if 'error' in update_data:
            return (2, _("Error updating core index: {error}").format(
                error=update_data.get('error', 'Unknown error')))
    
    # Check if core is installed using get_cores_json()
    cores_data = get_cores_json()
    
    core_found = False
    for platform in cores_data['platforms']:
        if platform.get('id') == core_name:
            core_found = True
            break
            
    if not core_found:
        return (2, _("Core {core_name} is not installed").format(core_name=core_name))
    
    if not updateCheck:
        return (0, _("Core {core_name} is installed").format(core_name=core_name))
    
    # Check for available updates using get_cores_json()
    updates_data = get_cores_json(updatable=True)
    
    for platform in updates_data['platforms']:
        if platform.get('id') == core_name:
            return (1, _("Updates found for {core_name}").format(core_name=core_name))
    
    return (0, _("No updates available for {core_name}").format(core_name=core_name))
    
def reinstall_core(send_text, core_name: str) -> Tuple[bool, str]:
    """
    Forces complete reinstallation of core.
    
    Args:
        core_name: Name of the core (e.g. "esp32:esp32")
        
    Returns:
        Tuple[bool, str]: (Success, Description)
    """
    cmd = _cli_command + ['core', 'update-index']
    runCommandToWin(send_text, cmd)
    
    # Check if core exists using get_cores_json()
    cores_data = get_cores_json()
    
    core_installed = any(
        platform.get('id') == core_name 
        for platform in cores_data['platforms']
    )
    
    # Remove core if exists
    if core_installed:
        cmd = _cli_command + ['core', 'uninstall', core_name]
        runCommandToWin(send_text, cmd)
    
    # Install core
    cmd = _cli_command + ['core', 'install', core_name]
    result = runCommandToWin(send_text, cmd)
    if result != 0:
        return (False, _("Core reinstallation failed."))
    
    return (True, _("Core reinstallation completed.").format(result=result))

def upgrade_core(send_text, core_name: str, status = None) -> Tuple[bool, str]:
    """
    Performs necessary update actions for a core.
    
    Args:
        core_name: Name of the core (e.g. "esp32:esp32")
        
    Returns:
        Tuple[bool, str]: (Success, Description)
    """
    try:
        # Update index
        cmd = _cli_command + ['core', 'update-index']
        result = runCommandToWin(send_text, cmd)
        
        if status is None:
            # Check status
            status, message = check_core_status(core_name)
        
        if status == 0:
            # Double-check for updates with JSON output
            cmd = _cli_command + ['--json', 'core', 'list', '--updatable']
            result = runCommand(cmd)
            updates_data = json.loads(result)
            updatable_platforms = get_platform_list(updates_data)
            
            core_needs_update = any(
                platform.get('id') == core_name 
                for platform in updatable_platforms
            )
            
            if core_needs_update:
                cmd = _cli_command + ['core', 'upgrade', core_name]
                result = runCommandToWin(send_text, cmd)
                if result != 0:
                    return (False, _("Upgrade failed."))
                return (True, _("Upgrade successful."))
            return (True, _("No action needed"))
            
        elif status == 1:
            # Perform reinstallation
            cmd = _cli_command + ['core', 'uninstall', core_name]
            runCommandToWin(send_text, cmd)
            cmd = _cli_command + ['core', 'install', core_name]
            result = runCommandToWin(send_text, cmd)
            if result != 0:
                return (False, _("Reinstallation failed."))
            return (True, _("Reinstallation successful."))
            
        elif status == 2:
            # Perform first installation
            cmd = _cli_command + ['core', 'install', core_name]
            result = runCommandToWin(send_text, cmd)
            if result != 0:
                return (False, _("Initial core installation failed."))
            return (True, _("Initial core installation successful."))
            
    except Exception as e:
        return (False, _("Error with {core_name}: {err_msg}").format(core_name=core_name, err_msg=str(e)))

def is_board_url_configured(url: str) -> bool:
    """
    Check if a specific board manager URL is configured in arduino-cli.
    
    Args:
        url: Board manager URL to check
        
    Returns:
        bool: True if URL is configured, False otherwise
    """
    try:
        # Get current config
        cmd = _cli_command + ['config', 'dump', '--format', 'json']
        result = runCommand(cmd)
        
        # Parse JSON output
        config = json.loads(result)
        
        # Check if URL exists in board manager URLs
        configured_urls = config.get('config', {}).get('board_manager', {}).get('additional_urls', [])
        return url in configured_urls
        
    except Exception as e:
        print(f"Error checking board URL configuration: {e}")
        return False

def build(st_file, definitions, arduino_sketch, port, send_text, board_hal, build_option):
    """
    Build and optionally upload Arduino program with specified build cache options.
    
    Args:
        st_file: Content of the ST (Structured Text) file
        port: Serial port for upload (optional)
        send_text: Callback for user notifications
        board_hal: Board HAL configuration
        build_option: BuildCacheOption enum value
    """
    
    arduino_platform = board_hal['platform']
    source_file = board_hal['source']
    required_libs = OPLC_DEPS   # in the future this might take project libraries, board specific libraries and extension specific libraries too

    def setup_environment() -> bool:
        # Clear build log
        open(os.path.join(_arduino_src_path, 'build.log'), 'w').close()
        log_host_info(send_text)
        
        # Clean old files
        old_files = ['POUS.c', 'POUS.h', 'LOCATED_VARIABLES.h', 
                    'VARIABLES.csv', 'Config0.c', 'Config0.h', 'Res0.c']
        for file in old_files:
            if os.path.exists(os.path.join(_arduino_src_path, file)):
                os.remove(os.path.join(_arduino_src_path, file))
            
        return True

    def verify_prerequisites() -> bool:
        # Check MatIEC compiler
        if not os.path.exists(_iec_transpiler):
            append_compiler_log(send_text, _("Error: iec2c compiler not found!") + '\n')
            return False
            
        if not os.path.exists(_cli_command[0]):
            append_compiler_log(send_text, _("Error: arduino-cli not found!") + '\n')
            return False
        
        runCommandToWin(send_text, [_iec_transpiler, '-v'])
        runCommandToWin(send_text, _cli_command + ['version'])
        
        return True

    def handle_board_installation() -> bool:
        append_compiler_log(send_text, 'Checking Core and Board installation...\n')
        core = board_hal['core']
        core_status, message = check_core_status(core, (build_option > BuildCacheOption.USE_CACHE))
        append_compiler_log(send_text, f'{message}\n')
        
        board_manager_url = board_hal.get('board_manager_url', None)
        if board_manager_url:
            board_installed = is_board_url_configured(board_manager_url)
        else:
            board_installed = re.match(r"arduino:.*", core) # usually all/only arduino cores do not need an additional board manager URL
        
        if not board_installed or build_option >= BuildCacheOption.MR_PROPER:
            append_compiler_log(send_text, _("Cleaning download cache") + "...\n")
            if runCommandToWin(send_text, _cli_command + ['cache', 'clean']) != 0:
                return False
                
            # Initialize config
            runCommandToWin(send_text, _cli_command + ['config', 'init'])    # ignore return value, most the time we would need '--overwrite', which is not our intent
                
            # Handle board manager URL if present
            if board_manager_url:
                cmds = [
                    ['config', 'remove', 'board_manager.additional_urls', board_manager_url],
                    ['config', 'add', 'board_manager.additional_urls', board_manager_url]
                ]
                for cmd in cmds:
                    if runCommandToWin(send_text, _cli_command + cmd) != 0:
                        return False
            
            # Install core
            success, message = reinstall_core(send_text, core)
            if not success:
                append_compiler_log(send_text, f'\n{message}\n')
                return False
            
            board_hal['last_update'] = time.time()
            board_hal['version'] = get_core_version(core)
            
        # Handle core updates based on build option
        elif core_status > 1 or build_option >= BuildCacheOption.UPGRADE_CORE:
            success, message = upgrade_core(send_text, core, core_status)
            if not success:
                append_compiler_log(send_text, f'\n{message}\n')
                return False
            
            board_hal['last_update'] = time.time()
            board_hal['version'] = get_core_version(core)
                
        append_compiler_log(send_text, f'\n')
        return True

    def check_required_libraries() -> bool:
        """
        Check if all required libraries are installed and install missing ones.
        
        Inputs:
            send_text: Function to handle output messages
            required_libs: List of required library names
            
        Returns:
            bool: True if all libraries are installed or were successfully installed,
                  False if any library couldn't be installed
        """
        append_compiler_log(send_text, _("Checking required libraries...") + '\n')
        
        # Check which libraries need to be installed
        missing_libs = are_libraries_installed(required_libs)
        
        if not missing_libs:
            append_compiler_log(send_text, _("All required libraries are already installed.") + '\n')
            return True
        
        # Update the library index before installation
        try:
            cmd = _cli_command + ['lib', 'update-index']
            result = runCommandToWin(send_text, cmd)
        except Exception as e:
            append_compiler_log(send_text, _("Error updating library index: {error}").format(error=str(e)) + '\n')
            return False
        
        # Try to install missing libraries
        append_compiler_log(send_text, _n(
            "Installing {count} missing library",
            "Installing {count} missing libraries",
            len(missing_libs)
        ).format(count=len(missing_libs)) + '\n')
        
        for lib in missing_libs:
            append_compiler_log(send_text, _("Installing library: {lib}").format(lib=lib) + '\n')
            try:
                cmd = _cli_command + ['lib', 'install', lib]
                result = runCommand(cmd)
            except Exception as e:
                append_compiler_log(send_text, _("Error installing library {lib}: {error}").format(lib=lib, error=str(e)) + '\n')
                return False
        
        # Verify all libraries are now installed
        still_missing = are_libraries_installed(required_libs)
        if still_missing:
            append_compiler_log(send_text, _n(
                "Failed to install {count} library: {libs}",
                "Failed to install {count} libraries: {libs}",
                len(still_missing)
            ).format(count=len(still_missing), libs=', '.join(still_missing)) + '\n')
            return False
            
        append_compiler_log(send_text, _("All required libraries have been successfully installed.") + '\n')
        return True

    def update_libraries() -> bool:
        if build_option > BuildCacheOption.USE_CACHE:
            append_compiler_log(send_text, _('Checking Libraries status...') + '\n')
            libraries_status, message = check_libraries_status()
            append_compiler_log(send_text, f'{message}\n')
            
            if build_option >= BuildCacheOption.CLEAN_LIBS:
                return_code = clean_libraries(send_text, _cli_command)
            elif build_option >= BuildCacheOption.UPGRADE_LIBS:
                success, message = upgrade_libraries(send_text)
                if not success:
                    append_compiler_log(send_text, f'\n{message}\n')
                    return False
            
            append_compiler_log(send_text, f'\n')
        return True

    def compile_st_file() -> bool:
        append_compiler_log(send_text, _("Compiling .st file...") + '\n')
        
        # Write ST file
        with open(f'{_arduino_src_path}/plc_prog.st', 'w') as f:
            f.write(st_file)
            f.flush()
        
        time.sleep(0.2)  # ensure file is written
        
        # Compile based on platform
        cmd = [_iec_transpiler, '-f', '-l', '-p', 'plc_prog.st']
        cwd = _arduino_src_path
            
        return runCommandToWin(send_text, cmd, cwd=cwd) == 0
    
    def provide_hal_data() -> bool:
        append_compiler_log(send_text, _("Copying HAL source file...") + '\n')

        # Copy HAL file
        shutil.copyfile(f'{_arduino_src_path}/hal/{source_file}', f'{_arduino_src_path}/arduino.cpp')
        
        return True

    def write_definitions_file():
        """
        Write definitions array to defines.h file
        
        Inputs:
            definitions (list): List of definition strings
            _arduino_src_path (str): Base path for Arduino project
            send_text (callable): Function to handle output messages
            
        Returns:
            bool: True if successful, False if error occurred
        """
        defines_path = os.path.join(_arduino_ino_base_path, 'defines.h')
        append_compiler_log(send_text, _("Generating definitions file '{defines_h}'...").format(defines_h=defines_path) + '\n')
        
        try:
            with open(defines_path, 'w') as f:
                # Defines from hal
                if 'define' in board_hal:
                    f.write('// Board defines\n')
                    board_define = board_hal['define']
                    # Handle both string and array cases
                    if isinstance(board_define, str):
                        f.write(f'#define {board_define}\n')
                    elif isinstance(board_define, list):
                        for define in board_define:
                            f.write(f'#define {define}\n')
                    
                    f.write('\n\n')

                if arduino_sketch:
                    f.write('// Project defines\n')
                    f.write('#define USE_ARDUINO_SKETCH\n')
                    f.write('#define ARDUINO_PLATFORM\n')
                    f.write('\n\n')
                            
                content = '\n'.join(definitions)
                f.write(content)
                
                f.flush()
            return True
                
        except IOError as e:
            append_compiler_log(send_text, _("Error writing defines.h: {err_msg}\n").format(err_msg=str(e)))
            return False
        
    def write_arduino_sketch():
        """
        Write Arduino sketch to header file if sketch exists
        
        Inputs:
            arduino_sketch (str): Arduino sketch content or None
            _arduino_src_path (str): Base path for Arduino project
            send_text (callable): Function to handle output messages
            
        Returns:
            bool: True if successful or no sketch provided, False if error occurred
        """
        sketch_path = os.path.join(_arduino_ino_base_path, 'ext', 'arduino_sketch.h')
        
            # Delete existing file if it exists
        try:
            os.remove(sketch_path)
        except FileNotFoundError:
            pass  # File doesn't exist yet - that's fine
        except OSError as e:
            append_compiler_log(send_text, _("Error removing old arduino_sketch.h: {err_msg}\n").format(err_msg=str(e)))
            return False
    
        if arduino_sketch is None:
            return True
            
        append_compiler_log(send_text, _("Adding arduino sketch file {sketch_h}...").format(sketch_h=sketch_path) + '\n')
        
        try:
            os.makedirs(os.path.dirname(sketch_path), exist_ok=True)
            with open(sketch_path, 'w') as f:
                for sketch in arduino_sketch:
                    f.write(sketch)
                    f.write('\n')  # Add a separating newline after each sketch fragment
                f.flush()

            return True
                
        except (IOError, OSError) as e:
            append_compiler_log(send_text, _("Error writing arduino_sketch.h: {err_msg}\n").format(err_msg=str(e)))
            return False
    
    def generate_glue_code() -> bool:
        if not os.path.exists(f'{_arduino_src_path}/LOCATED_VARIABLES.h'):
            append_compiler_log(send_text, _("Error: Couldn't find LOCATED_VARIABLES.h") + '\n')
            return False
            
        located_vars_file = open(f'{_arduino_src_path}/LOCATED_VARIABLES.h', 'r')
        located_vars = located_vars_file.readlines()
        glueVars = """
#include "iec_std_lib.h"

#define __LOCATED_VAR(type, name, ...) type __##name;
#include "LOCATED_VARIABLES.h"
#undef __LOCATED_VAR
#define __LOCATED_VAR(type, name, ...) type* name = &__##name;
#include "LOCATED_VARIABLES.h"
#undef __LOCATED_VAR

TIME __CURRENT_TIME;
BOOL __DEBUG;
extern unsigned long long common_ticktime__;

//OpenPLC Buffers
#if defined(__AVR_ATmega328P__) || defined(__AVR_ATmega168__) || defined(__AVR_ATmega32U4__) || defined(__AVR_ATmega16U4__)

#define MAX_DIGITAL_INPUT          8
#define MAX_DIGITAL_OUTPUT         32
#define MAX_ANALOG_INPUT           6
#define MAX_ANALOG_OUTPUT          32
#define MAX_MEMORY_WORD            0
#define MAX_MEMORY_DWORD           0
#define MAX_MEMORY_LWORD           0

IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8];
IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8];
IEC_UINT *int_input[MAX_ANALOG_INPUT];
IEC_UINT *int_output[MAX_ANALOG_OUTPUT];

#else

#define MAX_DIGITAL_INPUT          56
#define MAX_DIGITAL_OUTPUT         56
#define MAX_ANALOG_INPUT           32
#define MAX_ANALOG_OUTPUT          32
#define MAX_MEMORY_WORD            20
#define MAX_MEMORY_DWORD           20
#define MAX_MEMORY_LWORD           20

IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8];
IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8];
IEC_UINT *int_input[MAX_ANALOG_INPUT];
IEC_UINT *int_output[MAX_ANALOG_OUTPUT];
IEC_UINT *int_memory[MAX_MEMORY_WORD];
IEC_UDINT *dint_memory[MAX_MEMORY_DWORD];
IEC_ULINT *lint_memory[MAX_MEMORY_LWORD];

#endif


void glueVars()
{
"""
        for located_var in located_vars:
            # cleanup located var line
            if ('__LOCATED_VAR(' in located_var):
                located_var = located_var.split('(')[1].split(')')[0]
                var_data = located_var.split(',')
                if (len(var_data) < 5):
                    append_compiler_log(send_text, _('Error processing located var line: {var_line_text}').format(var_line_text=located_var) + '\n')
                else:
                    var_type = var_data[0]
                    var_name = var_data[1]
                    var_address = var_data[4]
                    var_subaddress = '0'
                    if (len(var_data) > 5):
                        var_subaddress = var_data[5]
    
                    # check variable type and assign to correct buffer pointer
                    if ('QX' in var_name):
                        if (int(var_address) > 6 or int(var_subaddress) > 7):
                            append_compiler_log(send_text, _('Error: wrong location for var {var_name}').format(var_name=var_name) + '\n')
                            return
                        glueVars += '    bool_output[' + var_address + \
                            '][' + var_subaddress + '] = ' + var_name + ';\n'
                    elif ('IX' in var_name):
                        if (int(var_address) > 6 or int(var_subaddress) > 7):
                            append_compiler_log(send_text, _('Error: wrong location for var {var_name}').format(var_name=var_name) + '\n')
                            return
                        glueVars += '    bool_input[' + var_address + \
                            '][' + var_subaddress + '] = ' + var_name + ';\n'
                    elif ('QW' in var_name):
                        if (int(var_address) > 32):
                            append_compiler_log(send_text, _('Error: wrong location for var {var_name}').format(var_name=var_name) + '\n')
                            return
                        glueVars += '    int_output[' + \
                            var_address + '] = ' + var_name + ';\n'
                    elif ('IW' in var_name):
                        if (int(var_address) > 32):
                            append_compiler_log(send_text, _('Error: wrong location for var {var_name}').format(var_name=var_name) + '\n')
                            return
                        glueVars += '    int_input[' + \
                            var_address + '] = ' + var_name + ';\n'
                    elif ('MW' in var_name):
                        if (int(var_address) > 20):
                            append_compiler_log(send_text, _('Error: wrong location for var {var_name}').format(var_name=var_name) + '\n')
                            return
                        glueVars += '    int_memory[' + \
                            var_address + '] = ' + var_name + ';\n'
                    elif ('MD' in var_name):
                        if (int(var_address) > 20):
                            append_compiler_log(send_text, _('Error: wrong location for var {var_name}').format(var_name=var_name) + '\n')
                            return
                        glueVars += '    dint_memory[' + \
                            var_address + '] = ' + var_name + ';\n'
                    elif ('ML' in var_name):
                        if (int(var_address) > 20):
                            append_compiler_log(send_text, _('Error: wrong location for var {var_name}').format(var_name=var_name) + '\n')
                            return
                        glueVars += '    lint_memory[' + \
                            var_address + '] = ' + var_name + ';\n'
                    else:
                        append_compiler_log(send_text, _('Could not process location "{var_name}" from line: {var_line_text}').format(var_name=var_name, var_line_text=located_var) + '\n')
                        return
    
        glueVars += """
}

void updateTime()
{
    __CURRENT_TIME.tv_nsec += common_ticktime__;

    if (__CURRENT_TIME.tv_nsec >= 1000000000)
    {
        __CURRENT_TIME.tv_nsec -= 1000000000;
        __CURRENT_TIME.tv_sec += 1;
    }
}
"""
        f = open(f'{_arduino_src_path}/glueVars.c', 'w')
        f.write(glueVars)
        f.flush()
        f.close()
    
        time.sleep(2)  # make sure glueVars.c was written to disk
        
        return True

    def patch_generated_files() -> bool:
        # Patch POUS.c
        with open(f'{_arduino_src_path}/POUS.c', 'r') as f:
            pous_content = f.read()
        with open(f'{_arduino_src_path}/POUS.c', 'w') as f:
            f.write('#include "POUS.h"\n#include "Config0.h"\n\n' + pous_content)
            
        # Patch Res0.c
        with open(f'{_arduino_src_path}/Res0.c', 'r') as f:
            res0_lines = f.readlines()
        with open(f'{_arduino_src_path}/Res0.c', 'w') as f:
            for line in res0_lines:
                if '#include "POUS.c"' in line:
                    f.write('#include "POUS.h"\n')
                else:
                    f.write(line)
                    
        return True

    def build_project() -> bool:
        append_compiler_log(send_text, _('Generating binary file...') + '\n')
        
        build_cmd = _cli_command + ['compile', '-v']
        if build_option >= BuildCacheOption.CLEAN_BUILD:
            build_cmd.append('--clean')
            
        def join_flags(flags):
            if isinstance(flags, str):
                return flags
            if isinstance(flags, list):
                return ' '.join(flags)
            return ''

        # take extra build flags from board_hal
        if 'c_flags' in board_hal:
            build_cmd.extend([
                '--build-property', f'compiler.c.extra_flags={join_flags(board_hal["c_flags"])}'
            ])
        if 'cxx_flags' in board_hal:
            build_cmd.extend([
                '--build-property', f'compiler.cpp.extra_flags={join_flags(board_hal["cxx_flags"])}'
            ])
            
        build_cmd.extend([
            # '--libraries', os.path.dirname(_arduino_src_path),
            '--library', _arduino_src_path,
            '--library', os.path.join(_arduino_src_path, "lib"),
            '--export-binaries',
            '-b', arduino_platform,
            os.path.join(_arduino_ino_base_path, 'Baremetal.ino')
        ])
            
        
        return runCommandToWin(send_text, build_cmd) == 0

    def upload_if_needed() -> bool:
        if port is None:
            # Show output directory
            cwd = os.getcwd()
            build_dir = f"{os.path.join(_arduino_ino_base_path, 'build')}"
            append_compiler_log(send_text, f'\n{_("OUTPUT DIRECTORY:")}:\n{build_dir}\n')
            append_compiler_log(send_text, '\n' + _('COMPILATION DONE!'))
            return True
            
        # Upload to board
        append_compiler_log(send_text, f'\n{_("Uploading program to Arduino board at {port}...")}\n')
        cmd = _cli_command + ['upload', '--port', port, '--fqbn', arduino_platform, 
                            _arduino_ino_base_path]
        if runCommandToWin(send_text, cmd) != 0:
            return False
            
        append_compiler_log(send_text, '\n' + _('Done!') + '\n')
        return True
    
    def cleanup_build() -> bool:
        # cleanup build remains
        time.sleep(1)  # ensure files are not in use
        
        # return early, no clean up
        return True
    
        # Clean up and return
        if os.path.exists(_arduino_src_path+'POUS.c'):
            os.remove(_arduino_src_path+'POUS.c')
        if os.path.exists(_arduino_src_path+'POUS.h'):
            os.remove(_arduino_src_path+'POUS.h')
        if os.path.exists(_arduino_src_path+'LOCATED_VARIABLES.h'):
            os.remove(_arduino_src_path+'LOCATED_VARIABLES.h')
        if os.path.exists(_arduino_src_path+'VARIABLES.csv'):
            os.remove(_arduino_src_path+'VARIABLES.csv')
        if os.path.exists(_arduino_src_path+'Config0.c'):
            os.remove(_arduino_src_path+'Config0.c')
        if os.path.exists(_arduino_src_path+'Config0.h'):
            os.remove(_arduino_src_path+'Config0.h')
        if os.path.exists(_arduino_src_path+'Config0.o'):
            os.remove(_arduino_src_path+'Config0.o')
        if os.path.exists(_arduino_src_path+'Res0.c'):
            os.remove(_arduino_src_path+'Res0.c')
        if os.path.exists(_arduino_src_path+'Res0.o'):
            os.remove(_arduino_src_path+'Res0.o')
        if os.path.exists(_arduino_src_path+'glueVars.c'):
            os.remove(_arduino_src_path+'glueVars.c')


    # Main build sequence
    build_phases = [
        setup_environment,
        verify_prerequisites,
        handle_board_installation,
        check_required_libraries,
        update_libraries,
        compile_st_file,
        provide_hal_data,
        write_arduino_sketch,
        write_definitions_file,
        generate_glue_code,
        patch_generated_files,
        build_project,
        upload_if_needed,
        cleanup_build
    ]
    
    for phase in build_phases:
        if not phase():
            return
            
def setup_module():
    # import global variables writable, we want set them up
    global _arduino_src_path, _arduino_ino_base_path, _cli_command, _iec_transpiler
    _arduino_src_path = 'editor/arduino/src'
    _arduino_ino_base_path = 'editor/arduino/examples/Baremetal'
    
    # Convert _arduino_src_path to absolute path
    _arduino_src_path = os.path.abspath(_arduino_src_path)
    _arduino_ino_base_path = os.path.abspath(_arduino_ino_base_path)
    
    # Setup CLI command based on platform
    if os_platform.system() == 'Windows':
        _cli_command = [os.path.abspath('editor\\arduino\\bin\\arduino-cli-w64.exe'), '--no-color']
        _iec_transpiler = os.path.abspath('editor/arduino/bin/iec2c.exe')
    elif os_platform.system() == 'Darwin':
        _cli_command = [os.path.abspath('editor/arduino/bin/arduino-cli-mac'), '--no-color']
        _iec_transpiler = os.path.abspath('editor/arduino/bin/iec2c_mac')
    else:
        _cli_command = [os.path.abspath('editor/arduino/bin/arduino-cli-l64'), '--no-color']
        _iec_transpiler = os.path.abspath('editor/arduino/bin/iec2c')
        
    return None

# run this on module load time
setup_module()
