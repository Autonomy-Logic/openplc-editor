# OpenPLC Editor Headless Setup Guide

This guide explains how to run the OpenPLC Editor GUI application in a headless Linux environment using the automated setup script.

## Overview

The `setup-headless-vnc.sh` script automates the complete setup of a headless environment for running the OpenPLC Editor with browser-based GUI access through noVNC. This is particularly useful for:

- Running the OpenPLC Editor on headless servers
- Automating GUI testing in CI/CD pipelines
- Remote access to the editor through a web browser
- Development and testing in containerized environments

## Architecture

The setup creates the following service stack:

```
┌─────────────────────────────────────────────┐
│  Web Browser (http://localhost:8080)       │
│  User interacts with GUI via noVNC         │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  noVNC (WebSocket to VNC proxy)            │
│  Port 8080                                  │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  x11vnc (VNC Server)                        │
│  Port 5900                                  │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  Xvfb (Virtual X11 Display)                │
│  Display :99                                │
│  ┌──────────────────────────────────────┐  │
│  │  fluxbox (Window Manager)            │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │  OpenPLC Editor (Electron App) │  │  │
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Prerequisites

The script will verify that the following dependencies are installed:

### System Packages
- `xvfb` - Virtual X11 display server
- `x11vnc` - VNC server for X11
- `fluxbox` - Lightweight window manager
- `scrot` - Screenshot utility
- `libfuse2` - Required for running AppImage files
- `python3` - Python runtime

### Node.js Dependencies
- `node` - Node.js runtime
- `npm` - Node package manager

### Additional Tools
- `noVNC` - Web-based VNC client (cloned to `~/noVNC`)
- `websockify` - WebSocket to TCP proxy (in `~/noVNC/utils/websockify`)

### Installing Dependencies

On Ubuntu/Debian systems:

```bash
# Install system packages
sudo apt-get update
sudo apt-get install -y xvfb x11vnc fluxbox scrot libfuse2 python3

# Install Node.js (if not already installed)
# Option 1: Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install --lts

# Option 2: Using package manager
sudo apt-get install -y nodejs npm

# Clone noVNC and websockify
git clone https://github.com/novnc/noVNC.git ~/noVNC
git clone https://github.com/novnc/websockify ~/noVNC/utils/websockify
```

## Usage

### Basic Usage

Run the script with the path to your openplc-editor repository:

```bash
./setup-headless-vnc.sh /path/to/openplc-editor
```

### Advanced Options

The script supports several command-line options to customize the setup:

```bash
./setup-headless-vnc.sh <repo-path> [options]

Options:
  -d, --display NUM       Display number (default: 99)
  -v, --vnc-port PORT     VNC port (default: 5900)
  -n, --novnc-port PORT   noVNC web port (default: 8080)
  -r, --resolution RES    Screen resolution (default: 1920x1080x24)
  -h, --help              Show help message

Examples:
  # Use custom display and ports
  ./setup-headless-vnc.sh ~/repos/openplc-editor --display 98 --vnc-port 5901

  # Use custom resolution
  ./setup-headless-vnc.sh ~/repos/openplc-editor --resolution 1280x720x24

  # Combine multiple options
  ./setup-headless-vnc.sh ~/repos/openplc-editor \
    --display 100 \
    --vnc-port 5902 \
    --novnc-port 8081
```

## Accessing the GUI

After running the script, you can access the OpenPLC Editor GUI in two ways:

### 1. Web Browser (Recommended)

Open your web browser and navigate to:
```
http://localhost:8080/vnc.html
```

Click the "Connect" button to start interacting with the GUI. This method works from any device that can access your server, including mobile devices (when properly exposed).

### 2. VNC Client

Use any VNC client to connect to:
```
localhost:5900
```

No password is required for the connection.

## What the Script Does

1. **Dependency Check**: Verifies all required dependencies are installed
2. **Repository Validation**: Confirms the provided path contains a valid openplc-editor repository
3. **Service Cleanup**: Stops any existing instances of the services
4. **Xvfb Startup**: Launches the virtual X11 display server
5. **Window Manager**: Starts fluxbox for window management
6. **VNC Server**: Starts x11vnc to expose the display via VNC protocol
7. **noVNC Proxy**: Launches the WebSocket-to-VNC proxy for browser access
8. **Build Check**: Verifies the application is built or builds it if needed
9. **AppImage Extraction**: Extracts the AppImage for direct execution
10. **Application Launch**: Starts the OpenPLC Editor in the virtual display
11. **Status Report**: Provides a summary of all running services and access methods

## Service Management

### Viewing Service Status

After running the script, it will display PIDs for all services:

```
Service Status:
  • Xvfb:           Display :99 (PID: 1234)
  • fluxbox:        Window manager (PID: 1235)
  • x11vnc:         Port 5900 (PID: 1236)
  • noVNC:          Port 8080 (PID: 1237)
  • OpenPLC Editor: Running (PID: 1238)
```

### Viewing Logs

Logs are written to `/tmp/` for easy debugging:

```bash
# View x11vnc logs
tail -f /tmp/x11vnc.log

# View noVNC logs
tail -f /tmp/novnc.log

# View OpenPLC Editor logs
tail -f /tmp/openplc-editor.log
```

### Stopping Services

To stop all services, run the commands provided in the script output:

```bash
pkill -f 'Xvfb :99'
pkill -f 'x11vnc.*-display :99'
pkill -f 'websockify.*8080'
pkill -f 'fluxbox.*-display :99'
pkill -f 'open-plc-editor'
```

Or stop individual services by their PIDs:

```bash
kill <PID>
```

## Troubleshooting

### Script Reports Missing Dependencies

If the script reports missing dependencies, install them using the commands provided in the error messages.

### Port Already in Use

If you get errors about ports already being in use, either:
1. Stop the existing services using the commands above
2. Use different ports with the `--vnc-port` and `--novnc-port` options

### Display Already in Use

If display :99 is already in use, specify a different display number:
```bash
./setup-headless-vnc.sh /path/to/repo --display 100
```

### Application Fails to Start

Check the application logs:
```bash
tail -50 /tmp/openplc-editor.log
```

Common issues:
- **Missing node_modules**: The script will automatically run `npm install` if needed
- **Build artifacts missing**: The script will run `npm run package` to build the AppImage
- **Permission errors**: Ensure you have read/write access to the repository directory

### noVNC Connection Issues

1. Verify x11vnc is running:
```bash
ps aux | grep x11vnc
```

2. Check x11vnc logs:
```bash
cat /tmp/x11vnc.log
```

3. Verify noVNC is running:
```bash
ps aux | grep websockify
```

### Browser Shows Black Screen

This usually means the OpenPLC Editor hasn't started yet. Wait a few seconds and refresh the browser. Check the application logs if the issue persists.

## Remote Access

### From Another Machine on the Same Network

If you want to access the GUI from another machine on your local network:

```bash
# On the server, expose the noVNC port
# Replace <server-ip> with your server's IP address
# Users can then access http://<server-ip>:8080/vnc.html
```

Note: This is insecure as noVNC runs without authentication. Only use on trusted networks.

### Via SSH Tunnel (Secure)

For secure remote access over the internet:

```bash
# On your local machine
ssh -L 8080:localhost:8080 user@server-address

# Then access http://localhost:8080/vnc.html in your local browser
```

## CI/CD Integration

This setup is ideal for automated testing in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Setup Headless Environment
  run: |
    sudo apt-get install -y xvfb x11vnc fluxbox scrot libfuse2
    git clone https://github.com/novnc/noVNC.git ~/noVNC
    git clone https://github.com/novnc/websockify ~/noVNC/utils/websockify
    
- name: Start OpenPLC Editor
  run: |
    chmod +x setup-headless-vnc.sh
    ./setup-headless-vnc.sh $(pwd)
    
- name: Run GUI Tests
  run: |
    # Your test commands here
    python test_gui.py
```

## Performance Considerations

- **Display Resolution**: Lower resolutions use less CPU and bandwidth. Use `--resolution 1280x720x24` for better performance if high resolution isn't needed.
- **Color Depth**: The 24 in `1920x1080x24` represents color depth. Reducing this can improve performance on slower connections.
- **Network Bandwidth**: noVNC streams the display over WebSockets. On slow connections, you may experience lag.

## Security Considerations

⚠️ **Important Security Notes**:

1. **No Authentication**: The default setup has no authentication on the VNC server. Do not expose these ports to untrusted networks.
2. **Unencrypted Connection**: The VNC connection is not encrypted by default. Use SSH tunnels for remote access.
3. **Localhost Only**: x11vnc is configured to listen on localhost only (`-listen localhost`), which is secure by default.
4. **Production Use**: For production environments, consider adding authentication and SSL/TLS encryption.

## Known Limitations

### Mouse Click Automation

Electron applications (including OpenPLC Editor) implement security features that block synthetic mouse input from tools like `xdotool` and `PyAutoGUI`. This is intentional security to prevent UI automation attacks.

**Workaround**: Use the browser-based noVNC interface where genuine user input events are respected. For automated testing, consider:
- Keyboard navigation (`Tab`, `Enter`, arrow keys work reliably)
- Browser automation tools that can interact with the noVNC canvas
- Chrome DevTools Protocol (if the app is launched with `--remote-debugging-port`)

### Mobile Device Limitations

While noVNC works on mobile browsers, the touch interface may not be as responsive as on desktop browsers. For best experience, use a desktop or laptop computer.

## Additional Resources

- [noVNC Project](https://github.com/novnc/noVNC)
- [x11vnc Documentation](https://github.com/LibVNC/x11vnc)
- [Xvfb Manual](https://www.x.org/releases/X11R7.6/doc/man/man1/Xvfb.1.xhtml)
- [OpenPLC Editor Repository](https://github.com/Autonomy-Logic/openplc-editor)

## Support

For issues with:
- **This script**: Open an issue in the openplc-editor repository
- **OpenPLC Editor**: Check the main repository documentation
- **noVNC/VNC**: Refer to the respective project documentation

## License

This script is part of the OpenPLC Editor project and follows the same license.
