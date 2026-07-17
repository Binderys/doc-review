import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Criterion 5 (#70): the throwaway Recogito prototype's development-only surfaces must
// stay absent from the production review path. This is the machine-runnable repository
// search the gate names: it walks the client source and fails if any prototype-only
// sentinel is reintroduced - the development annotation query gate, the annotation
// variant switcher, the state inspector, the insertion control, the prototype notes, or
// any Recogito Studio (external annotation service) reference.
//
// Matching is separator-insensitive: source is normalized to lowercase alphanumerics
// before the search, so a query string (`prototype=annotations`), a camelCase identifier
// (`variantSwitcher`), and a kebab attribute (`state-inspector`) all trip the same
// sentinel. The sentinels are chosen to be specific - none collides with legitimate code
// such as `HTMLTextAreaElement.prototype` or `data-annotation-surface`.

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = join(HERE, "..");

// Skip guard files themselves: they necessarily quote the sentinels they forbid.
const isGuard = (name: string): boolean =>
  name.endsWith(".guard.test.ts") || name.endsWith(".guard.test.tsx");

const isSource = (name: string): boolean =>
  name.endsWith(".ts") || name.endsWith(".tsx");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (isSource(entry.name) && !isGuard(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const normalize = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]/g, "");

// Each sentinel's normalized needle plus the prototype-only surface it would betray.
const SENTINELS: { needle: string; surface: string }[] = [
  {
    needle: "prototypeannotations",
    surface: "development annotation query gate",
  },
  { needle: "variantswitcher", surface: "annotation variant switcher" },
  { needle: "stateinspector", surface: "annotation state inspector" },
  { needle: "insertioncontrol", surface: "annotation insertion control" },
  { needle: "prototypenotes", surface: "prototype notes" },
  { needle: "recogitostudio", surface: "external Recogito Studio service" },
];

describe("production review path prototype sentinels", () => {
  it("finds no prototype-only annotation surface anywhere in the client source", () => {
    const files = sourceFiles(CLIENT_SRC);
    // Guard the guard: prove the walk actually scanned real source (a broken walk that
    // found nothing would otherwise pass vacuously).
    expect(files.length).toBeGreaterThan(10);

    const hits: string[] = [];
    for (const file of files) {
      const haystack = normalize(readFileSync(file, "utf8"));
      for (const { needle, surface } of SENTINELS) {
        if (haystack.includes(needle)) {
          hits.push(`${surface} sentinel "${needle}" in ${file}`);
        }
      }
    }

    expect(hits, hits.join("\n")).toEqual([]);
  });
});
