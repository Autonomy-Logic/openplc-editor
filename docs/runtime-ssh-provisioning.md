# Installing or starting the OpenPLC Runtime over SSH

When Connect cannot reach an OpenPLC Runtime but the device answers on SSH, the desktop editor offers
to log in to the device over SSH and install or start the runtime there.

- Main process: `src/main/modules/runtime-provisioning/` (IPC channels `runtime-provisioning:*`),
  `src/backend/shared/runtime-provisioning/` (the operation) and `src/backend/editor/runtime-provisioning/`
  (SSH session, SSH greeting check, host-key file).
- Port: `RuntimeProvisioningPort` in `src/middleware/shared/ports/runtime-provisioning-port.ts`.
- Renderer: `src/frontend/services/runtime-connect.ts` (when the offer is made),
  `src/frontend/services/runtime-provisioning/` (the run), the `runtimeProvisioning` store slice and the
  dialogs `runtime-provisioning-dialog.tsx` and `runtime-no-device-modal.tsx`.

IPC: four channels, `runtime-provisioning:probe-ssh`, `runtime-provisioning:run` and
`runtime-provisioning:cancel` (invoke) and `runtime-provisioning:event` (main to renderer). The
`runtime-provisioning:run` reply is `{ outcome, endToken }`, and main sends `{ type: 'run-end', token }` on
`runtime-provisioning:event` to the calling renderer after the run's last event. Electron does not keep an
invoke reply in order with the event messages, so the editor adapter
(`src/middleware/adapters/editor/runtime-provisioning-adapter.ts`, format in
`runtime-provisioning-run-reply.ts`) resolves the run only once both have arrived: every installer line,
console line and the audit entry are in the editor console before the dialog shows the ending.

## What it does

1. The user presses Connect on the device Configuration screen, or answers "Yes" to the debugger's
   "Not Connected" offer, for an OpenPLC Runtime v4 target or a target derived from it (a board whose
   debugger transport is `websocket`), addressed by IP address or host name. Ethernet-upload boards and
   orchestrator devices are not concerned.
2. The connect to the runtime on TCP 8443 fails with the connection refused, a timeout, or the host or
   network unreachable. Any other error keeps the usual "No Response" dialog.
3. The editor asks the bootloader on TCP 8445 for its state (timeout 2.5 s):
   - recovery: the "Runtime failed to start" message, and nothing else is done;
   - a state other than `healthy`: the "Bootloader busy" message, and nothing else is done;
   - `healthy`, or no answer: the editor goes on to SSH.
4. The editor reads the SSH greeting on port 22, or on the port the user gave in this session with
   "Try another SSH port" (timeout 2 s). No SSH server answering opens "No recognized device".
5. The offer dialog explains what will be done (see "The consent list"). The user consents once and
   gives an operating-system account of the device: username, password and SSH port.
6. The editor logs in over SSH with that password and checks the host key (see "Host keys").
7. A read-only inspection: operating system, systemd, architecture, the account's rights, then the
   state of Docker, of the `openplc-bootloader` and `openplc-runtime` containers, of the
   `openplc-runtime.service` unit and of the v3 units `openplc.service`, `openplc_v3.service` and
   `openplc-v3.service`. A v3 unit present stops the operation with nothing changed.
8. Depending on what was found:
   - start: `systemctl start docker` then `docker start openplc-bootloader`, or
     `docker start openplc-bootloader`, or `docker start openplc-runtime`, or
     `systemctl start openplc-runtime.service`. A start command that fails ends the operation at once
     with "Runtime start failed" and its last lines, which also go to the editor console. The editor does
     not wait for 8443;
   - install: the official installer is downloaded from `https://runtime.getedge.me` over HTTPS only,
     with `--connect-timeout 20 --max-time 120`, into a fresh `mktemp -d` folder. A download that fails or
     passes either limit gives "No internet access". The installer is then run detached with `setsid`, so
     it keeps running when the SSH session ends. The editor reads its log once a second and shows the
     lines. It stops following and reports the result as unknown when the installer log stays empty for 60
     reads in a row, or when the installer is still running 60 minutes after it started;
   - a runtime already running: nothing is changed.
9. The editor then waits for the runtime to answer on TCP 8443, checking every 2 s for at most 120 s. When
   it answers, the dialog closes and the usual connect continues: the login dialog, or "Create First
   User" on a new install.

Lost connection and time limits:

- The editor sends an SSH keepalive every 5 s, and closes a session whose device has not answered for
  about 20 s.
- Each device command has a time limit: 150 s for the installer download step and for the start command,
  30 s for every other command.
- A lost session or a passed limit ends the operation with the result unknown, and the user is told to
  Connect again.

While Cancel is offered, it ends the operation at once ("Operation cancelled"). The SSH session is closed,
a command still running for the inspection or the download is abandoned, and nothing was installed or
started.

While an operation runs, its dialog can be hidden. The Connect button then shows the operation in
progress ("Installing runtime...", "Starting runtime..." or "Preparing runtime...") and a click reopens
the dialog; a second operation cannot start. When the dialog was hidden at the end of an operation that
did not succeed, the Connect button reads "Show result" until the dialog is opened and closed, unless the
editor is connected. A successful ending never shows "Show result": the button follows the connection
status.

Answering "Yes" to the debugger's "Not Connected" offer runs the same flow. When the connect turns to this
flow (steps 3 to 5) or reopens a running operation, the debugger request ends with one console line ("The
debugger was not started because the editor is not connected to the OpenPLC Runtime on ... The dialog shown
explains what to do. Start the debugger again once the editor is connected.") and no debugger dialog.

Closing the project or quitting the editor during an operation:

- Closing the project declines an open offer.
- Closing the project before the installer starts or the start command is sent ends the operation
  "cancelled"; after that, the operation keeps running on the device and the editor reports its result as
  unknown. The editor does not reconnect, and no event of the operation reaches the editor after the close.
- Quitting stops following the operation only once the quit is committed (a quit cancelled at the save
  prompt leaves it running), and nothing about it is shown after a restart.

The feature exists only in the desktop editor. It is inactive in openplc-web because the web platform
has no provisioning port (`runtimeProvisioning` is absent from its platform ports), so a failed connect
there keeps the "No Response" dialog. There is no on/off setting.

## What is contacted before consent

Before the user consents, the editor sends to the device only:

- the TCP connect to the runtime on 8443 (`GET /api/get-users-info`, the usual connect);
- the bootloader state request on 8445;
- a TCP connect to the SSH port that reads the SSH greeting (at most 1024 bytes) and sends nothing. The
  connection is then closed.

No SSH login, command or download happens before consent.

## The consent list

The offer dialog lists what will be done on the device:

- If an OpenPLC Runtime is already installed but stopped, what is stopped is started.
- Otherwise:
  - A script is downloaded from runtime.getedge.me and run as administrator.
  - Docker is installed when missing and enabled at boot.
  - The OpenPLC Runtime images are downloaded.
  - Any older OpenPLC service is stopped and disabled.
  - The device then listens on TCP 8443, TCP 8445 and UDP 33333.

## Credentials

- The username and password are used for one operation only. They are never stored and never written to
  the console or to a log file. The editor drops them when the operation ends: they are not kept for a
  later operation and are never reused to reconnect.
- The password is scrubbed from every line of device output before it is shown, sent to the renderer or
  logged.
- A non-root account runs each administrative command as
  `/usr/bin/sudo -S -k -p '' sh -c 'exec </dev/null; <command>'`, with the password written to sudo's
  standard input. `-k` ignores any cached sudo credentials and `-p ''` prints no prompt. The whole command
  then reads its standard input from `/dev/null`, so no part of it can read the password. The password
  never appears on a command line.
- The root account (uid 0) runs the commands directly, without sudo. Root commands, and the commands
  that need no administrator rights, also run with standard input from `/dev/null`
  (`exec </dev/null; <command>`).
- Only password login is used. A device that does not offer password authentication over SSH stops the
  operation with "Password login not accepted".

## Host keys

The editor trusts an SSH host key on first use, per `host:port`: the first key seen for a host and port
is saved, and every later login to that host and port must present the same key.

- A different key stops the operation before the password is sent, with the "Host key changed"
  message. Nothing is sent to the device.
- The host is matched exactly as it was typed in the editor, so `192.168.1.50` and a host name for the
  same device are two entries.

### The file

The keys are saved in `ssh-known-hosts.json`, in the editor's user data folder. It is the folder that
also holds `logs/combined.log`:

| OS      | File                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| Linux   | `~/.config/open-plc-editor/ssh-known-hosts.json` (`$XDG_CONFIG_HOME/open-plc-editor/` when `XDG_CONFIG_HOME` is set) |
| macOS   | `~/Library/Application Support/open-plc-editor/ssh-known-hosts.json`                                                 |
| Windows | `%APPDATA%\open-plc-editor\ssh-known-hosts.json` (`C:\Users\<user>\AppData\Roaming\open-plc-editor\`)                |

The folder is Electron's `app.getPath('userData')`, named after the `name` of `release/app/package.json`
(`open-plc-editor`), not after the product name.

The file is written with owner-only permissions (`0600`), through a temporary file renamed over it. Its
format:

```json
{
  "version": 1,
  "hosts": [
    {
      "host": "192.168.1.50",
      "port": 22,
      "keyType": "ssh-ed25519",
      "key": "AAAAC3NzaC1lZDI1NTE5AAAA...",
      "firstSeen": "2026-11-06T14:00:00.000Z"
    }
  ]
}
```

- `key` is the host key blob in base64, `keyType` the key type read from it, and `firstSeen` the time it
  was saved (ISO 8601, UTC).
- No other field is accepted, and a host and port appear at most once.

### Removing one entry by hand

Clearing a saved key is manual only; the editor has no command for it. To trust a device again after
its key changed (the device was reinstalled, for example), once you have checked that the change is
expected:

1. Close the editor.
2. Open `ssh-known-hosts.json` in a text editor.
3. Delete the whole object whose `host` and `port` match the device, for example
   `{ "host": "192.168.1.50", "port": 22, ... }`, and the comma that separated it from its neighbour.
4. Keep the JSON valid: `version` stays `1`, `hosts` stays an array (it may be empty: `"hosts": []`).
5. Save the file and start the editor. The next login to that host and port trusts its key on first use
   again.

Deleting the whole file resets trust for every device: each one is trusted again on first use. An
invalid file (not JSON, empty, an unknown field, a duplicated host and port, a `version` other than `1`)
or an unreadable one stops every operation with "Host key file unusable" until it is fixed or deleted.

## Device requirements

- Linux with systemd running.
- An architecture the runtime supports: amd64, arm64, or armhf on ARMv7 or newer (a 32-bit user space on
  an ARMv7 or ARMv8 CPU). ARMv6 boards are refused.
- Internet access to `runtime.getedge.me` (the installer), `get.docker.com` (Docker, when missing) and
  `ghcr.io` (the runtime and bootloader images).
- An account that is root, or that can run commands with `sudo` using its own password.
- SSH password login enabled on the device.

## Audit entry

Every operation started after consent writes one audit line when it ends, whatever its result:

```
[runtime-provisioning-audit] target=192.168.1.50:22 operation=install start=2026-11-06T14:00:00.000Z end=2026-11-06T14:04:12.000Z outcome=success
```

- `target`: `host:port` of the SSH server (`[address]:port` for an IPv6 address).
- `operation`: `inspect` (the operation ended before a start or an install), `start` or `install`.
- `start` and `end`: ISO 8601 times, UTC.
- `outcome`: `success`, `failure`, `cancelled` or `unknown`.

The line holds no username, password or device output. It is written to the editor console and to
`logs/combined.log` in the user data folder (see "The file").

## Test device

The feature is validated on a Raspberry Pi 4.

### Preparing it

1. With Raspberry Pi Imager, write Raspberry Pi OS Lite (64-bit) to the SD card. In the customisation
   settings, set a username and password and enable SSH with password authentication.
2. Boot the board on the same network as the editor and note its IP address.
3. Do not install any runtime. The board is then in the "no runtime" state.

### Reproducible states

Run these on the board over SSH. Each one gives a state the editor must handle; test it with Connect on
an "OpenPLC Runtime v4" target addressed to the board.

- **No runtime** (install path): remove any runtime the installer put there:

  ```sh
  curl -fsSL https://runtime.getedge.me | sudo bash -s -- --uninstall --yes
  ```

  Add `--purge` to also delete the runtime's data (users, project), so the next install ends in
  "Create First User".

- **Container install, Docker stopped** (start path): after an install,

  ```sh
  sudo systemctl stop docker docker.socket
  ```

- **Container install, bootloader stopped** (start path): after an install,

  ```sh
  sudo docker stop openplc-bootloader
  ```

- **Native v4 service stopped** (start path): uninstall the container install first, then build the
  runtime from source and stop its service:

  ```sh
  git clone https://github.com/Autonomy-Logic/openplc-runtime.git
  cd openplc-runtime
  sudo ./install.sh --native
  sudo systemctl stop openplc-runtime.service
  ```

- **v3 service present** (refused path): install OpenPLC Runtime v3 so that its `openplc.service` unit
  exists, or, to exercise only the detection, create a unit with that name:

  ```sh
  printf '[Unit]\nDescription=OpenPLC v3 test unit\n[Service]\nExecStart=/bin/true\n' \
    | sudo tee /etc/systemd/system/openplc.service
  sudo systemctl daemon-reload
  ```

  Remove it afterwards with `sudo rm /etc/systemd/system/openplc.service && sudo systemctl daemon-reload`.

- **Removing a host-key entry**: to reproduce the "Host key changed" warning, regenerate the board's host
  keys (`sudo rm /etc/ssh/ssh_host_* && sudo dpkg-reconfigure openssh-server && sudo systemctl restart ssh`)
  after a first login from the editor. Then remove the entry by hand as described in "Removing one entry
  by hand", and check that the next login trusts the new key on first use.

The state "bootloader running, runtime container stopped" is tested at unit level only: the bootloader
treats a stopped runtime container as a crash and restarts it within 2 to 30 s, so it cannot be held on a
real device.
