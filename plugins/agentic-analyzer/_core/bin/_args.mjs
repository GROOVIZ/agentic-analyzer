// Tiny shared CLI argument parser. Every bin/*.mjs accepts `--key=value`
// and bare `--flag` (boolean true). Some also collect positional args.
//
// Returns { flags, positional }. Callers that don't use positional args can
// just destructure `flags`.
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) flags[a.slice(2)] = true;
      else flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
