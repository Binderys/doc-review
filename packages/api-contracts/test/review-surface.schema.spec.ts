import {
  changeTypeSchema,
  changedFileViewSchema,
  commentResolutionSchema,
  feedbackAnchorSchema,
  filePayloadSchema,
  reviewArtifactCommentSchema,
  reviewArtifactSchema,
  reviewCommentSchema,
  reviewSurfaceResponseSchema,
  roundTransitionSchema,
  sourceDiffLineSchema,
} from "../src/index";

describe("feedbackAnchorSchema", () => {
  it.each([
    {
      scope: "range",
      path: "deliverables/memo.md",
      startLine: 3,
      endLine: 4,
      quote: "Exact mirror lines",
      body: "Clarify this claim.",
    },
    {
      scope: "file",
      path: "deliverables/memo.docx",
      locator: { section: "Recommendation", quote: "Exact nearby text" },
      body: "Tighten this section.",
    },
    {
      scope: "file",
      path: "sources/prospectus.pdf",
      body: "Check the final layout.",
    },
    {
      scope: "line",
      path: "sources/research.html",
      line: 8,
      quote: "<p>Exact source line</p>",
      body: "Fix this source line.",
    },
    { scope: "review", body: "Ready after the named changes." },
  ])("accepts a decision-rich $scope anchor", (anchor) => {
    expect(feedbackAnchorSchema.safeParse(anchor).success).toBe(true);
  });

  it.each([
    {
      scope: "range",
      path: "deliverables/memo.md",
      startLine: 4,
      endLine: 3,
      quote: "backwards",
      body: "No.",
    },
    {
      scope: "file",
      path: "deliverables/memo.docx",
      locator: { page: 2 },
      body: "Page-only locator.",
    },
    {
      scope: "file",
      path: "sources/prospectus.pdf",
      line: 4,
      body: "Rendered line anchor.",
    },
    { scope: "review", path: "memo.md", body: "No path allowed." },
    {
      scope: "review",
      body: "Caller must not assign metadata.",
      id: "caller-id",
      headSha: "caller-sha",
      roundNumber: 99,
      createdAt: "2026-07-13T00:00:00.000Z",
    },
  ])("rejects an unsupported anchor %#", (anchor) => {
    expect(feedbackAnchorSchema.safeParse(anchor).success).toBe(false);
  });
});

// #63/#66 (AC1): the shared rendered-text anchor (a Mirror or the sanitized HTML copy)
// across all three arms it appears in - the request anchor, the returned surface comment,
// and the read-only artifact comment. Every fixture below carries a genuinely distinct
// selector (quote/prefix/suffix/start/end), so no case can pass by borrowing another's
// values.
describe("rendered-text anchor (#63 Mirror, #66 HTML)", () => {
  // Server-owned keys the two comment arms wrap the anchor with. The surface comment
  // also carries `resolved`; the read-only artifact comment never does.
  const artifactKeys = {
    id: "comment-63",
    headSha: "1234567890abcdef",
    roundNumber: 2,
    createdAt: "2026-07-14T00:00:00.000Z",
    carriedForward: false,
    drifted: false,
  };
  const surfaceKeys = { ...artifactKeys, resolved: false };

  const acceptFixtures: [string, Record<string, unknown>][] = [
    [
      "a full selector",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Bandersnatch metric",
        prefix: "The ",
        suffix: " holds firm",
        start: 4,
        end: 23,
        selectorVersion: 1,
        body: "Anchor this claim to the rendered text.",
      },
    ],
    [
      "a selection at the document start (empty prefix, zero start)",
      {
        scope: "rendered",
        format: "md",
        path: "sources/appendix.md",
        quote: "Zylographic Overview heading",
        prefix: "",
        suffix: "\n\nThe body",
        start: 0,
        end: 28,
        selectorVersion: 1,
        body: "Anchor the opening heading.",
      },
    ],
    [
      "an HTML rendered selector on the sanitized copy (#66)",
      {
        scope: "rendered",
        format: "html",
        path: "sources/report.html",
        quote: "Zangwill invariant",
        prefix: "The ",
        suffix: " holds",
        start: 5,
        end: 23,
        selectorVersion: 1,
        body: "Anchor the sanitized HTML sentence.",
      },
    ],
    [
      "a Canonical rendered selector on the rendered docx (#67)",
      {
        scope: "rendered",
        format: "docx",
        path: "deliverables/memo.docx",
        quote: "Bandersnatch metric",
        prefix: "The ",
        suffix: " holds firm",
        start: 27,
        end: 46,
        selectorVersion: 1,
        body: "Anchor the rendered Canonical sentence.",
      },
    ],
  ];

  // Each reject fixture violates exactly one rule and carries its own distinct
  // selector values, so a false result cannot be borrowed from another fixture.
  const rejectFixtures: [string, Record<string, unknown>][] = [
    [
      "a missing path",
      {
        scope: "rendered",
        format: "md",
        quote: "Alpha aardvark",
        prefix: "p1 ",
        suffix: " s1",
        start: 1,
        end: 11,
        selectorVersion: 1,
        body: "No path.",
      },
    ],
    [
      "a missing format",
      {
        scope: "rendered",
        path: "deliverables/memo.md",
        quote: "Alpha aardvark",
        prefix: "p1 ",
        suffix: " s1",
        start: 1,
        end: 11,
        selectorVersion: 1,
        body: "No format.",
      },
    ],
    [
      "an HTML format on a Mirror path (format/path mismatch)",
      {
        scope: "rendered",
        format: "html",
        path: "deliverables/memo.md",
        quote: "Alpha aardvark",
        prefix: "p1 ",
        suffix: " s1",
        start: 1,
        end: 11,
        selectorVersion: 1,
        body: "Mismatched html/md.",
      },
    ],
    [
      "a Mirror format on an HTML path (format/path mismatch)",
      {
        scope: "rendered",
        format: "md",
        path: "sources/report.html",
        quote: "Alpha aardvark",
        prefix: "p1 ",
        suffix: " s1",
        start: 1,
        end: 11,
        selectorVersion: 1,
        body: "Mismatched md/html.",
      },
    ],
    [
      "a Canonical format on a Mirror path (format/path mismatch)",
      {
        scope: "rendered",
        format: "docx",
        path: "deliverables/memo.md",
        quote: "Alpha aardvark",
        prefix: "p1 ",
        suffix: " s1",
        start: 1,
        end: 11,
        selectorVersion: 1,
        body: "Mismatched docx/md.",
      },
    ],
    [
      "a missing quote",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        prefix: "p2 ",
        suffix: " s2",
        start: 12,
        end: 22,
        selectorVersion: 1,
        body: "No quote.",
      },
    ],
    [
      "a missing prefix",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Gamma gecko",
        suffix: " s3",
        start: 23,
        end: 33,
        selectorVersion: 1,
        body: "No prefix.",
      },
    ],
    [
      "a missing suffix",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Delta dingo",
        prefix: "p4 ",
        start: 34,
        end: 44,
        selectorVersion: 1,
        body: "No suffix.",
      },
    ],
    [
      "a missing start",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Epsilon emu",
        prefix: "p5 ",
        suffix: " s5",
        end: 55,
        selectorVersion: 1,
        body: "No start.",
      },
    ],
    [
      "a missing end",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Zeta zebra",
        prefix: "p6 ",
        suffix: " s6",
        start: 56,
        selectorVersion: 1,
        body: "No end.",
      },
    ],
    [
      "a missing selector version",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Eta egret",
        prefix: "p7 ",
        suffix: " s7",
        start: 67,
        end: 77,
        body: "No version.",
      },
    ],
    [
      "a missing body",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Theta thrush",
        prefix: "p8 ",
        suffix: " s8",
        start: 78,
        end: 88,
        selectorVersion: 1,
      },
    ],
    [
      "extra opaque annotation state",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Iota ibis",
        prefix: "p9 ",
        suffix: " s9",
        start: 89,
        end: 99,
        selectorVersion: 1,
        body: "Carries a Recogito target.",
        target: { selector: [{ type: "TextQuoteSelector" }] },
      },
    ],
    [
      "an unsupported selector version",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Kappa kestrel",
        prefix: "p10 ",
        suffix: " s10",
        start: 100,
        end: 110,
        selectorVersion: 2,
        body: "Future version.",
      },
    ],
    [
      "a negative start offset",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Lambda lynx",
        prefix: "p11 ",
        suffix: " s11",
        start: -1,
        end: 111,
        selectorVersion: 1,
        body: "Negative start.",
      },
    ],
    [
      "a non-positive end offset",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Mu marten",
        prefix: "p12 ",
        suffix: " s12",
        start: 0,
        end: 0,
        selectorVersion: 1,
        body: "Zero end.",
      },
    ],
    [
      "a reversed range (end before start)",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "Nu newt",
        prefix: "p13 ",
        suffix: " s13",
        start: 140,
        end: 130,
        selectorVersion: 1,
        body: "Reversed.",
      },
    ],
    [
      "an empty quote",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: "",
        prefix: "p14 ",
        suffix: " s14",
        start: 150,
        end: 160,
        selectorVersion: 1,
        body: "Empty quote.",
      },
    ],
    [
      "a non-Mirror path",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/board-pack.pdf",
        quote: "Xi ox",
        prefix: "p15 ",
        suffix: " s15",
        start: 170,
        end: 180,
        selectorVersion: 1,
        body: "Not a Mirror.",
      },
    ],
  ];

  describe("feedbackAnchorSchema (request anchor)", () => {
    it.each(acceptFixtures)("accepts %s", (_name, anchor) => {
      expect(feedbackAnchorSchema.safeParse(anchor).success).toBe(true);
    });

    it.each(rejectFixtures)("rejects %s", (_name, anchor) => {
      expect(feedbackAnchorSchema.safeParse(anchor).success).toBe(false);
    });
  });

  describe("reviewCommentSchema (returned surface comment)", () => {
    it.each(acceptFixtures)("accepts %s", (_name, anchor) => {
      expect(
        reviewCommentSchema.safeParse({ ...anchor, ...surfaceKeys }).success,
      ).toBe(true);
    });

    it.each(rejectFixtures)("rejects %s", (_name, anchor) => {
      expect(
        reviewCommentSchema.safeParse({ ...anchor, ...surfaceKeys }).success,
      ).toBe(false);
    });
  });

  describe("reviewArtifactCommentSchema (read-only artifact comment)", () => {
    it.each(acceptFixtures)("accepts %s", (_name, anchor) => {
      expect(
        reviewArtifactCommentSchema.safeParse({ ...anchor, ...artifactKeys })
          .success,
      ).toBe(true);
    });

    it.each(rejectFixtures)("rejects %s", (_name, anchor) => {
      expect(
        reviewArtifactCommentSchema.safeParse({ ...anchor, ...artifactKeys })
          .success,
      ).toBe(false);
    });

    it("rejects a rendered artifact comment carrying a resolved field", () => {
      expect(
        reviewArtifactCommentSchema.safeParse({
          ...acceptFixtures[0][1],
          ...artifactKeys,
          resolved: true,
        }).success,
      ).toBe(false);
    });
  });
});

describe("reviewCommentSchema", () => {
  const serverFields = {
    id: "comment-38",
    headSha: "1234567890abcdef",
    roundNumber: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    resolved: false,
    carriedForward: false,
    drifted: false,
  };

  it("accepts a well-formed surface comment carrying its resolved flag", () => {
    expect(
      reviewCommentSchema.safeParse({
        scope: "review",
        body: "A retained review comment.",
        ...serverFields,
      }).success,
    ).toBe(true);
  });

  it("rejects a surface comment missing its resolved flag", () => {
    const { resolved: _resolved, ...withoutResolved } = serverFields;
    expect(
      reviewCommentSchema.safeParse({
        scope: "review",
        body: "Missing the server-set resolved flag.",
        ...withoutResolved,
      }).success,
    ).toBe(false);
  });

  it.each(["carriedForward", "drifted"] as const)(
    "rejects a surface comment missing its %s flag",
    (flag) => {
      const { [flag]: _missing, ...withoutFlag } = serverFields;
      expect(
        reviewCommentSchema.safeParse({
          scope: "review",
          body: "Missing a server-set carry state flag.",
          ...withoutFlag,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    {
      scope: "review",
      path: "deliverables/memo.md",
      body: "A review comment cannot carry a path.",
      ...serverFields,
    },
    {
      scope: "file",
      path: "deliverables/memo.docx",
      body: "A Canonical response cannot omit its locator.",
      ...serverFields,
    },
  ])("rejects a malformed returned comment %#", (comment) => {
    expect(reviewCommentSchema.safeParse(comment).success).toBe(false);
  });
});

describe("roundTransitionSchema (PATCH review/current body)", () => {
  it.each(["finished", "approved"])("accepts status %s", (status) => {
    expect(roundTransitionSchema.safeParse({ status }).success).toBe(true);
  });

  it("rejects status open (never a PATCH target)", () => {
    expect(roundTransitionSchema.safeParse({ status: "open" }).success).toBe(
      false,
    );
  });

  it("rejects a missing status", () => {
    expect(roundTransitionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown status value", () => {
    expect(roundTransitionSchema.safeParse({ status: "banana" }).success).toBe(
      false,
    );
  });

  it("rejects an extra field (strict)", () => {
    expect(
      roundTransitionSchema.safeParse({ status: "finished", approved: true })
        .success,
    ).toBe(false);
  });
});

describe("commentResolutionSchema (PATCH comment body)", () => {
  it("accepts { resolved: true }", () => {
    expect(commentResolutionSchema.safeParse({ resolved: true }).success).toBe(
      true,
    );
  });

  it("rejects { resolved: false } (one-directional resolve)", () => {
    expect(commentResolutionSchema.safeParse({ resolved: false }).success).toBe(
      false,
    );
  });

  it("rejects a missing resolved field", () => {
    expect(commentResolutionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an extra field (strict)", () => {
    expect(
      commentResolutionSchema.safeParse({ resolved: true, reply: "x" }).success,
    ).toBe(false);
  });
});

describe("filePayloadSchema (discriminated union)", () => {
  it("accepts the md arm (word diff + source diff + rendered head)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "md",
        diff: [
          { value: "unchanged " },
          { value: "added", added: true },
          { value: "removed", removed: true },
        ],
        sourceDiff: [
          { oldLine: 1, newLine: 1, text: "# Memo", change: "context" },
          { newLine: 2, text: "new body", change: "added" },
          { oldLine: 2, text: "old body", change: "removed" },
        ],
        renderedHead: "<h1>Memo</h1>",
        reviewText: "Memo\n\nnew body",
      }).success,
    ).toBe(true);
  });

  it("rejects an md arm missing its normalized review-text (#63)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "md",
        diff: [{ value: "Memo" }],
        sourceDiff: [
          { oldLine: 1, newLine: 1, text: "# Memo", change: "context" },
        ],
        renderedHead: "<h1>Memo</h1>",
      }).success,
    ).toBe(false);
  });

  it("accepts the docx arm (rendered head + review text)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "docx",
        renderedHead: "<p>Converted docx</p>",
        reviewText: "Converted docx",
      }).success,
    ).toBe(true);
  });

  it("rejects the docx arm without its review text", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "docx",
        renderedHead: "<p>Converted docx</p>",
      }).success,
    ).toBe(false);
  });

  it("accepts the html arm (raw content + protected comparison URL + source diff + review text)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "html",
        raw: "<html><body>Saved source</body></html>",
        comparisonUrl:
          "/pr/acme/board-review/42/raw?path=sources%2Freport.html&ref=4242424242424242424242424242424242424242",
        sourceDiff: [
          {
            oldLine: 1,
            newLine: 1,
            text: "<html><body>Saved source</body></html>",
            change: "context",
          },
        ],
        reviewText: "Saved source",
      }).success,
    ).toBe(true);
  });

  it("rejects an html arm missing its source diff", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "html",
        raw: "<html/>",
        comparisonUrl:
          "/pr/acme/board-review/42/raw?path=sources%2Freport.html&ref=4242424242424242424242424242424242424242",
        reviewText: "",
      }).success,
    ).toBe(false);
  });

  it("rejects an html arm missing its review text (#66)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "html",
        raw: "<html/>",
        comparisonUrl:
          "/pr/acme/board-review/42/raw?path=sources%2Freport.html&ref=4242424242424242424242424242424242424242",
        sourceDiff: [],
      }).success,
    ).toBe(false);
  });

  it("rejects an html arm missing its protected comparison URL (#78)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "html",
        raw: "<html/>",
        sourceDiff: [],
        reviewText: "",
      }).success,
    ).toBe(false);
  });

  it.each([
    "https://tracker.example/raw.html",
    "//tracker.example/raw.html",
    "/dashboard",
  ])(
    "rejects an HTML comparison destination outside its raw route: %s",
    (url) => {
      expect(
        filePayloadSchema.safeParse({
          format: "html",
          raw: "<html/>",
          comparisonUrl: url,
          sourceDiff: [],
          reviewText: "",
        }).success,
      ).toBe(false);
    },
  );

  it("accepts a null comparison URL when deleted HTML has no exact head (#78)", () => {
    expect(
      changedFileViewSchema.safeParse({
        path: "sources/report.html",
        changeType: "deleted",
        payload: {
          format: "html",
          raw: "",
          comparisonUrl: null,
          sourceDiff: [],
          reviewText: "",
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    { changeType: "modified", comparisonUrl: null },
    {
      changeType: "deleted",
      comparisonUrl:
        "/pr/acme/board-review/42/raw?path=sources%2Freport.html&ref=4242424242424242424242424242424242424242",
    },
  ] as const)(
    "rejects a $changeType HTML file whose comparison URL contradicts head availability (#78)",
    ({ changeType, comparisonUrl }) => {
      expect(
        changedFileViewSchema.safeParse({
          path: "sources/report.html",
          changeType,
          payload: {
            format: "html",
            raw: "",
            comparisonUrl,
            sourceDiff: [],
            reviewText: "",
          },
        }).success,
      ).toBe(false);
    },
  );

  it("accepts the pdf arm (blob url)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "pdf",
        blobUrl: "/pr/acme/board-review/42/files/report.pdf/raw",
      }).success,
    ).toBe(true);
  });

  it("accepts the download arm (default fallback: blob url + filename)", () => {
    expect(
      filePayloadSchema.safeParse({
        format: "download",
        blobUrl: "/pr/acme/board-review/42/files/model.xlsx/raw",
        filename: "model.xlsx",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown format", () => {
    expect(
      filePayloadSchema.safeParse({ format: "xlsx", blobUrl: "/x" }).success,
    ).toBe(false);
  });

  it("rejects an arm missing its discriminated field (md without diff)", () => {
    expect(
      filePayloadSchema.safeParse({ format: "md", renderedHead: "<h1/>" })
        .success,
    ).toBe(false);
  });

  it("rejects a download payload missing its filename", () => {
    expect(
      filePayloadSchema.safeParse({ format: "download", blobUrl: "/x" })
        .success,
    ).toBe(false);
  });
});

describe("sourceDiffLineSchema (two-anchor invariant)", () => {
  it("accepts a context line carrying both base and head line numbers", () => {
    expect(
      sourceDiffLineSchema.safeParse({
        oldLine: 3,
        newLine: 4,
        text: "shared line",
        change: "context",
      }).success,
    ).toBe(true);
  });

  it("accepts an added line carrying only a head line number", () => {
    expect(
      sourceDiffLineSchema.safeParse({
        newLine: 5,
        text: "brand new",
        change: "added",
      }).success,
    ).toBe(true);
  });

  it("accepts a removed line carrying only a base line number", () => {
    expect(
      sourceDiffLineSchema.safeParse({
        oldLine: 2,
        text: "gone",
        change: "removed",
      }).success,
    ).toBe(true);
  });

  it("rejects a removed line that carries a head anchor (newLine)", () => {
    // A removed-only line has no head position, so it can never be a head anchor.
    expect(
      sourceDiffLineSchema.safeParse({
        oldLine: 2,
        newLine: 2,
        text: "gone",
        change: "removed",
      }).success,
    ).toBe(false);
  });

  it("rejects an added line that carries a base anchor (oldLine)", () => {
    expect(
      sourceDiffLineSchema.safeParse({
        oldLine: 2,
        newLine: 2,
        text: "brand new",
        change: "added",
      }).success,
    ).toBe(false);
  });

  it("rejects a context line missing its head anchor (newLine)", () => {
    expect(
      sourceDiffLineSchema.safeParse({
        oldLine: 2,
        text: "shared line",
        change: "context",
      }).success,
    ).toBe(false);
  });

  it("rejects a zero or negative line number", () => {
    expect(
      sourceDiffLineSchema.safeParse({
        newLine: 0,
        text: "brand new",
        change: "added",
      }).success,
    ).toBe(false);
  });
});

describe("changeTypeSchema", () => {
  it("accepts the three review-surface change types", () => {
    for (const changeType of ["added", "modified", "deleted"]) {
      expect(changeTypeSchema.safeParse(changeType).success).toBe(true);
    }
  });

  it("rejects a raw GitHub status that is not one of the three", () => {
    expect(changeTypeSchema.safeParse("renamed").success).toBe(false);
  });
});

describe("reviewSurfaceResponseSchema", () => {
  const validSurface = {
    number: 42,
    title: "Draft Q3 IC memo",
    description: "Ships the canonical docx and its md mirror.",
    sourceBranchUrl:
      "https://github.com/acme/board-review/tree/agent/ic-memo-q3",
    githubUrl: "https://github.com/acme/board-review/pull/42",
    currentRound: {
      number: 1,
      headSha: "d34db33f",
      createdAt: "2026-07-13T00:00:00.000Z",
      status: "open",
      comments: [],
    },
    rounds: [
      {
        number: 1,
        headSha: "d34db33f",
        createdAt: "2026-07-13T00:00:00.000Z",
        status: "open",
        comments: [],
      },
    ],
    files: [
      {
        path: "memo.md",
        changeType: "added",
        payload: {
          format: "download",
          blobUrl: "/pr/acme/board-review/42/files/memo.md/raw",
          filename: "memo.md",
        },
      },
    ],
  };

  it("accepts a full review surface with metadata + files", () => {
    expect(reviewSurfaceResponseSchema.safeParse(validSurface).success).toBe(
      true,
    );
  });

  it("rejects a non-URL githubUrl deep link", () => {
    expect(
      reviewSurfaceResponseSchema.safeParse({
        ...validSurface,
        githubUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });

  it("carries the round status so the reviewer UI can gate its controls", () => {
    expect(
      reviewSurfaceResponseSchema.safeParse({
        ...validSurface,
        currentRound: { ...validSurface.currentRound, status: "banana" },
      }).success,
    ).toBe(false);
  });
});

describe("reviewArtifactSchema (agent-facing, read-only)", () => {
  const artifactComment = {
    scope: "range" as const,
    path: "deliverables/memo.md",
    startLine: 3,
    endLine: 4,
    quote: "Exact mirror lines",
    body: "Clarify this claim.",
    id: "comment-39",
    headSha: "1234567890abcdef",
    roundNumber: 2,
    createdAt: "2026-07-14T00:00:00.000Z",
    carriedForward: true,
    drifted: true,
  };

  const finishedArtifact = {
    pr: "acme/board-review#42",
    headSha: "1234567890abcdef",
    reviewRound: 2,
    approved: false,
    comments: [artifactComment],
  };

  it("accepts a finished artifact carrying its unresolved comments", () => {
    expect(reviewArtifactSchema.safeParse(finishedArtifact).success).toBe(true);
  });

  it("accepts an approved artifact with an empty comment set", () => {
    expect(
      reviewArtifactSchema.safeParse({
        ...finishedArtifact,
        approved: true,
        comments: [],
      }).success,
    ).toBe(true);
  });

  // #63 (AC4/AC5): a rendered-text comment appears in the artifact carrying its
  // selector evidence, but strict, so no planted resolution surface parses.
  const renderedArtifactComment = {
    scope: "rendered" as const,
    format: "md" as const,
    path: "deliverables/memo.md",
    quote: "Bandersnatch metric",
    prefix: "The ",
    suffix: " holds firm",
    start: 4,
    end: 23,
    selectorVersion: 1,
    body: "Clarify this rendered claim.",
    id: "comment-63",
    headSha: "1234567890abcdef",
    roundNumber: 2,
    createdAt: "2026-07-14T00:00:00.000Z",
    carriedForward: false,
    drifted: false,
  };

  it("accepts a rendered-text comment carrying its selector evidence", () => {
    expect(
      reviewArtifactSchema.safeParse({
        ...finishedArtifact,
        comments: [renderedArtifactComment],
      }).success,
    ).toBe(true);
  });

  it("rejects a rendered-text comment carrying a resolved field", () => {
    expect(
      reviewArtifactSchema.safeParse({
        ...finishedArtifact,
        comments: [{ ...renderedArtifactComment, resolved: true }],
      }).success,
    ).toBe(false);
  });

  // AC5: the artifact must be read-only - no field the agent can use to resolve,
  // reply, or approve. Each planted mutation field must fail to parse.
  it("rejects a comment carrying a resolved field (no resolution surface)", () => {
    expect(
      reviewArtifactSchema.safeParse({
        ...finishedArtifact,
        comments: [{ ...artifactComment, resolved: true }],
      }).success,
    ).toBe(false);
  });

  it("rejects a comment carrying a reply field", () => {
    expect(
      reviewArtifactSchema.safeParse({
        ...finishedArtifact,
        comments: [{ ...artifactComment, reply: "Fixed it." }],
      }).success,
    ).toBe(false);
  });

  it("rejects a top-level approve field (no approval surface)", () => {
    expect(
      reviewArtifactSchema.safeParse({ ...finishedArtifact, approve: true })
        .success,
    ).toBe(false);
  });

  it("rejects a non-positive review round number", () => {
    expect(
      reviewArtifactSchema.safeParse({ ...finishedArtifact, reviewRound: 0 })
        .success,
    ).toBe(false);
  });
});
