import json, os, re, subprocess

root = "/home/claude/Sequence10_fresh"
def read(p):
    try:
        with open(os.path.join(root,p), encoding='utf-8', errors='replace') as f: return f.read()
    except: return ""

# Endpoints: parse purpose + whether mock/real + whether client calls it
client = read("client/src/main.cpp")
client_calls = sorted(set(re.findall(r'apiPost\("([^"]+)"', client)))

endpoints = {}
api_dir = os.path.join(root,"server/api")
for fn in sorted(os.listdir(api_dir)):
    if not fn.endswith(".ts"): continue
    name = fn[:-3]
    txt = read(f"server/api/{fn}")
    first_comments = " ".join(l.strip("/ ").strip() for l in txt.splitlines()[:6] if l.strip().startswith("//"))
    is_endpoint = not name.startswith("_")
    route = f"/api/{name}" if is_endpoint else None
    mock = "mock" in first_comments.lower() or "Mock" in txt[:300]
    endpoints[name] = {
        "file": f"server/api/{fn}",
        "lines": len(txt.splitlines()),
        "is_http_endpoint": is_endpoint,
        "route": route,
        "called_by_client": name in client_calls,
        "is_mock": mock,
        "purpose": first_comments[:140],
    }

# Screens
screens = []
m = re.search(r'enum class Screen\s*\{([^}]+)\}', client)
if m: screens = [s.strip() for s in m.group(1).replace("\n"," ").split(",") if s.strip()]

# Tables from schema
schema = read("database/schema.sql")
tables = re.findall(r'CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)', schema)
tables = sorted(set(tables))

# Assets
def count_ext(d):
    out={}
    for dp,_,fs in os.walk(os.path.join(root,d)):
        for f in fs:
            e=f.rsplit(".",1)[-1] if "." in f else "none"
            out[e]=out.get(e,0)+1
    return out

manifest = {
    "project": "Sequence10 / Cultivation AFK Realm: Divine Descent",
    "generated_note": "Auto-generated from source. Re-run scripts/gen_manifest.py after structural changes.",
    "live_url": "https://sequence10.vercel.app",
    "stack": {
        "client": "C++17 + Raylib + cpr + nlohmann_json",
        "server": "Vercel serverless (TypeScript, Node 24.x)",
        "database": "Neon PostgreSQL",
        "rendering": "procedural SVG paper-doll (nanosvg)"
    },
    "client_entry": "client/src/main.cpp",
    "client_screens": screens,
    "client_api_calls": client_calls,
    "endpoints": endpoints,
    "database_tables": tables,
    "database_table_count": len(tables),
    "assets": {
        "backdrops": count_ext("client/assets/backdrops"),
        "placeholders": count_ext("client/assets/placeholders"),
    },
    "critical_invariants": [
        "Vercel ignores /api files starting with '_' (helpers, not endpoints)",
        "raylib needs SUPPORT_FILEFORMAT_JPG=1 (set in client/CMakeLists.txt) or .jpg backdrops fail",
        "tsconfig target must be ES2020+ for BigInt literals",
        "combat numbers are BigInt; cross the wire as strings",
        "all endpoints set CORS '*' and handle OPTIONS"
    ],
    "known_gaps_priority": [
        "endpoints are in-memory mocks; 19 DB tables unused (no persistence)",
        "client calls mock battle.ts, not tested battle_v2.ts",
        "affinity.ts built+tested but never called by client",
        "equipping armor has no mechanical effect (visual only)",
        "no ability system (planned 150 abilities + synergies)",
        "no idle/AFK reward calculation despite idle_state table",
        "no level-up curve or ascension path",
        "asset_manager.hpp is an unimplemented skeleton"
    ]
}
with open(os.path.join(root,"system_manifest.json"),"w") as f:
    json.dump(manifest,f,indent=2)
print("Wrote system_manifest.json")
print(json.dumps({k:(v if not isinstance(v,(dict,list)) else f"<{type(v).__name__} len {len(v)}>") for k,v in manifest.items()},indent=2))
