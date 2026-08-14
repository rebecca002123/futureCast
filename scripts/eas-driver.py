#!/usr/bin/env python3
"""Drive eas-cli through its interactive prompts unattended.

eas-cli refuses to create signing credentials with --non-interactive, so we
run it interactively inside a pty and press Enter (accept the default)
whenever output goes quiet — every prompt in this flow has a sensible
default. Apple authentication itself is non-interactive via the
EXPO_ASC_* environment variables set by the workflow.
"""
import os
import pty
import select
import subprocess
import sys
import time

COMMANDS = {
    "build": "npx eas-cli@latest build --platform ios --profile production --no-wait",
    "submit": "npx eas-cli@latest submit --platform ios --latest --verbose",
}

QUIET_SECONDS = 25

def main():
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

    code = proc.returncode or 0
    print(f"\n::: eas exited with code {code}", flush=True)
    sys.exit(code)

if __name__ == "__main__":
    main()
