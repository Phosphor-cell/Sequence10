// api/_format.ts  (HELPER — underscore = not an endpoint)
//
// Big-number formatting for display. uint64 values like 18446744073709551615
// are unreadable; players want "18.4Qi". Pure functions, BigInt-safe.
//
// Suffix ladder covers uint64 comfortably and extends well past it:
//   K  thousand     M  million      B  billion     T  trillion
//   Qa quadrillion  Qi quintillion  Sx sextillion  Sp septillion
//   Oc octillion    No nonillion    Dc decillion   ...
//
// formatBig("18446744073709551615") -> "18.45Qi"
// formatBig("1500")                  -> "1.50K"
// formatBig("950")                   -> "950"

const SUFFIXES = [
  "", "K", "M", "B", "T",
  "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc",
  "UDc", "DDc", "TDc", "QaDc", "QiDc", "SxDc", "SpDc", "OcDc", "NoDc", "Vg",
];

export function formatBig(value: bigint | string | number, decimals = 2): string {
  let v: bigint;
  try { v = typeof value === "bigint" ? value : BigInt(String(value).split(".")[0]); }
  catch { return String(value); }

  const neg = v < 0n;
  if (neg) v = -v;
  if (v < 1000n) return (neg ? "-" : "") + v.toString();

  // find the largest suffix tier that fits
  let tier = 0;
  let divisor = 1n;
  while (v >= divisor * 1000n && tier < SUFFIXES.length - 1) {
    divisor *= 1000n;
    tier++;
  }

  // value / divisor with `decimals` fractional digits, done in integer space
  const scale = 10n ** BigInt(decimals);
  const scaled = (v * scale) / divisor;       // e.g. 1845 for 1.845K at decimals=2 -> wait, handle below
  const whole = scaled / scale;
  const frac = scaled % scale;
  const fracStr = decimals > 0 ? "." + frac.toString().padStart(decimals, "0") : "";
  return (neg ? "-" : "") + whole.toString() + fracStr + SUFFIXES[tier];
}

// Compact form without trailing-zero decimals: "1.5K" not "1.50K", "950" stays.
export function formatBigCompact(value: bigint | string | number): string {
  const s = formatBig(value, 2);
  // Only trim trailing zeros that follow a decimal point; never touch plain
  // integers (so "950" stays "950", not "95").
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d*?)0+([A-Za-z]*)$/, "$1$2").replace(/\.([A-Za-z]*)$/, "$1");
}
