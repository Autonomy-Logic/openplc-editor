# openplc-cli

The editor's operations, headless: create a project, compile it, upload it to a
target, and drive a live debug session. Every command runs the same code the GUI
control it mirrors runs, so a test that passes here is testing the editor and not
a parallel implementation.

| GUI control                   | Command                            |
| ----------------------------- | ---------------------------------- |
| Build                         | `openplc-cli compile <project>`    |
| Build & Upload                | `openplc-cli upload <project>`     |
| Search / serial-port dropdown | `openplc-cli devices`              |
| Debug                         | `openplc-cli debug open …`         |
| Start / Stop                  | `openplc-cli debug start` / `stop` |
| Variable poll, force dialog   | `openplc-cli debug read` / `force` |

## Installing

The command is a small shim on your PATH that runs the app with `--cli`. The app
installs it **on first run**, so launching OpenPLC Editor once is usually all it
takes. `openplc-cli install-cli` does it explicitly — for a CI image that never
opens the GUI, or after the app moves.

It goes in the first **user-writable** directory it finds, preferring one already
on your PATH:

| Platform     | Directories tried                     |
| ------------ | ------------------------------------- |
| macOS, Linux | `~/.local/bin`, then `~/bin`          |
| Windows      | `%LOCALAPPDATA%\Programs\openplc-cli` |

Nothing is installed to a privileged location, so no administrator password is
ever requested. If the chosen directory is not on your PATH, the command prints
the one line to add — on Windows the per-user PATH is updated for you, and a new
terminal picks it up.

### macOS

Install OpenPLC Editor into `/Applications` first, then open it once.

Running from the mounted `.dmg` cannot work: the shim would point inside the disk
image and break the moment it is ejected, so the app says so instead of
installing something that will fail later. The same applies when macOS has
quarantined the app — launching it straight out of `Downloads` makes Gatekeeper
run it from a randomised temporary path that changes every launch.

### Linux

The editor ships as an AppImage. The image is mounted at a fresh temporary path
on every launch, so the shim points at the **`.AppImage` file** instead, which is
wherever you keep it. Move the file to its final location before installing; if
you move it later, run `install-cli` again (or just launch the app, which
notices the change).

```sh
chmod +x 'OpenPLC Editor-4.2.2.AppImage'
./'OpenPLC Editor-4.2.2.AppImage' --cli install-cli
openplc-cli --version
```

Launching the GUI once does the same thing, and is the simplest route on a
desktop.

You do **not** need `xvfb-run`, and you do not need to pass Chromium switches.
A CLI run needs `--ozone-platform=headless`, because Electron initialises its
display layer during startup and exits without one. The generated shim passes it,
and a direct `--cli` call re-executes itself with it — so an SSH session or a CI
runner with no display works as-is.

`--no-sandbox` is a separate matter, and it is **not** passed for you. Chromium's
sandbox is left on wherever it can start, which is everywhere unprivileged user
namespaces are available — any current desktop kernel. The exception is an
environment where they are not, Docker's default being the notable one: Chromium
falls back to its SUID sandbox helper and aborts _before any of our code runs_,
so no relaunch can rescue it and the call has to carry the switch itself.

Pass it once, to install, and it is remembered:

```sh
./'OpenPLC Editor-4.2.2.AppImage' --no-sandbox --cli install-cli
openplc-cli devices        # no switches needed from here on
```

`install-cli` records that the installing call ran without the sandbox and writes
`--no-sandbox` into the shim, so later `openplc-cli` calls in that container keep
working. A desktop install writes a shim **without** it, and keeps the sandbox —
which is the point: the switch follows the environment that needs it instead of
being handed to every Linux user. Both cases are verified in a container, with
and without `--security-opt seccomp=unconfined`.

### Windows

Run the installer, then launch the editor once. `openplc-cli.cmd` is placed in
`%LOCALAPPDATA%\Programs\openplc-cli` and that directory is added to your user
PATH; open a new terminal afterwards.

Verified on Windows 11 (24H2): `--help` exits 0, no arguments and an unknown
command exit 2, a missing project exits 3, `--version` and `devices` each write
one JSON document to stdout, the usage text goes to stderr, and a closed pipe
returns in ~3s instead of hanging. The shim is invoked by name from a new shell:

```bat
openplc-cli --version
openplc-cli devices > devices.json
```

> **Calling it from a `.bat` / `.cmd` script needs `call`.** The shim is a batch
> file, and batch invoking batch without `call` TRANSFERS control instead of
> returning — the rest of your script silently never runs, and you never see
> `%ERRORLEVEL%`. This is how every `.cmd` wrapper behaves (`npm.cmd` included),
> not something specific to this one:
>
> ```bat
> call openplc-cli compile "C:\path\to\project"
> if errorlevel 1 exit /b %ERRORLEVEL%
> ```
>
> From PowerShell, `cmd`'s interactive prompt, or any non-batch caller, the plain
> form is correct and `$LASTEXITCODE` / `%ERRORLEVEL%` is set as expected.

> Console output from a GUI-subsystem executable is not attached to an
> interactive terminal on Windows. Redirection and piping work
> (`openplc-cli devices > devices.json`), which is what a test harness does.

## In a build pipeline

Verified in a `debian:12` container as root and as an unprivileged user, with no
`DISPLAY`, no TTY and stdout piped.

You do not need a display server or `xvfb-run`. You do need Electron's shared
libraries, which a slim base image will not have:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 \
      libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libpango-1.0-0 libcairo2 libatspi2.0-0 \
 && rm -rf /var/lib/apt/lists/*
```

Then, once per image:

```sh
./OpenPLC-Editor.AppImage --no-sandbox --cli install-cli
```

`--no-sandbox` is needed here and not on a desktop: container runtimes usually
block unprivileged user namespaces, so Chromium falls back to its SUID sandbox
helper and refuses to start. The generated shim carries the switch, so nothing
after this call needs it.

A build step then looks like any other:

```sh
openplc-cli compile ./my-project --target "OpenPLC Runtime v4"   # exit 0, or 4 on a compile error
openplc-cli upload  ./my-project --host "$PLC_HOST" --yes        # --yes stops a RUNNING PLC first
```

Reading the result:

```sh
BUILD=$(openplc-cli compile ./my-project --target "OpenPLC Runtime v4") || exit $?
echo "$BUILD" | jq -r '.buildDirectory'
```

`stdout` is one JSON document, so `jq` needs no filtering; progress and Chromium's
own D-Bus complaints go to `stderr`. Gate on the exit code — 4 is a compile
error, 5 a connection problem, 7 the device refusing — rather than on log text.

### First run on a clean machine

The CLI creates the editor's user-data scaffolding itself (settings, history, the
arduino-cli config), so a fresh container needs no warm-up step. Board packages
are a different matter: a target from an installed `.vpp` package is only
available if that package is installed in the image's user-data directory, which
`--user-data <dir>` can point at a prepared one.

## Output contract

Machine-readable when stdout is not a terminal, human-readable when it is;
`--json` / `--no-json` override.

- In JSON mode stdout carries **exactly one** JSON document — the result. Progress
  and diagnostics go to stderr, so `JSON.parse(stdout)` needs no filtering.
- No ANSI, spinners or progress bars in JSON mode.
- Values carry their type, so `0` is unambiguously `BOOL FALSE` or `INT 0`.
  64-bit integers arrive as decimal strings, which an IEEE double cannot hold.
- Errors are objects with a stable `code`. The prose may be reworded; the code
  will not.

### Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | ok                                                     |
| 2    | usage — unknown command, missing or malformed argument |
| 3    | not found — project, file or session                   |
| 4    | compile failed                                         |
| 5    | connection — could not reach the target, or lost it    |
| 6    | auth — credentials refused                             |
| 7    | target error — the device reported failure             |
| 8    | timeout                                                |
| 70   | internal — a bug in the CLI                            |

## Credentials

Targets reached through a runtime API need them; a board flashed over USB does
not.

```sh
--credentials user:pass          # or --user / --password
OPENPLC_CREDENTIALS=user:pass    # or OPENPLC_USER + OPENPLC_PASSWORD
```

Prefer the environment form in CI: a flag lands in shell history and job logs.

## Debug sessions

A debug session is long-lived; a test step is one process. So `debug open` starts
a background session and returns a `session_id`, and every other command is a
cheap one-shot that attaches to it — no reconnect, no re-verify, no re-upload per
command.

```sh
openplc-cli debug open ./my-project --target "OpenPLC Runtime v4" \
  --host 192.168.2.4 --credentials op:op        # -> 8df020af1234

openplc-cli debug list                          # every live session
openplc-cli debug read main:counter
openplc-cli debug force main:enable TRUE
openplc-cli debug watch main:counter --interval 100
openplc-cli debug poll                          # what was recorded meanwhile
openplc-cli debug close --all
```

With one session open, `--session` is optional. With several, it is required.

### A session closes itself after 30 minutes idle

This is the one fact a long-running harness has to know, because closing
**releases the session's forces** — mid-test, on live hardware, if the run is
quiet for long enough.

|                       |                                     |
| --------------------- | ----------------------------------- |
| default               | 30 minutes with no command          |
| `--idle-timeout <ms>` | on `debug open`; a different budget |
| `--idle-timeout 0`    | never close on idle                 |

"Idle" means no command reached the session. Two things deliberately do **not**
count: `watch` sampling in the background (the session is busy, but nobody asked
for anything) and `debug list`, which dials each session to report its state —
polling a list must not keep sessions alive for ever.

A value that is not a number is a usage error rather than a silent fallback: the
point of naming a timeout is that the default was wrong for this run.

### Flags, by command

| Flag                        | Command                             | Meaning                                                                 |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `--session <id>`            | any `debug` subcommand              | which session, when several are open                                    |
| `--idle-timeout <ms>`       | `debug open`                        | idle budget; `0` disables (see above)                                   |
| `--force-new`               | `debug open`                        | start a session even if one is already open for this project and target |
| `--upload-if-needed`        | `debug open`                        | upload first when the target's program does not match                   |
| `--var <name>`              | `read`, `write`, `force`, `unforce` | the variable, when you would rather not pass it positionally            |
| `--value <literal>`         | `write`, `force`                    | the value — `16#FF`, `TRUE`, `T#5s`, all as the GUI accepts them        |
| `--filter <substring>`      | `list-vars`                         | only variables whose path contains it                                   |
| `--interval <ms>`           | `watch`                             | sampling cadence; floor 20 ms                                           |
| `--since <seq>`             | `poll`                              | only samples after this sequence number                                 |
| `--keep-forces`             | `close`                             | leave forced variables pinned                                           |
| `--all`                     | `close`                             | every session, not just one                                             |
| `--keep-going`              | `exec`                              | run the remaining lines after one fails                                 |
| `--force`                   | `create`                            | overwrite an existing destination                                       |
| `--clean`                   | `compile`, `upload`                 | discard the build directory first                                       |
| `-y`, `--yes`               | `upload`                            | skip the confirmation                                                   |
| `--create-user <user:pass>` | `upload`, `debug open`              | create the first user on a fresh runtime v4                             |

`watch` **records** into a buffer inside the session rather than streaming, so a
transient that happens between two of your own commands is still there when you
`poll`.

`debug repl` is the same protocol with a prompt, for a human at a terminal. For a
script use `debug exec`, which reads one command per line — the REPL refuses a
pipe rather than dropping commands, which is what readline does with buffered
input.

### Forcing

`close` releases the variables the session forced, unless you pass
`--keep-forces`. This is deliberate: forcing lives in the runtime's forced-slot
bitmap and the runtime cannot tell that a debugger went away — it clears forces
only on program unload or stop. A session that exited quietly would leave outputs
pinned on a live PLC.

`status` reports what this session has forced, which is what `close` will
release. A stop issued from elsewhere (the runtime UI, a mode switch) clears the
runtime's forces without the session knowing, so that list can be stale.

## Building on a running PLC

Targets that build on the device refuse while its PLC is RUNNING, exactly as the
editor warns — on-device compilation can stall the build or make the running
program miss scan deadlines. `--yes` / `-y` approves stopping it first, the way
`apt install -y` does. Nothing stops a running PLC without being asked.
