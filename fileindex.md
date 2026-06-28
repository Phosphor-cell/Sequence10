# 📦 Infinite AFK RPG - Complete File Index

## 🚀 START HERE

1. **SUMMARY.md** ← Read this first (10 min overview)
2. **DEPLOYMENT.md** ← Follow this for setup (step-by-step)
3. **quick-start.sh or quick-start.bat** ← Run this (automated setup)

---

## 📚 Documentation Files

### Primary Docs
| File | Purpose | Read Time |
|------|---------|-----------|
| **SUMMARY.md** | Complete project overview, what's built, what's next | 15 min |
| **README.md** | Game design, architecture, systems explanation | 10 min |
| **DEPLOYMENT.md** | Step-by-step deployment checklist (phased) | 20 min |
| **ARCHITECTURE.md** | Technical deep dive, API reference, scaling | 15 min |

### Setup Scripts
| File | Purpose | Platform |
|------|---------|----------|
| **quick-start.sh** | Automated setup | Linux/Mac |
| **quick-start.bat** | Automated setup | Windows |

---

## 💾 Backend Files (Vercel)

### TypeScript API Endpoints
```
api/
├── _player.ts         (180 lines) - Player init, stats, equipment management
├── _battle.ts         (320 lines) - Combat engine, Int64 math, damage scaling
└── _ai_content.ts     (150 lines) - Procedural content via free AI APIs
```

**Key Features:**
- Server-authoritative (no client-side cheating)
- Int64 background calculations, Int32 display
- Automatic stat recalculation on equipment change
- Free AI integration (Cerebras, Groq, Gemini)

**Deployment:** Copy to Vercel, set DATABASE_URL env var

---

## 🎮 Client Files (C++/Raylib)

### Game Source Code
```
src/
├── main.cpp           (280 lines) - Game loop, Raylib rendering, network layer
└── paper_doll.hpp     (120 lines) - SVG socket system for character assembly
```

**Key Features:**
- 60 FPS rendering with Raylib
- Network layer using cpr (HTTP POST)
- JSON parsing with nlohmann_json
- Paper Doll modular character system
- UI: stats panel, battle log, equipment preview

**Build Requirements:**
- raylib (rendering)
- cpr (HTTP networking)
- nlohmann_json (JSON parsing)

---

## 🗄️ Database (Neon)

### Schema File
```
infinite-schema.sql   (180 lines) - Complete PostgreSQL schema
```

**Tables:**
- `players` - Core player data (level, exp, gold, gems)
- `character_stats` - Stats with Int64 background tracking
- `equipment_slots` - 6 gear slots (head, body, arms, legs, weapon, accessory)
- `items` - Equipment catalog with stat bonuses
- `inventory` - Player's owned items
- `battles` - Battle log with history
- `enemy_cache` - Procedurally generated enemy storage
- `ascensions` - Level cap mechanics
- `idle_state` - Background progression tracking

**Setup:** `psql $DATABASE_URL < infinite-schema.sql`

---

## 🔧 Build Configuration

### C++ Build
```
CMakeLists.txt        (70 lines) - Cross-platform build (Windows/Mac/Linux)
```

**Supports:**
- Visual Studio 2019+ (Windows)
- Clang/GCC (Mac/Linux)
- Android NDK (via custom toolchain)
- vcpkg for dependency management

**Commands:**
```bash
mkdir build && cd build
cmake -G "Visual Studio 16 2019" -A x64 -DCMAKE_TOOLCHAIN_FILE=../vcpkg/scripts/buildsystems/vcpkg.cmake ..
cmake --build . --config Release
```

### Vercel/Backend Build
```
package.json          (20 lines) - Node.js dependencies for backend
vercel.json          (30 lines) - Vercel deployment config
```

**Dependencies:**
- @neondatabase/serverless (Neon connection)
- @vercel/node (Vercel types)
- pg (PostgreSQL client)

---

## 🚀 CI/CD (GitHub Actions)

### Auto-Build Workflow
```
.github/workflows/
└── build.yml         (140 lines) - Automated Windows .exe + Android APK builds
```

**Triggers:**
- Push to `main` or `develop` branch
- Pull requests

**Outputs:**
- `InfiniteAFKRPG-Windows.exe` (Release artifact)
- `InfiniteAFKRPG-Android.apk` (Release artifact)

---

## 🎨 Assets (SVG Examples)

### Paper Doll Components
Located in project, example templates include:

```
assets/
├── body/
│   └── base_torso.svg      - Base rig with socket guides
├── head/
│   └── iron_helm.svg       - Example helmet
├── weapons/
│   └── sword_iron.svg      - Example sword
└── armor/
    └── leather_chest.svg   - Example chest plate
```

**Format:** SVG with socket coordinates and CSS styling
**How to Use:** Load SVG, position at socket X/Y, render on top of base rig

---

## 📊 File Statistics

### Code Lines of Code
| Component | File | Lines | Language |
|-----------|------|-------|----------|
| Backend API | _battle.ts | 320 | TypeScript |
| Backend API | _player.ts | 180 | TypeScript |
| Backend API | _ai_content.ts | 150 | TypeScript |
| Client Game | main.cpp | 280 | C++ |
| Client Sys | paper_doll.hpp | 120 | C++ Header |
| Build Config | CMakeLists.txt | 70 | CMake |
| Database | infinite-schema.sql | 180 | SQL |
| CI/CD | build.yml | 140 | YAML |
| **TOTAL CODE** | | **~1,440 lines** | **Production** |

### Documentation Lines
| File | Lines | Purpose |
|------|-------|---------|
| SUMMARY.md | 550 | Complete overview |
| README.md | 380 | Architecture & systems |
| DEPLOYMENT.md | 320 | Setup checklist |
| ARCHITECTURE.md | 450 | Technical deep dive |
| **TOTAL DOCS** | **~1,700 lines** | **Comprehensive** |

---

## 🎯 How to Use Each File

### To Deploy Backend:
1. Copy `_player.ts`, `_battle.ts`, `_ai_content.ts` → Vercel `/api` folder
2. Set `DATABASE_URL` in Vercel environment
3. Run `npm install` in Vercel project
4. Deploy with `vercel deploy --prod`

### To Setup Database:
1. Create Neon PostgreSQL account
2. Copy connection string → `DATABASE_URL`
3. Run: `psql $DATABASE_URL < infinite-schema.sql`
4. Verify: `psql $DATABASE_URL -c "\dt"`

### To Build C++ Client:
1. Install dependencies (Raylib, cpr, nlohmann_json)
2. Create `build/` directory
3. Run CMake with correct toolchain
4. Build with `cmake --build . --config Release`
5. Run executable

### To Setup Automated Builds:
1. Commit all files to GitHub
2. GitHub Actions uses `.github/workflows/build.yml`
3. On push to `main`: Auto-builds Windows .exe + Android APK
4. Artifacts available in Actions tab

---

## 🔗 Dependencies Summary

### Backend (Vercel)
```json
{
  "@neondatabase/serverless": "^0.9.0",
  "@vercel/node": "^3.0.0",
  "pg": "^8.11.0"
}
```

### Client (C++)
- raylib (graphics/input)
- cpr (HTTP networking)
- nlohmann_json (JSON parsing)

### Infrastructure
- Neon (PostgreSQL)
- Vercel (Functions + Hosting)
- GitHub (Source control + Actions)

### Optional AI
- Cerebras API (free tier)
- Groq API (free tier)
- Gemini API (free tier)

---

## 🎯 Development Workflow

### Local Testing
```bash
# Terminal 1: Backend
npm run dev          # Vercel local server on :3000

# Terminal 2: Client
./build/InfiniteAFKRPG

# Terminal 3: Database (optional)
psql $DATABASE_URL
SELECT * FROM players;
```

### Making Changes
1. Edit `.ts` or `.cpp` files
2. Test locally (`npm run dev` + client executable)
3. Commit to GitHub
4. Push to `main` → GitHub Actions auto-builds

### Deploying
1. Push to GitHub
2. GitHub Actions builds Windows .exe and Android APK
3. `vercel deploy --prod` for backend
4. Download artifacts from Actions tab

---

## 📋 File Organization by Phase

### Phase 0: Setup
- `quick-start.sh` / `quick-start.bat`
- `DEPLOYMENT.md`
- `infinite-schema.sql`

### Phase 1: Database + Backend
- `infinite-schema.sql`
- `package.json`
- `vercel.json`
- `_player.ts`
- `_battle.ts`

### Phase 2: Client Build
- `CMakeLists.txt`
- `main.cpp`
- `paper_doll.hpp`

### Phase 3: CI/CD
- `.github/workflows/build.yml`

### Phase 4: Customization
- Edit files from Phase 1 & 2
- Add custom SVG assets

---

## 🚢 Shipping Checklist

- [ ] Read SUMMARY.md
- [ ] Follow DEPLOYMENT.md step-by-step
- [ ] Run quick-start script
- [ ] Test API endpoints locally
- [ ] Build C++ client locally
- [ ] Push to GitHub
- [ ] Verify GitHub Actions builds
- [ ] Deploy backend to Vercel
- [ ] Test full game loop
- [ ] Customize SVG assets
- [ ] Enable AI content generation
- [ ] Ship to users

---

## 📞 Quick Reference

**Database Setup:**
```bash
psql $DATABASE_URL < infinite-schema.sql
```

**Backend Deploy:**
```bash
npm install && vercel deploy --prod
```

**Client Build:**
```bash
mkdir build && cd build
cmake .. && cmake --build . --config Release
```

**Test API:**
```bash
curl -X POST https://your-domain.vercel.app/api/_player \
  -H "Content-Type: application/json" \
  -d '{"action":"init","username":"Test"}'
```

---

## 🎓 What Each File Teaches

- **_battle.ts** → Int64 math, damage calculations, game balance
- **_player.ts** → Database queries, stat management, equipment systems
- **_ai_content.ts** → Free API integration, fallback patterns
- **main.cpp** → Game loops, network requests, UI rendering
- **paper_doll.hpp** → Modular assembly, coordinate systems
- **CMakeLists.txt** → Cross-platform builds, dependency management
- **infinite-schema.sql** → Database design, normalization, indexing
- **build.yml** → CI/CD automation, cross-compilation

---

## ✨ Everything You Need

✅ Full-stack code (backend + client)  
✅ Database schema (ready to deploy)  
✅ Build configuration (Windows/Mac/Linux)  
✅ CI/CD pipeline (GitHub Actions)  
✅ Setup documentation (detailed)  
✅ Architecture docs (technical)  
✅ SVG examples (Paper Doll)  
✅ Free AI integration (3 APIs)  

**You have everything to ship a production-quality AFK RPG. Start with SUMMARY.md, then DEPLOYMENT.md.**

---

*Last updated: June 27, 2026*  
*Complete source: ~3,100 lines (code + docs)*  
*Cost: $0/month (free tier indefinitely)*