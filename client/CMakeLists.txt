cmake_minimum_required(VERSION 3.20)
project(CultivationAFK)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Policy fixes for CMake 4.x compatibility with Raylib 5.0
set(CMAKE_POLICY_DEFAULT_CMP0048 NEW)
cmake_policy(SET CMP0048 NEW)
if(POLICY CMP0177)
    cmake_policy(SET CMP0177 NEW)
endif()
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)

include(FetchContent)

# ── Raylib ─────────────────────────────────────────────────────────────
FetchContent_Declare(
    raylib
    GIT_REPOSITORY https://github.com/raysan5/raylib.git
    GIT_TAG        5.0
    GIT_SHALLOW    TRUE
)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_GAMES    OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(raylib)

# Enable JPEG/JPG texture loading (raylib disables it by default).
# Backdrops are .jpg, so without this LoadTexture() silently fails.
target_compile_definitions(raylib PRIVATE SUPPORT_FILEFORMAT_JPG=1)

set(NANOSVG_INCLUDE_DIR ${raylib_SOURCE_DIR}/src/external)

# ── cpr ────────────────────────────────────────────────────────────────
FetchContent_Declare(
    cpr
    GIT_REPOSITORY https://github.com/libcpr/cpr.git
    GIT_TAG        1.10.5
    GIT_SHALLOW    TRUE
)
set(CPR_USE_SYSTEM_CURL OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(cpr)

# ── nlohmann/json ──────────────────────────────────────────────────────
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    TRUE
)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(nlohmann_json)

# ── sqlite3 (bundled — no download needed) ─────────────────────────────
# sqlite3.c and sqlite3.h live in third_party/sqlite3/ in this repo.
# No FetchContent, no network, no hash issues.
add_library(sqlite3 STATIC ${CMAKE_SOURCE_DIR}/third_party/sqlite3/sqlite3.c)
target_include_directories(sqlite3 PUBLIC ${CMAKE_SOURCE_DIR}/third_party/sqlite3)
target_compile_options(sqlite3 PRIVATE
    $<$<C_COMPILER_ID:GNU,Clang>:-w>
    $<$<C_COMPILER_ID:MSVC>:/w>
)

# ── Game executable ────────────────────────────────────────────────────
add_executable(CultivationAFK
    src/main.cpp
    src/paper_doll.cpp
)

target_include_directories(CultivationAFK PRIVATE
    ${NANOSVG_INCLUDE_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

# ── Windows: prevent Win32 header functions clashing with Raylib ───────
if(WIN32)
    target_compile_definitions(CultivationAFK PRIVATE
        NOGDI           # removes GDI DrawText
        NOUSER          # removes USER CloseWindow / ShowCursor
        NOMINMAX        # removes min/max macros
        WIN32_LEAN_AND_MEAN
        VC_EXTRA_LEAN
    )
    # Also patch raylib itself so its own includes don't re-add them
    target_compile_definitions(raylib PRIVATE
        NOGDI NOUSER NOMINMAX WIN32_LEAN_AND_MEAN
    )
endif()

target_link_libraries(CultivationAFK PRIVATE
    raylib
    cpr::cpr
    nlohmann_json::nlohmann_json
    sqlite3
)

if(WIN32)
    target_link_libraries(CultivationAFK PRIVATE winmm)
elseif(APPLE)
    target_link_libraries(CultivationAFK PRIVATE
        "-framework CoreVideo" "-framework IOKit"
        "-framework Cocoa"    "-framework OpenGL")
elseif(UNIX AND NOT ANDROID)
    target_link_libraries(CultivationAFK PRIVATE X11 GL m pthread dl)
endif()

if(ANDROID)
    set_target_properties(CultivationAFK PROPERTIES SUFFIX ".so" PREFIX "lib")
    target_compile_options(CultivationAFK PRIVATE -fPIC)
endif()

add_custom_command(TARGET CultivationAFK POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_SOURCE_DIR}/assets $<TARGET_FILE_DIR:CultivationAFK>/assets
    COMMENT "Copying assets")