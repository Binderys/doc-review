import type { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ReviewStateStore } from "./review-state.store";

// Backward compatibility of the persisted review-state schema: readState parses the WHOLE
// file, so one un-migratable comment must never poison every review. The #66 slice adds a
// `format` field to the rendered anchor; state written before it (all #63-era Mirror
// anchors, no `format`) must still load, exactly as `resolved`/`carriedForward`/`drifted`/
// `status` defaults kept pre-#39/#40 state readable.
describe("ReviewStateStore persisted-schema compatibility", () => {
  const statePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      statePaths.splice(0).map((path) => rm(path, { force: true })),
    );
  });

  const storeAt = async (state: unknown): Promise<ReviewStateStore> => {
    const statePath = join(
      tmpdir(),
      `doc-review-store-${process.pid}-${randomUUID()}.json`,
    );
    statePaths.push(statePath);
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(state), "utf8");
    const config = {
      get: () => statePath,
    } as unknown as ConfigService;
    return new ReviewStateStore(config);
  };

  it("loads a pre-#66 rendered anchor with no format field, defaulting it to md, without poisoning sibling reviews", async () => {
    // A rendered comment persisted before #66: the anchor has no `format` field (all such
    // anchors were Mirrors). A sibling review carries an ordinary source-range comment.
    const preSixtySix = {
      reviews: {
        "acme/repo#1": [
          {
            number: 1,
            headSha: "head-old",
            createdAt: "2026-07-15T00:00:00.000Z",
            status: "open",
            comments: [
              {
                id: "legacy-rendered",
                headSha: "head-old",
                roundNumber: 1,
                createdAt: "2026-07-15T00:00:00.000Z",
                resolved: false,
                carriedForward: false,
                drifted: false,
                anchor: {
                  scope: "rendered",
                  path: "deliverables/memo.md",
                  quote: "Legacy rendered quote",
                  prefix: "The ",
                  suffix: " holds",
                  start: 4,
                  end: 25,
                  selectorVersion: 1,
                  body: "Pre-#66 rendered feedback.",
                },
              },
            ],
          },
        ],
        "acme/repo#2": [
          {
            number: 1,
            headSha: "head-sibling",
            createdAt: "2026-07-15T00:00:00.000Z",
            status: "open",
            comments: [
              {
                id: "sibling-review",
                headSha: "head-sibling",
                roundNumber: 1,
                createdAt: "2026-07-15T00:00:00.000Z",
                resolved: false,
                carriedForward: false,
                drifted: false,
                anchor: { scope: "review", body: "Whole-review feedback." },
              },
            ],
          },
        ],
      },
    };

    const store = await storeAt(preSixtySix);

    // The pre-#66 rendered anchor loads, and its format is defaulted to md.
    const loaded = await store.getCurrentRound("acme/repo#1", "head-old");
    const anchor = loaded?.currentRound.comments[0]?.anchor;
    expect(anchor).toMatchObject({
      scope: "rendered",
      format: "md",
      path: "deliverables/memo.md",
      quote: "Legacy rendered quote",
    });

    // The unrelated review in the SAME file survives - the legacy anchor did not poison
    // the whole parse.
    const sibling = await store.getCurrentRound("acme/repo#2", "head-sibling");
    expect(sibling?.currentRound.comments[0]?.id).toBe("sibling-review");
  });
});
