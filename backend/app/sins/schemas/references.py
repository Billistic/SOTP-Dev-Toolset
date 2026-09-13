"""
Cross-reference classification.

Which fields point at other entities, strings, meshes, particles, sounds,
brushes… was derived empirically by resolving every string value in the SOTP
corpus against each asset index, then curated.  Explicit keys win; suffix
patterns catch the long tail (``*StringID``, ``*EffectName``, ``*SoundID``).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterator

from ..document import Document, Node
from ..structure import REPEATABLE

ENTITY, STRING, MESH, PARTICLE, SOUND, MUSIC, BRUSH, TEXTURE, EXPLOSION, TEXANIM = (
    "entity", "string", "mesh", "particle", "sound", "music", "brush", "texture", "explosion", "texanim")

REFERENCE_KEYS: dict[str, str] = {
    # entities
    "entityDefName": ENTITY, "Subject": ENTITY, "buffType": ENTITY, "buffTypeToRemove": ENTITY,
    "fighterEntityDef": ENTITY, "fighterIllusionEntityDef": ENTITY, "flagship": ENTITY,
    "cargoShipType": ENTITY, "squadTypeEntityDef": ENTITY, "ability": ENTITY, "swapMineType": ENTITY,
    "ruinPlanetType": ENTITY,
    # localisation
    "NameStringID": STRING, "DescriptionStringID": STRING, "nameStringID": STRING, "descStringID": STRING,
    "descriptionStringID": STRING, "counterDescriptionStringID": STRING, "raceNameStringID": STRING,
    "typeNameStringID": STRING, "title": STRING, "defaultFactionNameID": STRING,
    # meshes
    "meshName": MESH, "MeshName": MESH, "ShieldMeshName": MESH, "randomMeshName": MESH,
    "elevatorMeshName": MESH, "specificDebrisMeshName": MESH, "asteroidTemplate": MESH,
    "dustCloudTemplate": MESH, "nullMeshParticleEffect": MESH, "meshFileName": MESH,
    # particles
    "muzzleEffectName": PARTICLE, "hitEffectName": PARTICLE, "projectileTravelEffectName": PARTICLE,
    "missileTravelEffectName": PARTICLE, "ExhaustParticleSystemName": PARTICLE,
    "exhaustParticleSystemName": PARTICLE, "buildEffectName": PARTICLE,
    "meshNameIncreasedEffectName": PARTICLE, "meshNameDecreasedEffectName": PARTICLE,
    "smallEffectName": PARTICLE, "mediumEffectName": PARTICLE, "largeEffectName": PARTICLE,
    "effectName": PARTICLE, "attachedEmitterName": PARTICLE,
    # sounds
    "sound": SOUND, "SoundID": SOUND, "soundID": SOUND, "EngineSoundID": SOUND, "engineSoundID": SOUND,
    "ambienceSoundID": SOUND, "rotateSoundName": SOUND, "GameEventSound": SOUND,
    "musicTheme": MUSIC,
    # brushes (UI images)
    "hudIcon": BRUSH, "smallHudIcon": BRUSH, "infoCardIcon": BRUSH, "mainViewIcon": BRUSH,
    "picture": BRUSH, "launchIcon": BRUSH, "dockIcon": BRUSH, "artifactPicture": BRUSH,
    "uniqueOverlayBrush": BRUSH, "undetectedMainViewIcon": BRUSH, "farIcon": BRUSH,
    "backdrop": BRUSH, "tierIndicatorBackdrop": BRUSH, "hasWonPicture": BRUSH, "hasLostPicture": BRUSH,
    "themeBackdropBrush": BRUSH, "loadScreenCharacterBrush": BRUSH, "fleetIcon": BRUSH,
    "pictureBrush": BRUSH,
    # textures
    "beamGlowTextureName": TEXTURE, "beamCoreTextureName": TEXTURE, "cloudLayerTextureName": TEXTURE,
    "exhaustTrailTextureName": TEXTURE, "iconTextureName": TEXTURE, "textureName": TEXTURE,
    # others
    "ExplosionName": EXPLOSION, "textureAnimationName": TEXANIM,
}

# suffix -> kind, checked in order when the key is not listed above
SUFFIX_RULES: tuple[tuple[str, str], ...] = (
    ("StringID", STRING), ("StringId", STRING),
    ("EffectSoundID", SOUND), ("SoundID", SOUND), ("SoundName", SOUND),
    ("EffectName", PARTICLE), ("EffectNameBetweenStars", PARTICLE), ("EffectNameDestabilized", PARTICLE),
    ("MeshName", MESH), ("TextureName", TEXTURE), ("TextureFileName", TEXTURE),
    ("Icon", BRUSH), ("Picture", BRUSH), ("Brush", BRUSH), ("Backdrop", BRUSH), ("Overlay", BRUSH),
)

# keys under Player.hudSkinData etc. that are brush names but have irregular names
_BRUSH_HINT = re.compile(r"(Icon|Picture|Brush|Backdrop|Overlay|Bandbox|FogOfWar|Cap(High|Low)Res)")

# keys whose values look like references but are enumerations / prefixes
NOT_REFERENCES: frozenset[str] = frozenset({
    "entityType", "researchField", "ResearchField", "field", "RequiredFactionNameID",
    "randomCapitalShipNamePrefix", "randomStarBaseNamePrefix", "raceNameParsePrefix",
    "raceNameParsePrefixFallback", "planetTypeForResearch", "name", "fileName", "ID", "Value",
    "PipelineEffectID", "Name", "playerPictureGroupName", "playerThemeGroupName",
})


def classify_key(key: str, parent_key: str | None = None) -> str | None:
    """Return the reference kind for a base key, or None when it is not a reference."""
    base = key.split(":", 1)[0]
    if base in NOT_REFERENCES:
        return None
    if base in REFERENCE_KEYS:
        return REFERENCE_KEYS[base]
    for suffix, kind in SUFFIX_RULES:
        if base.endswith(suffix):
            return kind
    if parent_key in ("hudSkinData", "gameOverWindowData", "researchScreenData") and _BRUSH_HINT.search(base):
        return BRUSH
    return None


@dataclass(frozen=True, slots=True)
class Reference:
    path: str
    key: str
    kind: str
    target: str


def classify_node(node: Node, grammar_kinds: dict[int, str]) -> str | None:
    """
    Kind of one value node: the curated tables first (exclusions and explicit keys - they were verified against the
    asset indexes, e.g. musicTheme is a music track, not a sound), then the grammar's validation type, then the
    suffix heuristics for whatever is left.
    """
    base = node.base_key
    if base in NOT_REFERENCES:
        return None
    if base in REFERENCE_KEYS:
        return REFERENCE_KEYS[base]
    kind = grammar_kinds.get(id(node))
    if kind is not None:
        return kind
    parent_key = node.parent.key if node.parent is not None else None
    return classify_key(node.key, parent_key)


def _grammar_kinds(doc: Document) -> dict[int, str]:
    from ..grammar import grammar   # local: keeps the schemas package importable without the grammar tables
    try:
        return grammar().node_kinds(doc)
    except Exception:   # a grammar hiccup must never stop ingest
        return {}


def extract_references(doc: Document) -> Iterator[Reference]:
    """Yield every non-empty reference in an entity document."""
    kinds = _grammar_kinds(doc)
    for path, node in doc.root.walk(REPEATABLE):
        if node.is_block or node.kind != "string":
            continue
        target = node.value
        if not target:
            continue
        kind = classify_node(node, kinds)
        if kind is None:
            continue
        yield Reference(path=path, key=node.base_key, kind=kind, target=str(target))


def reference_kinds(doc: Document) -> dict[str, str]:
    """path -> kind for every string-valued node that is a reference, empty values included."""
    out: dict[str, str] = {}
    kinds = _grammar_kinds(doc)
    for path, node in doc.root.walk():   # index only real duplicates, matching the UI's path convention
        if node.is_block or node.kind != "string":
            continue
        kind = classify_node(node, kinds)
        if kind is not None:
            out[path] = kind
    return out


def strip_asset_suffix(name: str) -> str:
    """Asset references sometimes carry an extension (``Foo.dds``); compare on the stem."""
    return name.rsplit(".", 1)[0] if "." in name and len(name.rsplit(".", 1)[1]) <= 5 else name
