FROM ubuntu:24.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------
# Node.js 20 via NodeSource
# ---------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------
# System dependencies for Electron, native modules, and X11
# ---------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build tools for native Node modules (serialport, etc.)
    build-essential \
    python3 \
    # Electron runtime dependencies (Chromium/GTK)
    libgtk-3-0t64 \
    libgbm1 \
    libnss3 \
    libxss1 \
    libasound2t64 \
    libdrm2 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc-s1 \
    libglib2.0-0t64 \
    libnspr4 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    libxshmfence1 \
    # Virtual framebuffer for headless Electron
    xvfb \
    # Useful dev tools
    git \
    curl \
    procps \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------
# Xvfb startup script (virtual display for Electron)
# ---------------------------------------------------------
COPY .devcontainer/start-xvfb.sh /usr/local/bin/start-xvfb.sh
RUN chmod +x /usr/local/bin/start-xvfb.sh

# ---------------------------------------------------------
# Non-root user (rename default ubuntu user to dev)
# ---------------------------------------------------------
RUN usermod -l dev -d /home/dev -m ubuntu \
    && groupmod -n dev ubuntu \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev \
    && chmod 0440 /etc/sudoers.d/dev

USER dev

WORKDIR /workspaces/openplc-editor
