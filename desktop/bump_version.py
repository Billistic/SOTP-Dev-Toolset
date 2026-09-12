"""
Bump the app version everywhere it is recorded:  python desktop/bump_version.py 2.1.0

Then: commit, `git tag v2.1.0`, `git push --tags` - the release workflow builds, signs and publishes
the installer, and running desktop apps pick it up on their next update check.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        print(__doc__)
        return 1
    v = sys.argv[1]
    version_py = ROOT / "backend" / "app" / "version.py"
    version_py.write_text(re.sub(r'__version__ = "[^"]+"', f'__version__ = "{v}"', version_py.read_text(encoding="utf-8")), encoding="utf-8")
    pkg = ROOT / "frontend" / "package.json"
    data = json.loads(pkg.read_text(encoding="utf-8"))
    data["version"] = v
    pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    iss = ROOT / "desktop" / "installer.iss"
    iss.write_text(re.sub(r'#define AppVersion "[^"]+"', f'#define AppVersion "{v}"', iss.read_text(encoding="utf-8")), encoding="utf-8")
    changelog = ROOT / "CHANGELOG.md"
    text = changelog.read_text(encoding="utf-8") if changelog.exists() else "# Changelog\n"
    if f"## {v}" not in text:
        head, _, rest = text.partition("\n")
        changelog.write_text(f"{head}\n\n## {v}\n\n- \n{rest}", encoding="utf-8")
    print(f"version -> {v}  (backend/app/version.py, frontend/package.json, desktop/installer.iss, CHANGELOG.md)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
