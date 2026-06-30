// format.hpp — big-number display formatting, mirrors server/api/_format.ts.
// uint64 values like 18446744073709551615 render as "18.44Qi".
// Header-only, no dependencies beyond <cstdint>/<string>.
#pragma once
#include <cstdint>
#include <string>
#include <array>
#include <cstdio>

namespace fmtnum {

inline std::string formatBig(uint64_t v, int decimals = 2) {
    static const std::array<const char*, 12> SUF = {
        "", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"
    };
    if (v < 1000ULL) return std::to_string(v);

    int tier = 0;
    uint64_t divisor = 1ULL;
    // advance while v >= divisor*1000 and the multiply won't overflow uint64
    while (tier < (int)SUF.size() - 1) {
        // guard against divisor*1000 overflowing uint64
        if (divisor > (UINT64_MAX / 1000ULL)) break;
        uint64_t next = divisor * 1000ULL;
        if (v < next) break;
        divisor = next;
        tier++;
    }

    // integer-space scaling for `decimals` fractional digits.
    // Overflow-safe when divisor is large (~10^18): use 128-bit if available,
    // else reduce divisor so rem*scale can't overflow uint64.
    uint64_t scale = 1;
    for (int i = 0; i < decimals; ++i) scale *= 10;
    uint64_t whole = v / divisor;
    uint64_t rem   = v % divisor;
#if defined(__SIZEOF_INT128__)
    uint64_t frac = (uint64_t)(((__uint128_t)rem * scale) / divisor);
#else
    uint64_t d = divisor, r = rem;
    while (d > (UINT64_MAX / (scale ? scale : 1))) { d /= 10; r /= 10; }
    uint64_t frac = d ? (r * scale) / d : 0;
#endif

    char buf[64];
    if (decimals > 0) {
        char fracbuf[16];
        std::snprintf(fracbuf, sizeof(fracbuf), "%0*llu", decimals, (unsigned long long)frac);
        std::snprintf(buf, sizeof(buf), "%llu.%s%s",
                      (unsigned long long)whole, fracbuf, SUF[tier]);
    } else {
        std::snprintf(buf, sizeof(buf), "%llu%s", (unsigned long long)whole, SUF[tier]);
    }
    return std::string(buf);
}

// Trim trailing-zero decimals: 1.50K -> 1.5K, 950 -> 950.
inline std::string formatBigCompact(uint64_t v) {
    std::string s = formatBig(v, 2);
    auto dot = s.find('.');
    if (dot == std::string::npos) return s;
    // find end of digits after the dot
    size_t i = dot + 1;
    while (i < s.size() && s[i] >= '0' && s[i] <= '9') ++i;
    // i now points to first suffix char (or end)
    std::string digits = s.substr(dot + 1, i - (dot + 1));
    std::string suffix = s.substr(i);
    // strip trailing zeros from digits
    while (!digits.empty() && digits.back() == '0') digits.pop_back();
    std::string out = s.substr(0, dot);
    if (!digits.empty()) out += "." + digits;
    out += suffix;
    return out;
}

} // namespace fmtnum
