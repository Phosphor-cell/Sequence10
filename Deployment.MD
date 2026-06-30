# Infinite AFK RPG: Deployment Checklist

## Phase 1: Database Setup (Neon)

- [ ] Create Neon account at [neon.tech](https://neon.tech)
- [ ] Create new PostgreSQL project
- [ ] Copy `DATABASE_URL` connection string
- [ ] Apply schema:
  ```bash
  psql $DATABASE_URL < infinite-schema.sql
  ```
- [ ] Verify tables exist:
  ```bash
  psql $DATABASE_URL -c "\dt"
  ```

## Phase 2: Backend Setup (Vercel)

- [ ] Create Vercel account and link to GitHub
- [ ] Fork/clone this repository to your GitHub
- [ ] Connect repository to Vercel project
- [ ] Set environment variables in Vercel dashboard:
  - `DATABASE_URL` = (from Neon)
  - `CEREBRAS_API_KEY` = (optional, from [console.cerebras.ai](https://console.cerebras.ai))
  - `GROQ_API_KEY` = (optional, from [console.groq.com](https://console.groq.com))
  - `GEMINI_API_KEY` = (optional, from [ai.google.dev](https://ai.google.dev))
- [ ] Deploy backend:
  ```bash
  npm install
  vercel deploy --prod
  ```
- [ ] Copy your Vercel domain (e.g., `infinite-afk-xyz.vercel.app`)
- [ ] Test API:
  ```bash
  curl https://your-vercel-domain.vercel.app/api/_player \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"action":"init","username":"TestPlayer"}'
  ```

## Phase 3: C++ Client Setup (Local)

### Windows

- [ ] Install Visual Studio 2019 or later
- [ ] Clone repository:
  ```bash
  git clone https://github.com/yourusername/infinite-afk-rpg.git
  cd infinite-afk-rpg
  ```
- [ ] Install vcpkg:
  ```bash
  git clone https://github.com/Microsoft/vcpkg.git
  cd vcpkg && .\bootstrap-vcpkg.bat
  cd ..
  ```
- [ ] Install dependencies:
  ```bash
  vcpkg\vcpkg install raylib:x64-windows cpr:x64-windows nlohmann-json:x64-windows
  ```
- [ ] Update `src/main.cpp` with your Vercel domain:
  ```cpp
  const char* API_BASE = "https://your-domain.vercel.app/api";
  ```
- [ ] Build:
  ```bash
  mkdir build && cd build
  cmake -G "Visual Studio 16 2019" -A x64 -DCMAKE_TOOLCHAIN_FILE=../vcpkg/scripts/buildsystems/vcpkg.cmake ..
  cmake --build . --config Release
  ```
- [ ] Run:
  ```bash
  .\Release\InfiniteAFKRPG.exe
  ```

### macOS

- [ ] Install Homebrew
- [ ] Install dependencies:
  ```bash
  brew install cmake raylib cpr nlohmann-json
  ```
- [ ] Build:
  ```bash
  mkdir build && cd build
  cmake .. -DCMAKE_BUILD_TYPE=Release
  cmake --build . -- -j$(sysctl -n hw.ncpu)
  ```
- [ ] Run:
  ```bash
  ./InfiniteAFKRPG
  ```

### Linux (Ubuntu/Debian)

- [ ] Install dependencies:
  ```bash
  sudo apt-get install -y cmake build-essential libraylib-dev libcpr-dev nlohmann-json3-dev
  ```
- [ ] Build:
  ```bash
  mkdir build && cd build
  cmake .. -DCMAKE_BUILD_TYPE=Release
  make -j$(nproc)
  ```
- [ ] Run:
  ```bash
  ./InfiniteAFKRPG
  ```

## Phase 4: GitHub Actions (Auto-Build)

- [ ] Ensure `.github/workflows/build.yml` exists in repo
- [ ] Push to `main` branch
- [ ] Check **Actions** tab for build artifacts
- [ ] Download Windows .exe and Android APK

## Phase 5: Verification

### Backend Tests

- [ ] POST `/api/_player?action=init&username=TestPlayer`
  - Expected: Returns `playerId`, `username`
- [ ] POST `/api/_player?action=getState&playerId=<ID>`
  - Expected: Full player state with stats
- [ ] POST `/api/_battle`
  - Expected: Battle result with `victory`, `damageDealt`, `goldEarned`

### Client Tests

- [ ] Launch `InfiniteAFKRPG.exe`
- [ ] See player stats panel on left
- [ ] Press SPACE to initiate battle
- [ ] Verify stats update after battle
- [ ] Check Vercel logs for API calls

### Database Verification

```bash
# Connect to Neon
psql $DATABASE_URL

# Check player created
SELECT * FROM players;

# Check stats
SELECT * FROM character_stats;

# Check battle log
SELECT * FROM battles;

# Check inventory
SELECT * FROM inventory;
```

## Phase 6: Customization

- [ ] Update game balance (health/attack/gold values in `_battle.ts`)
- [ ] Replace placeholder SVGs with custom Paper Doll assets in `/assets`
- [ ] Integrate AI content generation (uncomment AI calls in `_battle.ts` or `_ai_content.ts`)
- [ ] Adjust progression scaling (exp formulas in backend)
- [ ] Configure ascension caps and level limits

## Phase 7: Production Deployment

- [ ] Enable Vercel production domain
- [ ] Set up custom domain (optional)
- [ ] Configure Neon automatic backups
- [ ] Set up monitoring/logging (Vercel Dashboard)
- [ ] Add rate limiting if needed (Vercel edge middleware)
- [ ] Create GitHub releases with build artifacts

## Troubleshooting

### Build Fails: vcpkg triplet not found
```bash
vcpkg install raylib:x64-windows --verbose
```

### API Returns 500
Check Vercel logs:
```bash
vercel logs --tail
```

### Database connection refused
Verify DATABASE_URL is set in Vercel environment:
```bash
vercel env list
```

### C++ compilation error: "raylib.h not found"
Ensure CMAKE_TOOLCHAIN_FILE points to vcpkg's toolchain:
```bash
cmake .. -DCMAKE_TOOLCHAIN_FILE=../vcpkg/scripts/buildsystems/vcpkg.cmake
```

---

## Cost Breakdown

| Service | Free Tier | Cost |
|---------|-----------|------|
| **Neon (PostgreSQL)** | 0.5 GB storage | $0 |
| **Vercel (Functions)** | 100GB bandwidth/month | $0 |
| **GitHub** | Public repos, Actions | $0 |
| **Cerebras API** | 1M tokens/month | $0 |
| **Groq API** | Unlimited (rate-limited) | $0 |
| **Gemini API** | 15 req/min | $0 |
| **Total** | **Single-player AFK RPG** | **$0/month** |

---

## Next Steps

1. Complete all checkboxes above
2. Test locally with `InfiniteAFKRPG.exe`
3. Iterate on game balance
4. Add custom SVG Paper Doll assets
5. Enable AI content generation
6. Push to GitHub (auto-builds on Actions)
7. Share with friends!

---

**Questions?** See README.md or open an issue on GitHub.