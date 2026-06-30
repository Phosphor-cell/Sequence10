// device_id.hpp — stable per-install identity for the player.
// Generates a UUID once, persists it to a local file, reuses it forever so the
// player returns as themselves (no accounts needed). Sent to /api/player init.
//
// Stored next to the executable in a small text file. If the file can't be
// written (read-only dir), we still return a session id so the game works.
#pragma once
#include <string>
#include <fstream>
#include <random>
#include <sstream>
#include <cstdint>

namespace device {

inline std::string generateUuidV4() {
    std::random_device rd;
    std::mt19937_64 gen(rd() ^ (uint64_t)std::random_device{}());
    std::uniform_int_distribution<uint32_t> dist(0, 0xFFFFFFFF);
    uint32_t a = dist(gen), b = dist(gen), c = dist(gen), d = dist(gen);
    // set version (4) and variant bits
    b = (b & 0xFFFF0FFF) | 0x00004000;
    c = (c & 0x3FFFFFFF) | 0x80000000;
    char buf[37];
    std::snprintf(buf, sizeof(buf), "%08x-%04x-%04x-%04x-%04x%08x",
        a, (b >> 16) & 0xFFFF, b & 0xFFFF, (c >> 16) & 0xFFFF, c & 0xFFFF, d);
    return std::string(buf);
}

// Returns a stable device id, creating+persisting one on first run.
inline std::string getOrCreate(const std::string& path = "device_id.txt") {
    // try to read existing
    {
        std::ifstream in(path);
        if (in) {
            std::string id;
            std::getline(in, id);
            // trim whitespace
            while (!id.empty() && (id.back()=='\n'||id.back()=='\r'||id.back()==' ')) id.pop_back();
            if (id.size() >= 8) return id;
        }
    }
    // create new
    std::string id = generateUuidV4();
    std::ofstream out(path);
    if (out) { out << id << "\n"; }
    // if write failed, still return the id for this session
    return id;
}

} // namespace device
