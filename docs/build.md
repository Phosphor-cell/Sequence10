# Build & Deploy Guide

## 1. Deploy the database (5 min)

1. Open https://console.neon.tech → SQL Editor
2. Paste the contents of `database/schema.sql`
3. Click **Run** (NOT the Explain button)
4. Verify: run `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';` → should return 18

## 2. Get free API keys (10 min, all optional but recommended)

| Service | URL | Free tier | Use |
|---------|-----|-----------|-----|
| Groq | https://console.groq.com | Unlimited | Enemy/boss names (real-time) |
| Cerebras | https://console.cerebras.ai | 1M tokens/month | Loot names (batch) |
| Gemini | https://ai.google.dev | 1500 req/day | Fallback |

The game works without any keys — falls back to procedural names.

## 3. Deploy server to Vercel (10 min)

```bash
cd server
npm install
npx vercel login
npx vercel deploy --prod
```

In the Vercel dashboard → Settings → Environment Variables, add:
- `DATABASE_URL`    — from Neon connection details
- `GROQ_API_KEY`    — from Groq console (optional)
- `CEREBRAS_API_KEY`— from Cerebras console (optional)
- `GEMINI_API_KEY`  — from Google AI Studio (optional)

Copy your Vercel domain (e.g. `your-project.vercel.app`).

## 4. Build the C++ client (Windows)

```cmd
# Install vcpkg (one-time)
git clone https://github.com/Microsoft/vcpkg
cd vcpkg
bootstrap-vcpkg.bat
cd ..

# Configure and build
cd client
mkdir build && cd build
cmake .. -DCMAKE_TOOLCHAIN_FILE=..\..\vcpkg\scripts\buildsystems\vcpkg.cmake
cmake --build . --config Release
```

CMake will automatically download and build:
- Raylib 5.0 (includes nanosvg.h — no manual copy needed)
- cpr 1.10.5 (HTTP client)
- nlohmann/json 3.11.3
- sqlite3 (amalgamation, compiled inline)

First build: ~5-10 minutes (downloading + compiling deps).
Subsequent builds: ~30 seconds.

## 5. Set your Vercel URL and run

Edit `client/src/main.cpp` line 14:
```cpp
const char* API_BASE = "https://YOUR-PROJECT.vercel.app/api";
```

Rebuild (just `cmake --build . --config Release` again), then:
```
.\Release\CultivationAFK.exe
```

## Controls

| Key | Action |
|-----|--------|
| SPACE | Fight an enemy |
| R | Force sync player state |
| ESC | Quit |

## What works end-to-end

- Player created in Neon on first launch
- SPACE triggers battle → server resolves with Int64 math → saves to DB
- 65% chance of loot drop → equips to paper doll automatically
- Rare+ loot gets AI-generated name (Groq, <1s) or keeps procedural name
- Enemy name AI-generated per level bucket (cached 72h)
- All stats panel reflects equipped bonuses
- Background sync every 5s keeps local state consistent

## File layout

```
game/
├── BUILD.md               ← you are here
├── client/
│   ├── CMakeLists.txt     ← FetchContent: downloads all deps automatically
│   ├── assets/            ← SVG placeholder assets (procedural gen fills the rest)
│   └── src/
│       ├── main.cpp       ← game loop, UI, network
│       ├── paper_doll.cpp ← SVG generation + layered rendering
│       └── paper_doll.hpp ← public interface
├── server/
│   ├── .env.example       ← copy to .env, fill in keys
│   ├── package.json
│   ├── tsconfig.json
│   ├── vercel.json
│   └── api/
│       ├── _player.ts     ← init, getState, equipItem
│       ├── _battle.ts     ← combat engine (Int64), level-up
│       ├── _loot.ts       ← loot drop, AI enrichment for Rare+
│       ├── _ai.ts         ← Groq→Cerebras→Gemini→fallback, with DB cache
│       └── loot_core.ts   ← pure deterministic loot generator
└── database/
    └── schema.sql         ← verified on PG16, 18 tables
```