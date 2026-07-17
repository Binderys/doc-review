import type { ReviewSurfaceResponse } from "@doc-review/api-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SanitizedHtmlSurface } from "../features/annotation/SanitizedHtmlSurface";
import { ReviewSurfaceView } from "./ReviewSurfaceView";

const fixture: ReviewSurfaceResponse = {
  number: 42,
  title: "Draft Q3 IC memo",
  description: "Ships the canonical docx and its md mirror.",
  sourceBranchUrl: "https://github.com/acme/board-review/tree/agent/ic-memo-q3",
  githubUrl: "https://github.com/acme/board-review/pull/42",
  currentRound: {
    number: 1,
    headSha: "1234567890abcdef",
    createdAt: "2026-07-13T00:00:00.000Z",
    status: "open",
    comments: [],
  },
  rounds: [
    {
      number: 1,
      headSha: "1234567890abcdef",
      createdAt: "2026-07-13T00:00:00.000Z",
      status: "open",
      comments: [],
    },
  ],
  files: [
    {
      path: "deliverables/appendix.md",
      changeType: "added",
      payload: {
        format: "download",
        blobUrl: "/pr/acme/board-review/42/raw?path=deliverables%2Fappendix.md",
        filename: "appendix.md",
      },
    },
    {
      path: "deliverables/old-memo.md",
      changeType: "deleted",
      payload: {
        format: "download",
        blobUrl: "/pr/acme/board-review/42/raw?path=deliverables%2Fold-memo.md",
        filename: "old-memo.md",
      },
    },
    {
      path: "data/model.xlsx",
      changeType: "modified",
      payload: {
        format: "download",
        blobUrl: "/pr/acme/board-review/42/raw?path=data%2Fmodel.xlsx",
        filename: "model.xlsx",
      },
    },
  ],
};

describe("ReviewSurfaceView", () => {
  it("defaults to an evidence review with the changed documents kept in response order", () => {
    const html = renderToStaticMarkup(<ReviewSurfaceView {...fixture} />);

    expect(html).toContain('aria-label="Review mode"');
    expect(html).toContain(
      '<button type="button" aria-label="Use evidence review" aria-pressed="true">Evidence</button>',
    );
    expect(html).toContain(
      '<button type="button" aria-label="Use guided review" aria-pressed="false">Guided</button>',
    );
    expect(html).toContain("Changed documents");
    expect(html).toContain("3 documents in this review");
    expect(html).not.toContain("<main");

    const appendix = html.indexOf("deliverables/appendix.md");
    const oldMemo = html.indexOf("deliverables/old-memo.md");
    const model = html.indexOf("data/model.xlsx");
    expect(appendix).toBeGreaterThan(-1);
    expect(oldMemo).toBeGreaterThan(appendix);
    expect(model).toBeGreaterThan(oldMemo);
  });

  it("keeps the agent summary compact instead of reproducing the full PR description", () => {
    const summaryFixture: ReviewSurfaceResponse = {
      ...fixture,
      description: [
        "## Changes",
        "",
        "- Reframed the current position.",
        "- Added customer evidence.",
        "- Connected execution to direction.",
        "- This fourth detail belongs in the full description.",
      ].join("\n"),
    };

    const html = renderToStaticMarkup(
      <ReviewSurfaceView {...summaryFixture} />,
    );

    expect(html).toContain("Reframed the current position.");
    expect(html).toContain("Added customer evidence.");
    expect(html).toContain("Connected execution to direction.");
    expect(html).not.toContain("This fourth detail");
    expect(html).not.toContain("## Changes");
  });

  it("surfaces a headings-only description instead of reporting no change summary", () => {
    const headingsOnlyFixture: ReviewSurfaceResponse = {
      ...fixture,
      description: ["## Overview", "", "### Supporting detail"].join("\n"),
    };

    const html = renderToStaticMarkup(
      <ReviewSurfaceView {...headingsOnlyFixture} />,
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Supporting detail");
    expect(html).not.toContain("## Overview");
    expect(html).not.toContain("### Supporting detail");
    expect(html).not.toContain("The agent did not provide a change summary.");
  });

  it("lists files with change markers, a download fallback link, and the deep link", () => {
    const html = renderToStaticMarkup(<ReviewSurfaceView {...fixture} />);
    const modelHtml = renderToStaticMarkup(
      <ReviewSurfaceView {...fixture} files={fixture.files.slice(2)} />,
    );

    // PR metadata.
    expect(html).toContain("#42");
    expect(html).toContain("Draft Q3 IC memo");
    expect(html).toContain("Ships the canonical docx and its md mirror.");

    // Source-branch link and the open-on-GitHub deep link.
    expect(html).toContain(
      'href="https://github.com/acme/board-review/tree/agent/ic-memo-q3"',
    );
    expect(html).toContain(
      'href="https://github.com/acme/board-review/pull/42"',
    );
    expect(html).toContain("Open on GitHub");

    // Every file listed with its change marker.
    expect(html).toContain("deliverables/appendix.md");
    expect(html).toContain("deliverables/old-memo.md");
    expect(html).toContain("data/model.xlsx");
    expect(html).toContain("Added");
    expect(html).toContain("Deleted");
    expect(html).toContain("Modified");

    // Download fallback links for the not-yet-rendered payloads.
    expect(modelHtml).toContain(
      'href="/pr/acme/board-review/42/raw?path=data%2Fmodel.xlsx"',
    );
    expect(modelHtml).toContain("Download model.xlsx");
  });

  it("renders an md payload as both the word diff and the rendered head", () => {
    const mdFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "deliverables/memo.md",
          changeType: "modified",
          payload: {
            format: "md",
            diff: [
              { value: "The " },
              { value: "flumpetrix", removed: true },
              { value: "quibblesnark", added: true },
              { value: " ships." },
            ],
            sourceDiff: [
              { oldLine: 1, newLine: 1, text: "# Memo", change: "context" },
              { oldLine: 2, text: "The flumpetrix ships.", change: "removed" },
              // Leading whitespace here gates that indentation is preserved.
              {
                newLine: 2,
                text: "  the quibblesnark ships.",
                change: "added",
              },
            ],
            renderedHead:
              "<h1>Memo</h1>\n<p>The <strong>quibblesnark</strong> ships.</p>\n",
            reviewText: "Memo\n\nThe quibblesnark ships.",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(<ReviewSurfaceView {...mdFixture} />);

    // The word diff renders the added and removed words, marked distinctly.
    expect(html).toContain("<del>flumpetrix</del>");
    expect(html).toContain("<ins>quibblesnark</ins>");
    // The rendered head HTML is emitted verbatim (markup and text).
    expect(html).toContain("<h1>Memo</h1>");
    expect(html).toContain("<strong>quibblesnark</strong>");

    // The rendered deliverable is primary; source evidence is available on demand.
    expect(html.indexOf("<h1>Memo</h1>")).toBeLessThan(
      html.indexOf("<summary>View source changes</summary>"),
    );
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("1 line added, 1 removed");
    expect(html).not.toContain("1 lines added");

    // The source diff is a two-sided gutter table (no list bullets), with the three
    // change roles carrying distinct classes.
    expect(html).toContain('<table class="review-file__source-diff">');
    expect(html).not.toContain('<ul class="review-file__source-diff"');
    expect(html).toContain("review-source-line--context");
    expect(html).toContain("review-source-line--added");
    expect(html).toContain("review-source-line--removed");

    // Each side's number cell is filled only when that side exists: context carries
    // both, removed carries base + blank head, added carries blank base + a head
    // anchor control.
    const oldNum =
      'class="review-source-line__num review-source-line__num--old"';
    const newNum =
      'class="review-source-line__num review-source-line__num--new"';
    expect(html).toContain(
      `<td ${oldNum}>1</td><td ${newNum} data-anchorable="true"><button type="button"`,
    ); // context
    expect(html).toContain(
      `<td ${oldNum}>2</td><td ${newNum} data-anchorable="false" aria-label="Removed line has no head anchor"></td>`,
    ); // removed
    expect(html).toContain(
      `<td ${oldNum}></td><td ${newNum} data-anchorable="true"><button type="button"`,
    ); // added

    // The added line's leading whitespace survives to the markup (indentation kept).
    expect(html).toContain(">  the quibblesnark ships.</td>");
  });

  it("exposes head source lines as semantic feedback anchor controls but leaves removed rows inert", () => {
    const sourceFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "deliverables/memo.md",
          changeType: "modified",
          payload: {
            format: "md",
            diff: [],
            sourceDiff: [
              {
                oldLine: 7,
                newLine: 7,
                text: "Context anchor 44\r",
                change: "context",
              },
              {
                oldLine: 8,
                text: "Removed only 44",
                change: "removed",
              },
              {
                newLine: 8,
                text: "Added anchor 44",
                change: "added",
              },
            ],
            renderedHead: "<p>Memo</p>",
            reviewText: "Memo",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(<ReviewSurfaceView {...sourceFixture} />);

    expect(html).toContain(
      '<button type="button" class="review-source-line__anchor" aria-label="Select head line 7 for feedback" aria-pressed="false" data-anchor-line="7" data-anchor-quote="Context anchor 44">7</button>',
    );
    expect(html).toContain(
      '<button type="button" class="review-source-line__anchor" aria-label="Select head line 8 for feedback" aria-pressed="false" data-anchor-line="8" data-anchor-quote="Added anchor 44">8</button>',
    );
    expect(html).toContain(
      '<td class="review-source-line__num review-source-line__num--new" data-anchorable="false" aria-label="Removed line has no head anchor"></td>',
    );
    expect(html).not.toContain('data-anchor-quote="Removed only 44"');
  });

  it("marks empty and degenerate source diffs while containing a very long source line", () => {
    const longLine = `LongLine44-${"x".repeat(512)}`;
    const edgeFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "empty.md",
          changeType: "modified",
          payload: {
            format: "md",
            diff: [],
            sourceDiff: [],
            renderedHead: "",
            reviewText: "",
          },
        },
        {
          path: "context.md",
          changeType: "modified",
          payload: {
            format: "md",
            diff: [],
            sourceDiff: [
              {
                oldLine: 1,
                newLine: 1,
                text: "Only context 44",
                change: "context",
              },
            ],
            renderedHead: "<p>Context</p>",
            reviewText: "Only context 44",
          },
        },
        {
          path: "added.md",
          changeType: "added",
          payload: {
            format: "md",
            diff: [],
            sourceDiff: [
              { newLine: 1, text: "First 44", change: "added" },
              { newLine: 2, text: longLine, change: "added" },
            ],
            renderedHead: "<p>Added</p>",
            reviewText: "Added",
          },
        },
      ],
    };

    const html = edgeFixture.files
      .map((file) =>
        renderToStaticMarkup(
          <ReviewSurfaceView {...edgeFixture} files={[file]} />,
        ),
      )
      .join("");

    expect(html).toContain(
      'class="review-file__source-diff-frame" data-source-empty="true"',
    );
    expect(html).toContain("No source lines to display.");
    expect(html).toContain('data-source-all-context="true"');
    expect(html).toContain('data-source-all-added="true"');
    expect(html).toContain('data-source-single-line="true"');
    expect(html).toContain(longLine);
  });

  it("renders a docx payload as the server-converted head HTML", () => {
    const docxFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "deliverables/memo.docx",
          changeType: "modified",
          payload: {
            format: "docx",
            renderedHead:
              "<p>The <strong>Zphlorbunq42Marker</strong> ships.</p>",
            reviewText: "The Zphlorbunq42Marker ships.",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(<ReviewSurfaceView {...docxFixture} />);

    // The server-converted head HTML is emitted verbatim (markup and text).
    expect(html).toContain("<strong>Zphlorbunq42Marker</strong>");
    expect(html).toContain("The <strong>Zphlorbunq42Marker</strong> ships.");
  });

  it("renders an html payload from its protected route in a scriptless sandboxed iframe", () => {
    const htmlFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "sources/research.html",
          changeType: "modified",
          payload: {
            format: "html",
            raw: "<html><body><script>alert(1)</script>Vrelquorbin88Marker</body></html>",
            comparisonUrl:
              "/pr/acme/reports/42/raw?path=sources%2Fresearch.html&ref=4242424242424242424242424242424242424242",
            sourceDiff: [
              { oldLine: 1, text: "<head></head>", change: "removed" },
              {
                newLine: 1,
                text: "<body>Vrelquorbin88Marker</body>",
                change: "added",
              },
            ],
            reviewText: "Vrelquorbin88Marker",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(<ReviewSurfaceView {...htmlFixture} />);

    // The iframe carries a sandbox attribute, grants no script capability, and loads the
    // raw exact-head response through the server-owned no-egress browsing policy.
    expect(html).toContain("<iframe");
    expect(html).toContain('sandbox=""');
    expect(html).not.toContain("allow-scripts");
    expect(html).toContain(
      'src="http://localhost:3000/pr/acme/reports/42/raw?path=sources%2Fresearch.html&amp;ref=4242424242424242424242424242424242424242"',
    );
    // Server-side there is no DOM for DOMPurify, so the safe copy renders an EXPLICIT
    // unavailable state - not an empty div that would read as a sanitized empty
    // document - and never dangerouslySetInnerHTML's the unsanitized raw (#65).
    expect(html).toContain("data-html-safe-copy");
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain("The safe rendered copy is unavailable");
    expect(html).not.toContain("<script>alert(1)</script>");
    // The numbered source diff renders alongside the sandboxed companion.
    expect(html).toContain("review-file__source-diff");
    expect(html).toContain("Vrelquorbin88Marker");
    expect(html).toContain("review-source-line--added");
    expect(html).toContain(
      'aria-label="Select head line 1 for feedback" aria-pressed="false" data-anchor-line="1" data-anchor-quote="&lt;body&gt;Vrelquorbin88Marker&lt;/body&gt;"',
    );
    expect(html).not.toContain('data-anchor-quote="&lt;head&gt;&lt;/head&gt;"');
  });

  it("renders the sanitized copy unavailable for empty input under SSR, not an empty ready copy", () => {
    // Same empty input the jsdom sibling test renders as an empty READY copy. Under SSR
    // there is no DOM, so it must render the explicit unavailable state and message -
    // proving empty-ready and unavailable are structurally distinguishable, not both a
    // bare empty div.
    const html = renderToStaticMarkup(<SanitizedHtmlSurface raw="" />);

    expect(html).toContain("data-html-safe-copy");
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain("The safe rendered copy is unavailable");
    expect(html).not.toContain('data-state="ready"');
  });

  it("embeds a pdf payload via its blob URL", () => {
    const pdfFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "sources/prospectus.pdf",
          changeType: "modified",
          payload: {
            format: "pdf",
            blobUrl:
              "/pr/acme/board-review/42/raw?path=sources%2Fprospectus.pdf",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(<ReviewSurfaceView {...pdfFixture} />);

    // The embed points at the blob-serving route for the browser's native viewer.
    expect(html).toContain("<embed");
    expect(html).toContain('type="application/pdf"');
    expect(html).toContain(
      'src="/pr/acme/board-review/42/raw?path=sources%2Fprospectus.pdf"',
    );
  });

  it("displays retained rounds and structured feedback without prose scraping", () => {
    const comment = {
      scope: "file" as const,
      path: "deliverables/memo.docx",
      locator: {
        section: "RecommendationOnly38",
        quote: "NearbyQuoteOnly38",
      },
      body: "RetainedBodyOnly38",
      id: "comment-only-38",
      headSha: fixture.currentRound.headSha,
      roundNumber: 1,
      createdAt: "2026-07-13T00:01:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    };
    const feedbackFixture: ReviewSurfaceResponse = {
      ...fixture,
      currentRound: { ...fixture.currentRound, comments: [comment] },
      rounds: [{ ...fixture.rounds[0], comments: [comment] }],
    };

    const html = renderToStaticMarkup(
      <ReviewSurfaceView {...feedbackFixture} />,
    );

    expect(html).toContain("Round 1");
    expect(html).toContain(fixture.currentRound.headSha);
    expect(html).toContain("RecommendationOnly38");
    expect(html).toContain("NearbyQuoteOnly38");
    expect(html).toContain("RetainedBodyOnly38");
  });

  it("identifies the current head while marking carried and drifted feedback in retained history", () => {
    const original = {
      scope: "range" as const,
      path: "deliverables/memo.md",
      startLine: 3,
      endLine: 4,
      quote: "Original exact lines",
      body: "Carry this feedback",
      id: "stable-comment-40",
      headSha: "head-round-1",
      roundNumber: 1,
      createdAt: "2026-07-14T00:00:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    };
    const carried = {
      ...original,
      headSha: "head-round-2",
      roundNumber: 2,
      carriedForward: true,
      drifted: true,
    };
    const multiRoundFixture: ReviewSurfaceResponse = {
      ...fixture,
      currentRound: {
        number: 2,
        headSha: "head-round-2",
        createdAt: "2026-07-14T01:00:00.000Z",
        status: "open",
        comments: [carried],
      },
      rounds: [
        {
          number: 1,
          headSha: "head-round-1",
          createdAt: "2026-07-14T00:00:00.000Z",
          status: "open",
          comments: [original],
        },
        {
          number: 2,
          headSha: "head-round-2",
          createdAt: "2026-07-14T01:00:00.000Z",
          status: "open",
          comments: [carried],
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ReviewSurfaceView {...multiRoundFixture} onResolve={() => {}} />,
    );

    expect(html).toContain("Current round 2 - head-round-2");
    expect(html).toContain("Round 1 - head-round-1");
    expect(html).toContain('data-carried-forward="true"');
    expect(html).toContain('data-drifted="true"');
    expect(html).toContain("Carried forward");
    expect(html).toContain("Original anchor drifted");
    expect(html.match(/data-round-action="resolve"/g)).toHaveLength(1);
  });

  it.each([
    [
      "Mirror",
      {
        path: "deliverables/memo.md",
        changeType: "modified" as const,
        payload: {
          format: "md" as const,
          diff: [],
          sourceDiff: [],
          renderedHead: "<p>Mirror</p>",
          reviewText: "Mirror",
        },
      },
      'data-feedback-scope="range"',
      ['name="startLine"', 'name="endLine"', 'name="quote"'],
    ],
    [
      "Canonical",
      {
        path: "deliverables/memo.docx",
        changeType: "modified" as const,
        payload: {
          format: "docx" as const,
          renderedHead: "<p>Canonical</p>",
          reviewText: "Canonical",
        },
      },
      'data-feedback-scope="canonical"',
      ['name="section"', 'name="locatorQuote"'],
    ],
    [
      "HTML",
      {
        path: "sources/report.html",
        changeType: "modified" as const,
        payload: {
          format: "html" as const,
          raw: "<p>HTML</p>",
          comparisonUrl:
            "/pr/acme/reports/42/raw?path=sources%2Freport.html&ref=4242424242424242424242424242424242424242",
          sourceDiff: [],
          reviewText: "HTML",
        },
      },
      'data-feedback-scope="line"',
      ['name="line"', 'name="quote"'],
    ],
    [
      "PDF",
      {
        path: "deliverables/pack.pdf",
        changeType: "modified" as const,
        payload: { format: "pdf" as const, blobUrl: "/pack.pdf" },
      },
      'data-feedback-scope="file"',
      [],
    ],
  ])(
    "offers only the appropriate %s anchor controls",
    (_format, file, scopeMarker, fieldMarkers) => {
      const html = renderToStaticMarkup(
        <ReviewSurfaceView {...fixture} files={[file]} />,
      );

      expect(html).toContain(scopeMarker);
      for (const fieldMarker of fieldMarkers) {
        expect(html).toContain(fieldMarker);
      }
    },
  );

  it("offers no file-anchor control for the download fallback", () => {
    const html = renderToStaticMarkup(<ReviewSurfaceView {...fixture} />);

    expect(html).not.toContain('data-feedback-path="data/model.xlsx"');
  });

  it("mounts the rendered Mirror annotation surface and its rail beside the source-range form", () => {
    const rendered = {
      scope: "rendered" as const,
      format: "md" as const,
      path: "deliverables/memo.md",
      quote: "Bandersnatch metric holds firm",
      prefix: "The ",
      suffix: " across revisions",
      start: 4,
      end: 34,
      selectorVersion: 1 as const,
      body: "RenderedRailBody64",
      id: "rendered-64",
      headSha: fixture.currentRound.headSha,
      roundNumber: 1,
      createdAt: "2026-07-14T00:00:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    };
    const mdFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "deliverables/memo.md",
          changeType: "modified",
          payload: {
            format: "md",
            diff: [],
            sourceDiff: [],
            renderedHead: "<p>Memo</p>",
            reviewText: "The Bandersnatch metric holds firm across revisions.",
          },
        },
      ],
      currentRound: { ...fixture.currentRound, comments: [rendered] },
      rounds: [{ ...fixture.rounds[0], comments: [rendered] }],
    };

    const html = renderToStaticMarkup(<ReviewSurfaceView {...mdFixture} />);

    // The selectable annotation layer and its Word-style rail card render.
    expect(html).toContain("data-annotation-surface");
    expect(html).toContain(
      "Select text below to comment on the rendered Mirror.",
    );
    expect(html).toContain('data-annotation-comment-id="rendered-64"');
    expect(html).toContain("RenderedRailBody64");
    // The existing Mirror source-range feedback form still coexists (issue #64 AC7).
    expect(html).toContain('data-feedback-scope="range"');
  });

  it("mounts the rendered Canonical annotation surface and its rail beside the section-and-quote locator (issue #67 AC7)", () => {
    const rendered = {
      scope: "rendered" as const,
      format: "docx" as const,
      path: "deliverables/memo.docx",
      quote: "The Bandersnatch metric holds firm across revisions.",
      prefix: "Zephyr canonical overview.\n",
      suffix: "\nAlpha canonical cell.",
      start: 27,
      end: 79,
      selectorVersion: 1 as const,
      body: "RenderedCanonicalBody67",
      id: "rendered-67",
      headSha: fixture.currentRound.headSha,
      roundNumber: 1,
      createdAt: "2026-07-15T00:00:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    };
    const docxFixture: ReviewSurfaceResponse = {
      ...fixture,
      files: [
        {
          path: "deliverables/memo.docx",
          changeType: "modified",
          payload: {
            format: "docx",
            renderedHead:
              "<h1>Zephyr canonical overview.</h1>" +
              "<p>The Bandersnatch metric holds firm across revisions.</p>",
            reviewText:
              "Zephyr canonical overview.\n" +
              "The Bandersnatch metric holds firm across revisions.",
          },
        },
      ],
      currentRound: { ...fixture.currentRound, comments: [rendered] },
      rounds: [{ ...fixture.rounds[0], comments: [rendered] }],
    };

    const html = renderToStaticMarkup(<ReviewSurfaceView {...docxFixture} />);

    // The selectable annotation layer and its Word-style rail card render.
    expect(html).toContain("data-annotation-surface");
    expect(html).toContain(
      "Select text below to comment on the rendered Canonical.",
    );
    expect(html).toContain('data-annotation-comment-id="rendered-67"');
    expect(html).toContain("RenderedCanonicalBody67");
    // The existing source-oriented section-and-quote locator still coexists as the
    // secondary affordance (issue #67 AC7).
    expect(html).toContain('data-feedback-scope="canonical"');
    expect(html).toContain('name="section"');
    expect(html).toContain('name="locatorQuote"');
  });

  const roundComment = (resolved: boolean) => ({
    scope: "review" as const,
    body: "RoundControlBody39",
    id: "comment-39",
    headSha: fixture.currentRound.headSha,
    roundNumber: 1,
    createdAt: "2026-07-14T00:00:00.000Z",
    resolved,
    carriedForward: false,
    drifted: false,
  });

  const withRound = (
    status: "open" | "finished" | "approved",
    comments: ReturnType<typeof roundComment>[],
  ): ReviewSurfaceResponse => ({
    ...fixture,
    currentRound: { ...fixture.currentRound, status, comments },
    rounds: [{ ...fixture.rounds[0], status, comments }],
  });

  it("offers Finish and per-comment Resolve but not Approve on an open round with unresolved feedback", () => {
    const html = renderToStaticMarkup(
      <ReviewSurfaceView
        {...withRound("open", [roundComment(false)])}
        onResolve={() => {}}
      />,
    );

    expect(html).toContain('data-round-status="open"');
    expect(html).toContain('data-round-action="finish"');
    expect(html).toContain('data-round-action="resolve"');
    expect(html).toContain('data-comment-id="comment-39"');
    expect(html).not.toContain('data-round-action="approve"');
  });

  it("offers Approve on an open round with zero unresolved feedback", () => {
    const html = renderToStaticMarkup(
      <ReviewSurfaceView {...withRound("open", [])} />,
    );

    expect(html).toContain('data-round-action="finish"');
    expect(html).toContain('data-round-action="approve"');
    expect(html).not.toContain('data-round-action="resolve"');
  });

  it("shows a finished round frozen with no transition controls", () => {
    const html = renderToStaticMarkup(
      <ReviewSurfaceView
        {...withRound("finished", [roundComment(false)])}
        onResolve={() => {}}
      />,
    );

    expect(html).toContain('data-round-status="finished"');
    expect(html).not.toContain('data-round-action="finish"');
    expect(html).not.toContain('data-round-action="resolve"');
    expect(html).not.toContain('data-round-action="approve"');
  });

  it("shows an approved round as terminal with no controls", () => {
    const html = renderToStaticMarkup(
      <ReviewSurfaceView {...withRound("approved", [roundComment(true)])} />,
    );

    expect(html).toContain('data-round-status="approved"');
    expect(html).not.toContain('data-round-action="finish"');
    expect(html).not.toContain('data-round-action="resolve"');
    expect(html).not.toContain('data-round-action="approve"');
  });
});
