# Revisit once the base game is installed

Follow-ups for **Build from definition** (issue #19) and the grammar it relies on. These
can't be checked until there is a vanilla Rebellion install to compare against (QA #12
was deferred for the same reason). Set the project's *Base game root* first.

## Grammar accuracy
- [ ] **Learn enum values from vanilla files** (the QA #12 plan): at ingest, collect every
      value the base game uses for each enum or option field and merge them into
      `grammar().layout(doc, extra_enums)`. The XML tables date from 2017.
      `branch_swap` rejects options the tables don't list. The form still lets you set
      them (as a plain `set`), but nothing is swapped in for them.
- [ ] **`isDamageShared`** (in `buffInstantActionType.xml`, several branches) has no type,
      so it is generated as `isDamageShared ""`. It is probably a Boolean; confirm from
      vanilla and fix the def.
- [ ] **`attachType ""` in `planetRuinDef`**: since the `values="..."` enum fix, all 25
      SOTP planets get INVALID_ENUM_VALUE for an empty `attachType`. Check whether vanilla
      planets also use `""`. If they do, accept an empty value for that field instead of
      warning.
- [ ] **Untyped fields**: run a sweep of fields that fall back to `string` (no
      `validation`/`type`, e.g. `buffEntityModifierType` inside entityModifier). Compare
      them with vanilla values and add the missing types.
- [ ] **`zz_rebellion_1_8.xml` extensions**: check them against the installed game
      version and DLC.

## Generated files (`Grammar.skeleton`)
- [ ] **Field order and set per type**: for each of the 27 `ENTITY_TYPES`, diff the
      skeleton's key sequence against a few vanilla files of that type, and add a corpus
      test. Optional fields are included today (e.g. `allowFirstSpawnerToStack`, which
      vanilla has but most mod buffs omit). Decide per field whether to keep including
      them.
- [ ] **Byte-exact walkthrough**: build `BuffFighterBlinkTrigger` through the API and
      compare it with the vanilla `BuffFighterBlinkTrigger.entity` (ignoring CRLF).
      `test_build_buff_from_definition` covers this today against the issue's expected
      text only.
- [ ] **`SinsArchiveVersion`**: new files copy the project's most common value (mod: 851×
      194, 3× 193), falling back to 194. Confirm what vanilla Rebellion ships.
- [ ] **Default option per condition field**: the first option in the XML wins today
      (`buffInstantActionType` → `GiveExperience`, `instantActionTriggerType` →
      `OnCondition`). Consider using the option vanilla uses most often instead.
- [ ] **Default numbers**: these are `0` / `0.000000` / `FALSE`. Consider vanilla-typical
      defaults (e.g. `stackingLimit` is `-1` or `1` in practice, never `0`).

## References
- [ ] **Particle and sound pickers**: index the vanilla particle and sound names so
      `smallEffectName` / `mediumEffectName` / `largeEffectName` / `soundID` (and other
      Particle/Sound refs) can be picked and validated instead of typed freely.
- [ ] **BIN files**: stock GameInfo may be binary. Report unconverted files with a
      ConvertData hint, or use the studio debinariser if its terms allow bundling.
