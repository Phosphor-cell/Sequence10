cmake_minimum_required(VERSION 3.20)
project(InfiniteAFKRPG)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Platform-specific settings
if(WIN32)
  set(CMAKE_GENERATOR "Visual Studio 16 2019")
elseif(ANDROID)
  set(CMAKE_SYSTEM_NAME Android)
  set(CMAKE_SYSTEM_VERSION 24)
  set(CMAKE_ANDROID_ARCH_ABI arm64-v8a)
  set(CMAKE_ANDROID_NDK_TOOLCHAIN_VERSION clang)
endif()

# Dependencies
find_package(raylib REQUIRED)
find_package(cpr REQUIRED)
find_package(nlohmann_json REQUIRED)

# Source files
add_executable(InfiniteAFKRPG
  src/main.cpp
)

# Link libraries
target_link_libraries(InfiniteAFKRPG
  raylib
  cpr::cpr
  nlohmann_json::nlohmann_json
)

# Include directories
target_include_directories(InfiniteAFKRPG PRIVATE
  ${CMAKE_SOURCE_DIR}/include
)

# Platform-specific linker flags
if(WIN32)
  target_link_libraries(InfiniteAFKRPG winmm)
elseif(APPLE)
  target_link_libraries(InfiniteAFKRPG "-framework CoreVideo" "-framework IOKit" "-framework Cocoa" "-framework GLVND")
elseif(UNIX AND NOT ANDROID)
  target_link_libraries(InfiniteAFKRPG X11 GL m pthread)
endif()

# Android-specific
if(ANDROID)
  set_target_properties(InfiniteAFKRPG PROPERTIES
    SUFFIX ".so"
    PREFIX "lib"
  )
  target_compile_options(InfiniteAFKRPG PRIVATE -fPIC)
endif()

# Post-build copy of assets
add_custom_command(TARGET InfiniteAFKRPG POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
  ${CMAKE_SOURCE_DIR}/assets
  $<TARGET_FILE_DIR:InfiniteAFKRPG>/assets
  COMMENT "Copying assets..."
)