#!/usr/bin/env python3
"""Cold-launch timeline for the Mac app. Run by hand; nothing schedules this.

    mac/scripts/measure-launch.py [runs] [label]
    MEASURE_SERVER=http://localhost:3000 mac/scripts/measure-launch.py 3 local

Milestones, all from `ps` so nothing needs a TCC grant:

  process      the app pid exists
  networking   a NEW com.apple.WebKit.Networking pid exists
  webcontent   a NEW com.apple.WebKit.WebContent pid exists, i.e. the app has
               called webView.load and stopped being the thing we are waiting on
  render       WebContent has burned 150 ms of CPU, so the page is running
  settled      WebContent CPU has been flat for 800 ms, so the page is done

Identifying WebContent by "a pid we had not seen" is the whole trick, and
getting it wrong is how an earlier pass reported a five second launch that was
not real: WebKit leaves WebContent and Networking processes alive long after
the app quits (a set 55 minutes old was observed), so a harness that matches
by name alone locks onto a corpse or misses the live one. Hence the pid
snapshot before launch and the pause that lets the previous run's services go.
"""
import os
import subprocess
import sys
import time

WEBKIT = {
    "networking": "com.apple.WebKit.Networking",
    "webcontent": "com.apple.WebKit.WebContent",
}
EXTENSION = "TextTextFileProvider"
SERVER = os.environ.get("MEASURE_SERVER")


def snapshot():
    out = subprocess.run(
        ["ps", "-Ao", "pid=,time=,comm="], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3:
            rows.append((int(parts[0]), parts[1], parts[2].rsplit("/", 1)[-1]))
    return rows


def cpu_seconds(value):
    try:
        return sum(float(b) * 60 ** i for i, b in enumerate(reversed(value.split(":"))))
    except ValueError:
        return 0.0


def run(label, timeout=25.0):
    subprocess.run(["pkill", "-x", "TextText"], capture_output=True)
    deadline = time.time() + 15
    while time.time() < deadline:
        if not subprocess.run(["pgrep", "-x", "TextText"],
                              capture_output=True).stdout.strip():
            break
        time.sleep(0.1)
    time.sleep(2.0)  # let the previous run's WebKit services exit too

    before = {pid for pid, _, _ in snapshot()}
    command = ["open", "-a", "TextText"]
    if SERVER:
        command = ["open", "--env", f"TEXTTEXT_SERVER={SERVER}", "-a", "TextText"]
    started = time.time()
    subprocess.run(command)

    marks, pids = {}, {}
    app_pid, app_cpu, extension_cpu = None, 0.0, 0.0
    webcontent_cpu, render_at, last_change, last_cpu = 0.0, None, None, None
    while time.time() - started < timeout:
        now = time.time() - started
        rows = snapshot()
        for pid, cpu, name in rows:
            if name == "TextText":
                if app_pid is None:
                    app_pid, marks["process"] = pid, now
                if pid == app_pid:
                    app_cpu = cpu_seconds(cpu)
            elif name == EXTENSION:
                extension_cpu = max(extension_cpu, cpu_seconds(cpu))
            for key, process in WEBKIT.items():
                if name == process and pid not in before and key not in marks:
                    marks[key], pids[key] = now, pid
            if pids.get("webcontent") == pid:
                webcontent_cpu = cpu_seconds(cpu)
                if webcontent_cpu > 0.15 and render_at is None:
                    render_at = now
                if last_cpu is None or abs(webcontent_cpu - last_cpu) > 0.005:
                    last_cpu, last_change = webcontent_cpu, now
        if render_at is not None and last_change is not None \
                and (time.time() - started) - last_change > 0.8:
            marks["settled"] = last_change
            break
        time.sleep(0.025)

    if render_at is not None:
        marks["render"] = render_at
    timeline = "  ".join(
        f"{key}={marks[key] * 1000:.0f}ms" if key in marks else f"{key}=--"
        for key in ("process", "networking", "webcontent", "render", "settled"))
    print(f"{label}: {timeline}   webcontent_cpu={webcontent_cpu:.2f}s "
          f"app_cpu={app_cpu:.2f}s fileprovider_cpu={extension_cpu:.2f}s")
    return marks


if __name__ == "__main__":
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    name = sys.argv[2] if len(sys.argv) > 2 else "run"
    for index in range(runs):
        run(f"{name} {index + 1}")
