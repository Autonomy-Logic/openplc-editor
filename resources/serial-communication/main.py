import sys
import serial
import serial.tools.list_ports
import json


def list_available_ports():
    """List all available serial ports."""
    ports = serial.tools.list_ports.comports()
    return [{"port": port.device} for port in ports]


def main():
    # Read configuration from stdin
    config = json.loads(sys.stdin.readline())

    # Check if the action is to list ports
    if config.get("action") == "list_ports":
        ports = list_available_ports()
        print(json.dumps({"status": "success", "ports": ports}))
        sys.exit(0)

    # Extract serial port configuration
    port = config.get("port")
    baudrate = config.get("baudrate", 9600)
    timeout = config.get("timeout", 1)

    # Open the serial port
    try:
        ser = serial.Serial(port, baudrate, timeout=timeout)
        print(json.dumps({"status": "connected", "port": port}))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)

    # Main loop to read from and write to the serial port
    while True:
        # Read from stdin (from Electron)
        line = sys.stdin.readline()
        if not line:
            break

        # Parse the command from Electron
        try:
            command = json.loads(line)
            action = command.get("action")

            if action == "write":
                data = command.get("data")
                ser.write(data.encode())
                print(json.dumps({"status": "write_success", "data": data}))

            elif action == "read":
                response = ser.readline().decode().strip()
                print(json.dumps({"status": "read_success", "data": response}))

            elif action == "close":
                ser.close()
                print(json.dumps({"status": "closed"}))
                break

            else:
                print(json.dumps({"status": "error", "message": "unknown action"}))

        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))


if __name__ == "__main__":
    main()
