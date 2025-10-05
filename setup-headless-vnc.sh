#!/bin/bash
set -e

SCRIPT_VERSION="1.0.0"
DISPLAY_NUM=99
VNC_PORT=5900
NOVNC_PORT=8080
SCREEN_RESOLUTION="1920x1080x24"

print_header() {
    echo "=================================================="
    echo "  OpenPLC Editor Headless VNC Setup Script"
    echo "  Version: ${SCRIPT_VERSION}"
    echo "=================================================="
    echo ""
}

print_success() {
    echo -e "\033[0;32m✓ $1\033[0m"
}

print_error() {
    echo -e "\033[0;31m✗ $1\033[0m"
}

print_warning() {
    echo -e "\033[0;33m⚠ $1\033[0m"
}

print_info() {
    echo -e "\033[0;34mℹ $1\033[0m"
}

usage() {
    cat << EOF
Usage: $0 <openplc-editor-repo-path> [options]

Arguments:
    openplc-editor-repo-path    Path to the openplc-editor repository

Options:
    -d, --display NUM           Display number (default: ${DISPLAY_NUM})
    -v, --vnc-port PORT         VNC port (default: ${VNC_PORT})
    -n, --novnc-port PORT       noVNC web port (default: ${NOVNC_PORT})
    -r, --resolution RES        Screen resolution (default: ${SCREEN_RESOLUTION})
    -h, --help                  Show this help message

Example:
    $0 ~/repos/openplc-editor
    $0 /path/to/openplc-editor --display 99 --vnc-port 5900

EOF
    exit 1
}

install_apt_package() {
    local package=$1
    local cmd=$2
    
    print_info "Installing $package..."
    if sudo apt-get update -qq && sudo apt-get install -y "$package" > /dev/null 2>&1; then
        print_success "$package installed successfully"
        return 0
    else
        print_error "Failed to install $package"
        return 1
    fi
}

check_and_install_dependency() {
    local cmd=$1
    local package=$2
    
    if command -v "$cmd" &> /dev/null; then
        print_success "$cmd is installed"
        return 0
    else
        print_warning "$cmd is not installed, attempting to install..."
        install_apt_package "$package" "$cmd"
        return $?
    fi
}

check_dependencies() {
    print_info "Checking and installing dependencies..."
    echo ""
    
    local all_deps_ok=true
    
    check_and_install_dependency "Xvfb" "xvfb" || all_deps_ok=false
    check_and_install_dependency "x11vnc" "x11vnc" || all_deps_ok=false
    check_and_install_dependency "fluxbox" "fluxbox" || all_deps_ok=false
    check_and_install_dependency "scrot" "scrot" || all_deps_ok=false
    check_and_install_dependency "python3" "python3" || all_deps_ok=false
    
    if dpkg -l | grep -q libfuse2; then
        print_success "libfuse2 is installed"
    else
        print_warning "libfuse2 is not installed, attempting to install..."
        install_apt_package "libfuse2" || all_deps_ok=false
    fi
    
    if command -v node &> /dev/null; then
        print_success "node is installed ($(node --version))"
    else
        print_error "node is not installed"
        print_info "Node.js must be installed via nvm or your system's package manager"
        print_info "This script cannot automatically install Node.js"
        all_deps_ok=false
    fi
    
    if command -v npm &> /dev/null; then
        print_success "npm is installed ($(npm --version))"
    else
        print_error "npm is not installed"
        print_info "npm must be installed via nvm or your system's package manager"
        print_info "This script cannot automatically install npm"
        all_deps_ok=false
    fi
    
    if [ -d "$HOME/noVNC" ]; then
        print_success "noVNC is installed at $HOME/noVNC"
    else
        print_warning "noVNC is not installed, attempting to clone..."
        if git clone https://github.com/novnc/noVNC.git "$HOME/noVNC" > /dev/null 2>&1; then
            print_success "noVNC cloned successfully"
        else
            print_error "Failed to clone noVNC"
            all_deps_ok=false
        fi
    fi
    
    if [ -d "$HOME/noVNC/utils/websockify" ]; then
        print_success "websockify is installed"
    else
        print_warning "websockify is not installed, attempting to clone..."
        if git clone https://github.com/novnc/websockify "$HOME/noVNC/utils/websockify" > /dev/null 2>&1; then
            print_success "websockify cloned successfully"
        else
            print_error "Failed to clone websockify"
            all_deps_ok=false
        fi
    fi
    
    echo ""
    if [ "$all_deps_ok" = false ]; then
        print_error "Some dependencies could not be installed. Please resolve the issues above."
        exit 1
    fi
    
    print_success "All dependencies are installed!"
    echo ""
}

check_repo_structure() {
    local repo_path=$1
    
    print_info "Checking repository structure..."
    echo ""
    
    if [ ! -f "$repo_path/package.json" ]; then
        print_error "package.json not found in $repo_path"
        print_error "This doesn't appear to be the openplc-editor repository"
        exit 1
    fi
    
    print_success "Repository structure looks good"
    echo ""
}

stop_existing_services() {
    print_info "Stopping any existing services..."
    echo ""
    
    pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null && print_success "Stopped existing Xvfb" || print_info "No existing Xvfb to stop"
    pkill -f "x11vnc.*-display :${DISPLAY_NUM}" 2>/dev/null && print_success "Stopped existing x11vnc" || print_info "No existing x11vnc to stop"
    pkill -f "websockify.*${NOVNC_PORT}" 2>/dev/null && print_success "Stopped existing noVNC" || print_info "No existing noVNC to stop"
    pkill -f "fluxbox.*-display :${DISPLAY_NUM}" 2>/dev/null && print_success "Stopped existing fluxbox" || print_info "No existing fluxbox to stop"
    pkill -f "open-plc-editor" 2>/dev/null && print_success "Stopped existing OpenPLC Editor" || print_info "No existing OpenPLC Editor to stop"
    
    sleep 2
    echo ""
}

start_xvfb() {
    print_info "Starting Xvfb on display :${DISPLAY_NUM}..."
    
    Xvfb ":${DISPLAY_NUM}" -screen 0 "${SCREEN_RESOLUTION}" > /dev/null 2>&1 &
    local xvfb_pid=$!
    
    sleep 2
    
    if ps -p $xvfb_pid > /dev/null; then
        print_success "Xvfb started (PID: $xvfb_pid)"
        echo "$xvfb_pid" > /tmp/openplc-xvfb.pid
    else
        print_error "Failed to start Xvfb"
        exit 1
    fi
    echo ""
}

start_fluxbox() {
    print_info "Starting fluxbox window manager..."
    
    DISPLAY=":${DISPLAY_NUM}" fluxbox > /dev/null 2>&1 &
    local fluxbox_pid=$!
    
    sleep 1
    
    if ps -p $fluxbox_pid > /dev/null; then
        print_success "fluxbox started (PID: $fluxbox_pid)"
        echo "$fluxbox_pid" > /tmp/openplc-fluxbox.pid
    else
        print_warning "fluxbox may not have started, but continuing..."
    fi
    echo ""
}

start_x11vnc() {
    print_info "Starting x11vnc on port ${VNC_PORT}..."
    
    x11vnc -display ":${DISPLAY_NUM}" -nopw -listen localhost -xkb -ncache 10 -ncache_cr -forever > /tmp/x11vnc.log 2>&1 &
    local vnc_pid=$!
    
    sleep 2
    
    if ps -p $vnc_pid > /dev/null; then
        print_success "x11vnc started (PID: $vnc_pid)"
        echo "$vnc_pid" > /tmp/openplc-x11vnc.pid
    else
        print_error "Failed to start x11vnc"
        cat /tmp/x11vnc.log
        exit 1
    fi
    echo ""
}

start_novnc() {
    print_info "Starting noVNC on port ${NOVNC_PORT}..."
    
    cd "$HOME/noVNC"
    ./utils/novnc_proxy --vnc localhost:${VNC_PORT} --listen ${NOVNC_PORT} > /tmp/novnc.log 2>&1 &
    local novnc_pid=$!
    
    sleep 2
    
    if ps -p $novnc_pid > /dev/null; then
        print_success "noVNC started (PID: $novnc_pid)"
        echo "$novnc_pid" > /tmp/openplc-novnc.pid
    else
        print_error "Failed to start noVNC"
        cat /tmp/novnc.log
        exit 1
    fi
    echo ""
}

build_application() {
    local repo_path=$1
    
    print_info "Checking if application needs to be built..."
    echo ""
    
    cd "$repo_path"
    
    if [ ! -d "node_modules" ]; then
        print_warning "node_modules not found. Installing dependencies..."
        npm install
        echo ""
    fi
    
    local appimage_path=$(find "$repo_path/release/build" -name "*.AppImage" 2>/dev/null | head -1)
    
    if [ -z "$appimage_path" ]; then
        print_warning "No AppImage found. Building application..."
        npm run package
        echo ""
        appimage_path=$(find "$repo_path/release/build" -name "*.AppImage" | head -1)
    fi
    
    if [ -z "$appimage_path" ]; then
        print_error "Failed to find or build AppImage"
        exit 1
    fi
    
    print_success "AppImage found: $appimage_path"
    echo "$appimage_path" > /tmp/openplc-appimage-path.txt
    echo ""
}

extract_appimage() {
    local repo_path=$1
    local appimage_path=$(cat /tmp/openplc-appimage-path.txt)
    
    print_info "Extracting AppImage..."
    
    cd "$repo_path"
    
    if [ -d "squashfs-root" ]; then
        print_info "Removing existing squashfs-root directory..."
        rm -rf squashfs-root
    fi
    
    "$appimage_path" --appimage-extract > /dev/null 2>&1
    
    if [ -d "squashfs-root" ] && [ -f "squashfs-root/open-plc-editor" ]; then
        print_success "AppImage extracted successfully"
    else
        print_error "Failed to extract AppImage"
        exit 1
    fi
    echo ""
}

start_application() {
    local repo_path=$1
    
    print_info "Starting OpenPLC Editor..."
    
    cd "$repo_path/squashfs-root"
    
    DISPLAY=":${DISPLAY_NUM}" ./open-plc-editor > /tmp/openplc-editor.log 2>&1 &
    local app_pid=$!
    
    sleep 3
    
    if ps -p $app_pid > /dev/null; then
        print_success "OpenPLC Editor started (PID: $app_pid)"
        echo "$app_pid" > /tmp/openplc-editor.pid
    else
        print_error "Failed to start OpenPLC Editor"
        print_info "Check logs at /tmp/openplc-editor.log"
        tail -20 /tmp/openplc-editor.log
        exit 1
    fi
    echo ""
}

print_summary() {
    echo ""
    echo "=================================================="
    echo "  Setup Complete!"
    echo "=================================================="
    echo ""
    print_success "All services are running!"
    echo ""
    echo "Service Status:"
    echo "  • Xvfb:           Display :${DISPLAY_NUM} (PID: $(cat /tmp/openplc-xvfb.pid 2>/dev/null || echo 'N/A'))"
    echo "  • fluxbox:        Window manager (PID: $(cat /tmp/openplc-fluxbox.pid 2>/dev/null || echo 'N/A'))"
    echo "  • x11vnc:         Port ${VNC_PORT} (PID: $(cat /tmp/openplc-x11vnc.pid 2>/dev/null || echo 'N/A'))"
    echo "  • noVNC:          Port ${NOVNC_PORT} (PID: $(cat /tmp/openplc-novnc.pid 2>/dev/null || echo 'N/A'))"
    echo "  • OpenPLC Editor: Running (PID: $(cat /tmp/openplc-editor.pid 2>/dev/null || echo 'N/A'))"
    echo ""
    echo "Access the GUI:"
    echo "  • Web Browser:    http://localhost:${NOVNC_PORT}/vnc.html"
    echo "  • VNC Client:     localhost:${VNC_PORT}"
    echo ""
    echo "Logs:"
    echo "  • x11vnc:         /tmp/x11vnc.log"
    echo "  • noVNC:          /tmp/novnc.log"
    echo "  • OpenPLC Editor: /tmp/openplc-editor.log"
    echo ""
    echo "To stop all services, run:"
    echo "  pkill -f 'Xvfb :${DISPLAY_NUM}'"
    echo "  pkill -f 'x11vnc.*-display :${DISPLAY_NUM}'"
    echo "  pkill -f 'websockify.*${NOVNC_PORT}'"
    echo "  pkill -f 'fluxbox.*-display :${DISPLAY_NUM}'"
    echo "  pkill -f 'open-plc-editor'"
    echo ""
    echo "=================================================="
}

main() {
    print_header
    
    if [ $# -eq 0 ]; then
        print_error "No repository path provided"
        echo ""
        usage
    fi
    
    local repo_path=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -d|--display)
                DISPLAY_NUM="$2"
                shift 2
                ;;
            -v|--vnc-port)
                VNC_PORT="$2"
                shift 2
                ;;
            -n|--novnc-port)
                NOVNC_PORT="$2"
                shift 2
                ;;
            -r|--resolution)
                SCREEN_RESOLUTION="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                if [ -z "$repo_path" ]; then
                    repo_path="$1"
                    shift
                else
                    print_error "Unknown option: $1"
                    echo ""
                    usage
                fi
                ;;
        esac
    done
    
    if [ -z "$repo_path" ]; then
        print_error "Repository path is required"
        echo ""
        usage
    fi
    
    repo_path=$(realpath "$repo_path")
    
    if [ ! -d "$repo_path" ]; then
        print_error "Repository path does not exist: $repo_path"
        exit 1
    fi
    
    print_info "Repository path: $repo_path"
    print_info "Display: :${DISPLAY_NUM}"
    print_info "VNC Port: ${VNC_PORT}"
    print_info "noVNC Port: ${NOVNC_PORT}"
    print_info "Resolution: ${SCREEN_RESOLUTION}"
    echo ""
    
    check_dependencies
    check_repo_structure "$repo_path"
    stop_existing_services
    start_xvfb
    start_fluxbox
    start_x11vnc
    start_novnc
    build_application "$repo_path"
    extract_appimage "$repo_path"
    start_application "$repo_path"
    print_summary
}

main "$@"
