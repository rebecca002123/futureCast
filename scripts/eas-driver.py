#!/usr/bin/env python3
"""Drive eas-cli through its interactive prompts unattended.

eas-cli refuses to create signing credentials with --non-interactive, so we
run it interactively inside a pty and press Enter (accept the default)
whenever output goes quiet — every prompt in this flow has a sensible
default. Apple authentication itself is non-interactive via the
EXPO_ASC_* environment variables set by the workflow.

eas-cli is pinned to 21.5.0: 22.0.0 (released 2026-08-14) breaks Apple
capability syncing with an invalid request payload; 21.5.0 matches the
latest-eas-build dist-tag used by EAS's own infrastructure.
"""
import os
import pty
import select
import subprocess
import sys
import time

EAS_VERSION = "21.5.0"

COMMANDS = {
    "build": f"npx eas-cli@{EAS_VERSION} build --platform ios --profile production --no-wait",
    "submit": f"npx eas-cli@{EAS_VERSION} submit --platform ios --latest --verbose",
}

QUIET_SECONDS = 25

def main():
    # eas-cli forces non-interactive mode when CI is set (GitHub runners
    # always set it), which forbids creating credentials. Our pty makes the
    # session genuinely interactive, so drop the CI markers.
    os.environ.pop("CI", None)
    os.environ.pop("GITHUB_ACTIONS", None)

    command = COMMANDS[os.environ.get("EAS_COMMAND", "build")]
    print(f"::: running: {command}", flush=True)

    master, slave = pty.openpty()
    proc = subprocess.Popen(
        command,
        shell=True,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
    )
    os.close(slave)

    last_output = time.time()
    while proc.poll() is None:
        readable, _, _ = select.select([master], [], [], 1)
        if readable:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            if data:
                sys.stdout.buffer.write(data)
                sys.stdout.flush()
                last_output = time.time()
        elif time.time() - last_output > QUIET_SECONDS:
            # Probably a prompt waiting for input: accept the default.
            print("\n::: quiet for a while — pressing Enter", flush=True)
            os.write(master, b"\r")
            last_output = time.time()

    # Drain whatever is left in the pty buffer.
    while True:
        readable, _, _ = select.select([master], [], [], 0.5)
        if not readable:
            break
        try:
            data = os.read(master, 4096)
        except OSError:
            break
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.flush()

    code = proc.wait()
    print(f"\n::: eas exited with code {code}", flush=True)
    sys.exit(code)

if __name__ == "__main__":
    main()
