#!/usr/bin/env python3
"""mac-app adapter relay for sync/stress/coordinator.mjs. Explicit test invocation only.

Reads the coordinator's JSONL on stdin, writes each message as a numbered atomic
request file into a NEW session directory, and prints the native runner's
numbered reply files to stdout. The native runner is an explicitly supplied,
prebuilt TextText actor executable (built with -DTEXTTEXT_STRESS_ACTOR, see
mac/Sources/TextText/NativeStressRunner.swift) launched once as an ordinary
child process in the current GUI session. The Mac counterpart of
windows/scripts/stress-native.ps1.

Does not build, install, change credentials, select a root, delete journals, or
register any persistent job. The installed TextText app must already be closed;
this refuses to start while any TextText process is running.

Usage (as the coordinator role command):
  python3 mac/scripts/stress-native.py --actor /abs/TextTextStressActor.app/Contents/MacOS/TextText \
      --config /abs/mac-app.json --session /abs/new/session/dir [--total-minutes 20] [--reply-seconds 100]
"""
import argparse
import json
import os
import pwd
import subprocess
import sys
import time

MAX_LINE = 256 * 1024
TITLE_PREFIX = "Six-client acceptance "
out, err = sys.stdout, sys.stderr
relay_failed = False


def emit(line):
    out.write(line + "\n")
    out.flush()


def fail(message, round_=0):
    # Fixed strings only; never echo request content or configured paths.
    global relay_failed
    relay_failed = True
    emit(json.dumps({"type": "error", "round": round_, "message": message}))


def validate(args):
    for path in (args.actor, args.config):
        if not os.path.isabs(path) or not os.path.isfile(path):
            raise SystemExit(f"Missing input: {path}")
    if not os.access(args.actor, os.X_OK):
        raise SystemExit("Actor executable is not executable.")
    parts = os.path.normpath(args.actor).split(os.sep)
    if len(parts) < 4 or parts[-2] != "MacOS" or parts[-3] != "Contents" or not parts[-4].endswith(".app"):
        raise SystemExit("Actor must be the executable inside a prebuilt .app bundle (…/Contents/MacOS/TextText).")
    if os.path.normpath(args.actor).startswith("/Applications/"):
        raise SystemExit("Refusing to use the installed app as the actor; point at a private actor bundle.")
    if not os.path.isabs(args.session):
        raise SystemExit("Session must be an absolute path.")
    if os.path.exists(args.session):
        raise SystemExit("Use a new session directory for each run.")
    with open(args.config, "rb") as handle:
        if len(handle.read(16 * 1024 + 1)) > 16 * 1024:
            raise SystemExit("Config is too large.")
    with open(args.config, encoding="utf-8-sig") as handle:
        config = json.load(handle)
    title, file = config.get("title"), config.get("file")
    if not isinstance(title, str) or not isinstance(file, str) or not title.startswith(TITLE_PREFIX) \
            or os.path.splitext(os.path.basename(file))[0] != title:
        raise SystemExit("Not a dedicated acceptance file.")
    running = subprocess.run(["pgrep", "-x", "TextText"], capture_output=True, text=True)
    if running.stdout.strip():
        raise SystemExit("Close the normal TextText app first; preserve any pending edits.")


def minimal_env():
    # The coordinator hands adapters only PATH. The actor needs a home directory to
    # find the product's own state and workspace configuration; nothing TEXTTEXT_*
    # is forwarded, so no origin, state-dir or credential override can reach it.
    home = pwd.getpwuid(os.getuid()).pw_dir
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": home, "USER": pwd.getpwuid(os.getuid()).pw_name}
    for key in ("TMPDIR", "LANG"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def write_request(session, seq, line):
    final = os.path.join(session, f"req-{seq:06d}.json")
    temporary = final + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(line)
    os.replace(temporary, final)


def wait_reply(session, seq, seconds, deadline, process):
    path = os.path.join(session, f"rep-{seq:06d}.json")
    until = time.monotonic() + seconds
    while time.monotonic() < until and time.monotonic() < deadline:
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as handle:
                    text = handle.read()
                if text:
                    return text.rstrip("\r\n")
            except OSError:
                pass
        elif process.poll() is not None:
            time.sleep(0.3)  # a reply written just before exit gets one more look
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as handle:
                    return handle.read().rstrip("\r\n")
            return None
        time.sleep(0.1)
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--total-minutes", type=int, default=20, choices=range(1, 121), metavar="1..120")
    parser.add_argument("--reply-seconds", type=int, default=100, choices=range(5, 121), metavar="5..120")
    args = parser.parse_args()
    validate(args)
    os.makedirs(args.session, mode=0o700)
    deadline = time.monotonic() + args.total_minutes * 60
    exit_code = 1
    stderr_log = open(os.path.join(args.session, "actor.stderr.log"), "wb")
    process = subprocess.Popen([args.actor, "--stress", args.config, args.session], stdin=subprocess.DEVNULL,
                               stdout=stderr_log, stderr=stderr_log, env=minimal_env(), cwd=args.session)
    seq, shutdown_sent = 0, False
    try:
        while not shutdown_sent and time.monotonic() < deadline:
            line = sys.stdin.readline()
            if not line:
                break  # coordinator closed stdin
            line = line.rstrip("\r\n")
            if not line.strip():
                continue
            if len(line) > MAX_LINE:
                fail("Request exceeds the message bound.")
                break
            try:
                message = json.loads(line)
            except ValueError:
                fail("Request is not valid JSON.")
                continue
            type_ = message.get("type", "") if isinstance(message, dict) else ""
            round_ = message.get("round", 0) if isinstance(message, dict) and isinstance(message.get("round"), int) else 0
            seq += 1
            if process.poll() is not None and seq > 1:
                fail("Native runner is no longer running.", round_)
                break
            write_request(args.session, seq, line)
            if type_ == "shutdown":
                shutdown_sent = True
            wait = min(120, args.reply_seconds + 60) if type_ == "hello" else args.reply_seconds
            reply = wait_reply(args.session, seq, wait, deadline, process)
            if reply is None:
                fail(f"No native reply within the bound for {type_ or 'request'}.", round_)
                break
            if type_ == "shutdown":
                try:
                    if json.loads(reply).get("ok") and not relay_failed:
                        exit_code = 0
                except ValueError:
                    pass
            else:
                emit(reply)
        if not shutdown_sent and process.poll() is None:
            # Stdin ended or the relay failed: still ask the runner to flush through production and close.
            seq += 1
            write_request(args.session, seq, '{"type":"shutdown"}')
            reply = wait_reply(args.session, seq, args.reply_seconds, deadline, process)
            if reply is not None:
                try:
                    if json.loads(reply).get("ok") and not relay_failed:
                        exit_code = 0
                except ValueError:
                    pass
        until = time.monotonic() + 30
        while time.monotonic() < until and process.poll() is None:
            time.sleep(0.5)
        if process.poll() is None:
            err.write(f"Native runner still running after shutdown; leaving it and {args.session} in place for recovery.\n")
            exit_code = 1
        elif process.returncode != 0:
            err.write(f"Native runner exited with {process.returncode}. Inspect {args.session}; journals are preserved.\n")
            exit_code = 1
    finally:
        stderr_log.close()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
