"""
Individual validation rules.  Each rule is a plain function that yields
``Diagnostic`` rows; ``ValidationService`` decides when to run them and
persists the results.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Iterable, Iterator

from ..models import Diagnostic, Entity, FactionMember, GameString, Reference
from ..sins import Document
from ..sins.schemas import schema_for
from ..sins.writer import count_mismatches

# reference kind -> (severity when the kind is fully indexed, severity when the base game is not indexed)
_REF_SEVERITY = {
    "entity": ("error", "warning"),
    "string": ("warning", "warning"),
    "mesh": ("error", "warning"),
    "explosion": ("error", "warning"),
    "particle": ("warning", "info"),
    "sound": ("warning", "info"),
    "music": ("warning", "info"),
    "brush": ("warning", "info"),
    "texture": ("warning", "info"),
    "texanim": ("warning", "info"),
}

BUILDABLE_TYPES = {"Frigate", "CapitalShip", "PlanetModuleStandard", "PlanetModuleHangarDefense",
                   "PlanetModuleShipFactory", "PlanetModuleTradePort", "PlanetModuleRefinery", "ResearchSubject"}

_SLOT_TYPES = {"ability": {"Ability"}, "squadTypeEntityDef": {"Squad"}, "fighterEntityDef": {"Fighter"},
               "fighterIllusionEntityDef": {"Fighter"}, "buffType": {"Buff"}, "buffTypeToRemove": {"Buff"},
               "Subject": {"ResearchSubject"}, "cargoShipType": {"Frigate"}, "flagship": {"Frigate", "CapitalShip"}}


def _d(project_id: int, scope: str, severity: str, code: str, message: str, *, entity: Entity | None = None,
       path: str | None = None, line: int | None = None, target: str | None = None) -> Diagnostic:
    return Diagnostic(project_id=project_id, entity_id=entity.id if entity else None,
                      entity_name=entity.name if entity else None, scope=scope, severity=severity,
                      code=code, message=message, path=path, line=line, target=target)


# ── entity-level rules ───────────────────────────────────────────────────

def parse_diagnostics(project_id: int, entity: Entity, doc: Document) -> Iterator[Diagnostic]:
    adopted = 0
    for d in doc.diagnostics:
        if d.code == "INDENT_ADOPTED":
            adopted += 1
            continue
        line = None if d.line_no is None else d.line_no + 1
        yield _d(project_id, "entity", d.severity, d.code, d.message, entity=entity, line=line)
    if adopted:
        yield _d(project_id, "entity", "info", "INDENT_ADOPTED",
                 f"{adopted} line(s) are indented inconsistently with the structure the engine reads.", entity=entity)


def count_rules(project_id: int, entity: Entity, doc: Document) -> Iterator[Diagnostic]:
    for node, declared, actual in count_mismatches(doc.root):
        yield _d(project_id, "entity", "error", "COUNT_MISMATCH",
                 f"'{node.key}' declares {declared} but {actual} item(s) follow.", entity=entity,
                 path=node.key, line=None if node.line_no is None else node.line_no + 1)


def required_keys(project_id: int, entity: Entity, doc: Document) -> Iterator[Diagnostic]:
    for key in schema_for(entity.entity_type).required:
        if doc.get(key) is None:
            yield _d(project_id, "entity", "error", "MISSING_REQUIRED_KEY",
                     f"Required key '{key}' is missing for {entity.entity_type}.", entity=entity, path=key)


def weapon_rules(project_id: int, entity: Entity, doc: Document) -> Iterator[Diagnostic]:
    weapons = doc.root.all("Weapon")
    if not weapons:
        return
    idx = doc.scalar("m_weaponIndexForRange")
    if isinstance(idx, int) and idx >= len(weapons):
        yield _d(project_id, "entity", "error", "RANGE_WEAPON_INDEX",
                 f"m_weaponIndexForRange={idx} but only {len(weapons)} weapon(s) exist.", entity=entity, path="m_weaponIndexForRange")
    for i, w in enumerate(weapons):
        cooldown = w.scalar("PreBuffCooldownTime")
        banks = [w.scalar(f"DamagePerBank:{b}") or 0 for b in ("FRONT", "BACK", "LEFT", "RIGHT")]
        if isinstance(cooldown, (int, float)) and cooldown <= 0:
            yield _d(project_id, "entity", "error", "ZERO_COOLDOWN", f"Weapon {i} has a cooldown of {cooldown}.",
                     entity=entity, path=f"Weapon[{i}].PreBuffCooldownTime")
        if all((b or 0) <= 0 for b in banks):
            yield _d(project_id, "entity", "info", "ZERO_DAMAGE_WEAPON", f"Weapon {i} deals no damage on any bank.",
                     entity=entity, path=f"Weapon[{i}]")


def economy_rules(project_id: int, entity: Entity) -> Iterator[Diagnostic]:
    t = entity.typed_json or {}
    if entity.category in ("ship", "module") and entity.entity_type != "Fighter" and t.get("cost_total") == 0:
        yield _d(project_id, "entity", "info", "ZERO_COST", "Unit has no credit/metal/crystal cost.", entity=entity, path="basePrice")


# ── reference rules ──────────────────────────────────────────────────────

def reference_rules(project_id: int, entity: Entity, refs: Iterable[Reference], *, entity_index: dict[str, int],
                    entity_types: dict[int, str], string_ids: set[str], assets: dict[str, dict[str, str]],
                    vanilla_indexed: bool) -> Iterator[Diagnostic]:
    for ref in refs:
        ref.resolved, ref.resolved_source, ref.target_entity_id = False, None, None
        key = ref.target_lower
        if ref.kind == "entity":
            eid = entity_index.get(key)
            if eid is not None:
                ref.resolved, ref.resolved_source, ref.target_entity_id = True, "mod", eid
                expected = _SLOT_TYPES.get(ref.key)
                if expected and entity_types.get(eid) not in expected:
                    yield _d(project_id, "reference", "error", "WRONG_ENTITY_TYPE",
                             f"'{ref.key}' points at {ref.target} which is a {entity_types.get(eid)}, expected {'/'.join(sorted(expected))}.",
                             entity=entity, path=ref.path, target=ref.target)
                continue
            if key in assets.get("entity", {}):  # inherited from the base game
                ref.resolved, ref.resolved_source = True, "vanilla"
                continue
        elif ref.kind == "string":
            if ref.target in string_ids:
                ref.resolved, ref.resolved_source = True, "mod"
                continue
            if key in assets.get("string", {}):
                ref.resolved, ref.resolved_source = True, "vanilla"
                continue
            if ref.target.startswith("IDS") and not vanilla_indexed:
                yield _d(project_id, "reference", "info", "VANILLA_STRING",
                         f"String '{ref.target}' is not in the mod; it looks like a base-game ID.", entity=entity, path=ref.path, target=ref.target)
                continue
        else:
            stem = key.rsplit(".", 1)[0] if key.endswith((".dds", ".tga", ".ogg", ".mesh", ".particle", ".png")) else key
            source = assets.get(ref.kind, {}).get(stem)
            if source is None and ref.kind == "sound":
                source = assets.get("music", {}).get(stem)
            if source is not None:
                ref.resolved, ref.resolved_source = True, source
                continue
        full, degraded = _REF_SEVERITY.get(ref.kind, ("warning", "info"))
        severity = full if vanilla_indexed else degraded
        note = "" if vanilla_indexed else " (base game not indexed - may be inherited)"
        yield _d(project_id, "reference", severity, f"MISSING_{ref.kind.upper()}",
                 f"'{ref.key}' references {ref.kind} '{ref.target}' which was not found{note}.",
                 entity=entity, path=ref.path, target=ref.target)


# ── project-wide rules ───────────────────────────────────────────────────

def manifest_rules(project_id: int, root: Path, manifest: list[str], entities_by_path: dict[str, Entity],
                   vanilla_entities: dict[str, str], vanilla_indexed: bool) -> Iterator[Diagnostic]:
    if not manifest and not (root / "entity.manifest").is_file():
        yield _d(project_id, "manifest", "error", "MANIFEST_MISSING", "entity.manifest is missing from the mod root.")
        return
    listed = {m.lower() for m in manifest}
    on_disk = {p.rsplit("/", 1)[-1].lower(): e for p, e in entities_by_path.items()}
    for name in manifest:
        low = name.lower()
        if low in on_disk or low.rsplit(".", 1)[0] in vanilla_entities:
            continue
        severity = "error" if vanilla_indexed else "warning"
        note = "" if vanilla_indexed else " (base game not indexed - may be inherited)"
        yield _d(project_id, "manifest", severity, "MANIFEST_MISSING_FILE",
                 f"entity.manifest lists '{name}' but no such file exists in GameInfo{note}.", target=name)
    for fname, entity in on_disk.items():
        if fname not in listed:
            yield _d(project_id, "manifest", "warning", "NOT_IN_MANIFEST",
                     "File exists but is not listed in entity.manifest, so the game will not load it.", entity=entity, target=fname)
    seen: set[str] = set()
    for name in manifest:
        if name.lower() in seen:
            yield _d(project_id, "manifest", "warning", "MANIFEST_DUPLICATE", f"'{name}' is listed twice in entity.manifest.", target=name)
        seen.add(name.lower())
    from .manifest_service import EntityManifest   # local: avoids a rules -> service import cycle at load time
    for line_no, text in EntityManifest.load(root).malformed():
        yield _d(project_id, "manifest", "warning", "MANIFEST_MALFORMED",
                 f"entity.manifest line {line_no} has text after the closing quote ({text.strip()!r}); the game may misread it.",
                 line=line_no, target=text.strip())


def player_rules(project_id: int, members: list[FactionMember], entity_index: dict[str, int],
                 entities: list[Entity], players: dict[int, Entity]) -> Iterator[Diagnostic]:
    reachable: set[str] = set()
    seen: set[tuple[int, str, str]] = set()
    for m in members:
        dup_key = (m.player_entity_id, m.slot, m.member_name.lower())
        if dup_key in seen:
            yield _d(project_id, "player", "warning", "PLAYER_DUPLICATE_MEMBER",
                     f"{m.player_name} lists '{m.member_name}' more than once under {m.slot}.",
                     entity=players.get(m.player_entity_id), target=m.member_name, path=m.slot)
        seen.add(dup_key)
        eid = entity_index.get(m.member_name.lower())
        m.member_entity_id = eid
        player = players.get(m.player_entity_id)
        if eid is None:
            yield _d(project_id, "player", "error", "PLAYER_MISSING_MEMBER",
                     f"{m.player_name} lists '{m.member_name}' under {m.slot} but no such entity exists.",
                     entity=player, target=m.member_name, path=m.slot)
        else:
            reachable.add(m.member_name.lower())
    for e in entities:
        if e.entity_type in BUILDABLE_TYPES and e.name.lower() not in reachable:
            yield _d(project_id, "player", "info", "UNREACHABLE_ENTITY",
                     f"{e.entity_type} is not listed by any Player, so it cannot be built or researched in game.", entity=e)


def research_rules(project_id: int, research: list[Entity], members: list[FactionMember],
                   prereqs: dict[int, list[tuple[str, int]]], entity_index: dict[str, int],
                   by_id: dict[int, Entity]) -> Iterator[Diagnostic]:
    # window position collisions inside one player's research screen
    slots: dict[tuple[str, str, int, int, int], list[str]] = defaultdict(list)
    name_to_entity = {e.name.lower(): e for e in research}
    for m in members:
        if m.slot != "research":
            continue
        e = name_to_entity.get(m.member_name.lower())
        if e is None:
            continue
        t = e.typed_json or {}
        if t.get("window_x") is None:
            continue
        bucket = slots[(m.player_name, t.get("field") or "", int(t.get("window_block") or 0), int(t["window_x"]), int(t.get("window_y") or 0))]
        if e.name not in bucket:
            bucket.append(e.name)
    for (player, field, block, x, y), names in slots.items():
        if len(names) > 1:
            for n in names:
                yield _d(project_id, "research", "warning", "RESEARCH_POS_COLLISION",
                         f"Shares research screen slot {field} block {block} pos [{x},{y}] in {player} with: {', '.join(o for o in names if o != n)}.",
                         entity=name_to_entity[n.lower()], path="researchWindowLocation")
    # prerequisite level must be achievable
    for e in research:
        for subject, level in prereqs.get(e.id, []):
            tid = entity_index.get(subject.lower())
            target = by_id.get(tid) if tid else None
            if target is None:
                continue
            max_levels = (target.typed_json or {}).get("max_levels")
            if isinstance(max_levels, int) and level > max_levels:
                yield _d(project_id, "research", "error", "PREREQ_LEVEL_TOO_HIGH",
                         f"Requires {subject} level {level} but it only has {max_levels} level(s).", entity=e, target=subject)


def string_rules(project_id: int, strings: list[GameString], used: set[str]) -> Iterator[Diagnostic]:
    for s in strings:
        if s.duplicate_count > 1:
            yield _d(project_id, "string", "warning", "DUPLICATE_STRING",
                     f"'{s.string_id}' is defined {s.duplicate_count} times in {s.source_file}; the game keeps the first.",
                     target=s.string_id, line=s.line_no)
        if s.string_id not in used and s.string_id != "READ_THIS":
            yield _d(project_id, "string", "info", "UNUSED_STRING", f"'{s.string_id}' is not referenced by any entity.",
                     target=s.string_id, line=s.line_no)


def asset_rules(project_id: int, sound_defs: list[tuple[str, str | None]], files: dict[str, str],
                vanilla_indexed: bool) -> Iterator[Diagnostic]:
    """Sound definitions whose audio file is absent from the Sound folder."""
    severity = "warning" if vanilla_indexed else "info"
    note = "" if vanilla_indexed else " (base game not indexed - may be inherited)"
    for name, file in sound_defs:
        if file and file.lower().rsplit(".", 1)[0] not in files:
            yield _d(project_id, "asset", severity, "SOUND_FILE_MISSING",
                     f"Sound '{name}' points at '{file}' which is not in the Sound folder{note}.", target=name)
