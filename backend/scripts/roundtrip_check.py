"""Round-trip every Sins text file in the mod through parse -> write and report differences."""
import sys, os, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.sins import parse, write
from app.sins.writer import count_mismatches

MOD = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/USER2/Documents/Projects/SOTP/sotp-rebuild-master/sotp-rebuild-master")
EXTS = ('.entity', '.particle', '.brushes', '.sounddata', '.str', '.manifest', '.constants', '.texanim')
files = [p for p in MOD.rglob('*') if p.suffix.lower() in EXTS and not any(x in p.parts for x in ('tools', "Cole's Playground", 'Galaxy Forge', 'Mesh'))]
t0 = time.time(); ok = bad = 0; diag = {}; mism = 0
for p in files:
    raw = p.read_bytes().decode('utf-8', errors='replace')
    doc = parse(raw, str(p))
    out = write(doc, 'preserve')
    for d in doc.diagnostics: diag[d.code] = diag.get(d.code, 0) + 1
    mm = count_mismatches(doc.root)
    if mm:
        mism += 1
        if mism <= 5: print('COUNT MISMATCH', p.name, [(n.key, a, b) for n, a, b in mm][:3])
    if out == raw: ok += 1
    else:
        bad += 1
        if bad <= 5:
            a, b = raw.splitlines(), out.splitlines()
            for i, (x, y) in enumerate(zip(a, b)):
                if x != y: print('DIFF', p.name, 'line', i + 1, repr(x[:60]), '->', repr(y[:60])); break
            else: print('DIFF', p.name, 'length', len(a), len(b))
print(f'{ok} identical, {bad} differ, {mism} files with count mismatches, {len(files)} files, {time.time()-t0:.1f}s')
print('diagnostics:', diag)
