"""Create-only, exact stopped-app backup; never repairs or removes source data."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys


def inventory(path):
    result = {}
    def visit(current, relative):
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode):
            result[relative] = ["link", os.readlink(current)]
        elif stat.S_ISDIR(info.st_mode):
            result[relative] = ["directory"]
            for child in sorted(current.iterdir()):
                visit(child, str(Path(relative) / child.name))
        elif stat.S_ISREG(info.st_mode):
            hasher = hashlib.sha256()
            with current.open('rb') as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                    hasher.update(chunk)
            digest = hasher.hexdigest()
            result[relative] = ["file", info.st_size, digest]
        else:
            raise RuntimeError(f"Unsupported backup entry: {current}")
    visit(path, ".")
    return result


def backup(sources, destination, require_stopped):
    require_stopped()
    before = {name: inventory(path) for name, path in sources.items()}
    needed = sum(entry[1] for tree in before.values() for entry in tree.values() if entry[0] == 'file')
    destination.mkdir(parents=True, exist_ok=False)
    os.chmod(destination, 0o700)
    if shutil.disk_usage(destination).free < needed + 2 * 1024**3:
        raise RuntimeError("Insufficient space for stopped backup plus 2 GiB floor")
    for name, source in sources.items():
        target = destination / name
        if source.is_dir():
            shutil.copytree(source, target, symlinks=True)
        else:
            shutil.copy2(source, target, follow_symlinks=False)
    require_stopped()
    after = {name: inventory(path) for name, path in sources.items()}
    copied = {name: inventory(destination / name) for name in sources}
    if before != after or before != copied:
        raise RuntimeError("Backup/source changed; installation refused, evidence retained")
    (destination / 'manifest.json').write_text(json.dumps({
        'status': 'passed', 'beforeAfterCopyExact': True,
        'sources': {name: str(path) for name, path in sources.items()},
        'inventory': before,
    }, indent=2))


def mac_stopped():
    result = subprocess.run(['pgrep', '-x', 'TextText'], capture_output=True)
    if result.returncode != 1:
        raise RuntimeError('TextText must quit normally before backup; no process is terminated')


if __name__ == '__main__':
    if sys.platform != 'darwin' or len(sys.argv) != 2:
        raise SystemExit('Usage on Mac: python3 release/stopped-backup.py <new destination>')
    home = Path.home()
    sources = {
        'app': Path('/Applications/TextText.app'),
        'vault': home / 'Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace',
        'device': home / 'Library/Group Containers/52WM463HR2.group.app.texttext/TextText',
        'credentials.json': home / 'Library/Application Support/TextText/credentials.json',
    }
    backup(sources, Path(sys.argv[1]), mac_stopped)
    print('Stopped backup verified:', sys.argv[1])
