"""
Builds the asset index for a game-data root (the mod, or the base game).

Meshes are read header-only — the text ``.mesh`` files carry megabytes of
vertex data after the ``MeshData`` block we care about.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterator

from ..models import Asset
from ..sins import parse, parse_file

MESH_HEADER_BYTES = 64 * 1024

_FOLDERS = {
    "mesh": ("Mesh", (".mesh",)),
    "particle": ("Particle", (".particle",)),
    "texture": ("Textures", (".dds", ".tga", ".png")),
    "texanim": ("TextureAnimations", (".texanim",)),
    "fx": ("PipelineEffect", (".fx",)),
    "ogg": ("Sound", (".ogg", ".wav")),
}


def _hash_small(path: Path, limit: int = 1 << 20) -> str | None:
    if path.stat().st_size > limit:
        return None
    return hashlib.md5(path.read_bytes()).hexdigest()


def _rel(root: Path, path: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def index_root(root: Path, *, include_definitions: bool = False) -> Iterator[Asset]:
    """
    Yield Asset rows (without project/source set) for one data root.
    ``include_definitions`` also indexes entity names and string IDs - used for
    the base game so mod references can fall back to inherited definitions.
    """
    if include_definitions:
        yield from _entity_names(root)
        yield from _string_ids(root)
    for kind, (folder, exts) in _FOLDERS.items():
        directory = root / folder
        if not directory.is_dir():
            continue
        for p in sorted(directory.iterdir()):
            if not p.is_file() or p.suffix.lower() not in exts:
                continue
            meta: dict = {}
            if kind == "mesh":
                meta = _mesh_meta(p)
            elif kind == "particle":
                meta = _particle_meta(p)
            yield Asset(kind=kind, name=p.stem, name_lower=p.stem.lower(), path=_rel(root, p),
                        size_bytes=p.stat().st_size, file_hash=_hash_small(p), meta=meta)

    yield from _sound_definitions(root)
    yield from _brush_definitions(root)
    yield from _explosion_definitions(root)


def _mesh_meta(path: Path) -> dict:
    try:
        head = path.open("rb").read(64)
    except OSError:
        return {}
    if not head.startswith((b"TXT", b"\xef\xbb\xbfTXT")):
        return {"binary": True}
    try:
        doc = parse_file(path, max_bytes=MESH_HEADER_BYTES)
    except Exception:  # pragma: no cover - defensive against odd files
        return {"binary": False}
    data = doc.get("MeshData")
    if data is None:
        return {"binary": False}
    textures = sorted({str(n.value) for n in data.find(lambda n: n.base_key.endswith("TextureFileName") and n.value)})
    return {"binary": False, "boundingRadius": data.scalar("BoundingRadius"),
            "materials": data.scalar("NumMaterials"), "textures": textures}


def _particle_meta(path: Path) -> dict:
    try:
        doc = parse_file(path)
    except Exception:  # pragma: no cover
        return {}
    sim = doc.get("ParticleSimulation")
    if sim is None:
        return {}
    textures = sorted({str(n.value) for n in sim.find(lambda n: n.base_key == "textureName" and n.value)})
    fx = sorted({str(n.value) for n in sim.find(lambda n: n.base_key == "PipelineEffectID" and n.value)})
    return {"emitters": sim.scalar("NumEmitters"), "affectors": sim.scalar("NumAffectors"),
            "textures": textures, "pipelineEffects": fx}


def _sound_definitions(root: Path) -> Iterator[Asset]:
    for p in sorted((root / "GameInfo").glob("*.sounddata")) if (root / "GameInfo").is_dir() else []:
        doc = parse_file(p)
        rel = _rel(root, p)
        for block_key, kind in (("effect", "sound"), ("music", "music")):
            for block in doc.root.all(block_key):
                name = block.scalar("name")
                if not name:
                    continue
                yield Asset(kind=kind, name=str(name), name_lower=str(name).lower(), path=rel,
                            meta={"file": block.scalar("fileName"), "type": block.scalar("type"),
                                  "is3D": block.scalar("is3D"), "looping": block.scalar("isLooping"),
                                  "definedIn": p.name})


def _brush_definitions(root: Path) -> Iterator[Asset]:
    window = root / "Window"
    if not window.is_dir():
        return
    for p in sorted(window.glob("*.brushes")):
        doc = parse_file(p)
        rel = _rel(root, p)
        for brush in doc.root.all("brush"):
            name = brush.scalar("name")
            if not name:
                continue
            files = sorted({str(n.value) for n in brush.find(lambda n: n.base_key == "fileName" and n.value)})
            yield Asset(kind="brush", name=str(name), name_lower=str(name).lower(), path=rel,
                        meta={"content": brush.scalar("content"), "textures": files, "definedIn": p.name})


def _explosion_definitions(root: Path) -> Iterator[Asset]:
    p = root / "GameInfo" / "Explosions.explosiondata"
    if not p.is_file():
        return
    doc = parse_file(p)
    for group in doc.root.all("explosionEffectGroup"):
        name = group.scalar("groupName")
        if name:
            particles = sorted({str(n.value) for n in group.find(lambda n: n.base_key == "particleSystemName" and n.value)})
            yield Asset(kind="explosion", name=str(name), name_lower=str(name).lower(), path=_rel(root, p),
                        meta={"defs": group.scalar("explosionEffectDefCount"), "particles": particles})


def _entity_names(root: Path) -> Iterator[Asset]:
    folder = root / "GameInfo"
    if folder.is_dir():
        for p in sorted(folder.glob("*.entity")):
            yield Asset(kind="entity", name=p.stem, name_lower=p.stem.lower(), path=_rel(root, p), size_bytes=p.stat().st_size)


def _string_ids(root: Path) -> Iterator[Asset]:
    p = root / "String" / "English.str"
    if not p.is_file():
        return
    doc = parse(p.read_text(encoding="utf-8-sig", errors="replace"))
    for info in doc.root.all("StringInfo"):
        sid = info.scalar("ID")
        if sid:
            yield Asset(kind="string", name=str(sid), name_lower=str(sid).lower(), path=_rel(root, p))


def read_manifest(root: Path, name: str) -> list[str]:
    """Entries of ``<name>.manifest`` (e.g. entity.manifest) or [] when absent."""
    p = root / name
    if not p.is_file():
        return []
    doc = parse(p.read_text(encoding="utf-8-sig", errors="replace"))
    return [str(n.value) for n in doc.root.live_children() if not n.is_block and n.kind == "string" and n.value]
