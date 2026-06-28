cmake_minimum_required(VERSION 3.20)
project(CultivationAFK)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Option: let CMake fetch everything automatically ───────────────────
# Set FETCHCONTENT_FULLY_DISCONNECTED=ON to disable once deps are cached.
include(FetchContent)

# ── Raylib (includes nanosvg.h + nanosvgrast.h in its source tree) ─────
FetchContent_Declare(
    raylib
    GIT_REPOSITORY https://github.com/raysan5/raylib.git
    GIT_TAG        5.0
    GIT_SHALLOW    TRUE
)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_GAMES    OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(raylib)

# nanosvg lives inside the raylib source tree — expose it as an include path
set(NANOSVG_INCLUDE_DIR ${raylib_SOURCE_DIR}/src/external)

# ── cpr (HTTP client — wraps libcurl) ──────────────────────────────────
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

# ── sqlite3 (single-file amalgamation — no external package needed) ────
FetchContent_Declare(
    sqlite3_src
    URL      https://www.sqlite.org/2024/sqlite-amalgamation-3450200.zip
    URL_HASH SHA256=71d8f1f42e628a0a1e2e8be57b6a2b98498dca1e7ae1e3fcd2e72b9c5dc6e2bf
)
FetchContent_MakeAvailable(sqlite3_src)

add_library(sqlite3 STATIC
    ${sqlite3_src_SOURCE_DIR}/sqlite3.c
)
target_include_directories(sqlite3 PUBLIC
    ${sqlite3_src_SOURCE_DIR}
)
# Suppress sqlite3's internal warnings so they don't pollute our build log
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
    ${NANOSVG_INCLUDE_DIR}   # nanosvg.h, nanosvgrast.h — auto-fetched with raylib
    ${CMAKE_SOURCE_DIR}/src
)

target_link_libraries(CultivationAFK PRIVATE
    raylib
    cpr::cpr
    nlohmann_json::nlohmann_json
    sqlite3
)

# ── Platform extras ────────────────────────────────────────────────────
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

# ── Copy assets next to the exe ───────────────────────────────────────
add_custom_command(TARGET CultivationAFK POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_SOURCE_DIR}/assets $<TARGET_FILE_DIR:CultivationAFK>/assets
    COMMENT "Copying assets")