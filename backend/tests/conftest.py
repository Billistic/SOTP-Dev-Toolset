import os, sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

MOD_ROOT = Path(os.environ.get(
    "SOTP_MOD_ROOT",
    r"C:/Users/USER2/Documents/Projects/SOTP/sotp-rebuild-master/sotp-rebuild-master"))


@pytest.fixture(scope="session")
def mod_root() -> Path:
    if not MOD_ROOT.is_dir():
        pytest.skip("mod corpus not available")
    return MOD_ROOT


@pytest.fixture(scope="session")
def gameinfo(mod_root: Path) -> Path:
    return mod_root / "GameInfo"
