import type { ReviewSurfaceResponse } from "@doc-review/api-contracts";

// Deterministic shell fixture for the editorial-shell prototype. It is a plain,
// contract-typed `ReviewSurfaceResponse` so the throwaway shell renders real review
// density (a Mirror, a Canonical, an HTML document, a live lifecycle) without a
// backend, an API call, or any wall-clock input. Nothing here is fetched; the shell
// is a pure design study of the chrome around the authored documents.

const ROUND_ONE_HEAD = "9f1c7ad42be80d3e6a15c0b47f9e21d8ac3b6e40";
const ROUND_TWO_HEAD = "3d8a41f0c9e75b26ad1e4f83b0c62d7e19a4f5b1";

export const shellFixture: ReviewSurfaceResponse = {
  number: 33,
  title: "Refound the client onboarding brief and its Korean mirror",
  description: [
    "# What changed",
    "- Rewrote the onboarding brief lead so the promise reads in one breath",
    "- Split the pricing table out of the prose and into the canonical deliverable",
    "- Re-synced the Korean mirror against the English source of truth",
  ].join("\n"),
  sourceBranchUrl: "https://github.com/Binderys/doc-review/tree/brief-refound",
  githubUrl: "https://github.com/Binderys/doc-review/pull/33",
  files: [
    {
      path: "briefs/onboarding.md",
      changeType: "modified",
      payload: {
        format: "md",
        renderedHead: [
          "<h2>Onboarding, bound</h2>",
          "<p>Loose context is where good work goes to die. The brief exists to bind",
          "it: one page the client and the studio both sign, so the shape of the",
          "work is settled before the first draft.</p>",
          "<h3>What the client owes us</h3>",
          "<ul><li>The single sentence that describes done.</li>",
          "<li>Two references they wish they had written.</li>",
          "<li>The one constraint that is not negotiable.</li></ul>",
          "<p>Everything else, we can discover together.</p>",
        ].join("\n"),
        reviewText:
          "Onboarding, bound\nLoose context is where good work goes to die. The brief exists to bind it: one page the client and the studio both sign, so the shape of the work is settled before the first draft.\nWhat the client owes us\nThe single sentence that describes done.\nTwo references they wish they had written.\nThe one constraint that is not negotiable.\nEverything else, we can discover together.",
        diff: [
          { value: "Loose context " },
          { value: "is where good work goes to die", added: true },
          { value: "leaks", removed: true },
          { value: ". The brief exists to bind it." },
        ],
        sourceDiff: [
          {
            change: "context",
            oldLine: 1,
            newLine: 1,
            text: "# Onboarding, bound",
          },
          { change: "context", oldLine: 2, newLine: 2, text: "" },
          {
            change: "removed",
            oldLine: 3,
            text: "Loose context leaks. The brief exists to bind it.",
          },
          {
            change: "added",
            newLine: 3,
            text: "Loose context is where good work goes to die. The brief exists to",
          },
          {
            change: "added",
            newLine: 4,
            text: "bind it: one page the client and the studio both sign.",
          },
          {
            change: "context",
            oldLine: 4,
            newLine: 5,
            text: "",
          },
          {
            change: "context",
            oldLine: 5,
            newLine: 6,
            text: "## What the client owes us",
          },
        ],
      },
    },
    {
      path: "deliverables/onboarding.docx",
      changeType: "added",
      payload: {
        format: "docx",
        renderedHead: [
          "<h1>Studio onboarding</h1>",
          "<p>This is the deliverable actually sent to the client: the canonical",
          "record of the engagement, generated from the mirror and never hand-edited.</p>",
          "<h2>Fees</h2>",
          "<p>A single fixed fee, invoiced on the bound brief and again on delivery.</p>",
        ].join("\n"),
        reviewText:
          "Studio onboarding\nThis is the deliverable actually sent to the client: the canonical record of the engagement, generated from the mirror and never hand-edited.\nFees\nA single fixed fee, invoiced on the bound brief and again on delivery.",
      },
    },
    {
      path: "briefs/onboarding.ko.html",
      changeType: "modified",
      payload: {
        format: "html",
        raw: [
          "<h2>온보딩, 제본하다</h2>",
          "<p>느슨한 맥락은 좋은 작업이 사라지는 곳입니다. 브리프는 그것을 제본합니다.</p>",
        ].join("\n"),
        comparisonUrl: null,
        reviewText:
          "온보딩, 제본하다\n느슨한 맥락은 좋은 작업이 사라지는 곳입니다. 브리프는 그것을 제본합니다.",
        sourceDiff: [
          {
            change: "context",
            oldLine: 1,
            newLine: 1,
            text: "<h2>온보딩, 제본하다</h2>",
          },
          {
            change: "removed",
            oldLine: 2,
            text: "<p>느슨한 맥락은 샙니다.</p>",
          },
          {
            change: "added",
            newLine: 2,
            text: "<p>느슨한 맥락은 좋은 작업이 사라지는 곳입니다. 브리프는 그것을 제본합니다.</p>",
          },
        ],
      },
    },
  ],
  currentRound: {
    number: 2,
    headSha: ROUND_TWO_HEAD,
    createdAt: "2026-07-18T09:12:00.000Z",
    status: "open",
    comments: [
      {
        scope: "range",
        path: "briefs/onboarding.md",
        startLine: 3,
        endLine: 4,
        quote:
          "Loose context is where good work goes to die. The brief exists to bind it.",
        body: "Strong. Keep this as the lead; it carries the whole page.",
        id: "cmt-201",
        headSha: ROUND_TWO_HEAD,
        roundNumber: 2,
        createdAt: "2026-07-18T09:20:00.000Z",
        carriedForward: true,
        drifted: false,
        resolved: true,
      },
      {
        scope: "line",
        path: "briefs/onboarding.ko.html",
        line: 2,
        quote: "느슨한 맥락은 좋은 작업이 사라지는 곳입니다.",
        body: "The mirror drifted from the English source. Re-verify against the current head before approving.",
        id: "cmt-202",
        headSha: ROUND_TWO_HEAD,
        roundNumber: 2,
        createdAt: "2026-07-18T09:24:00.000Z",
        carriedForward: false,
        drifted: true,
        resolved: false,
      },
    ],
  },
  rounds: [
    {
      number: 1,
      headSha: ROUND_ONE_HEAD,
      createdAt: "2026-07-17T16:40:00.000Z",
      status: "finished",
      comments: [
        {
          scope: "review",
          body: "First pass: the pricing belongs in the canonical, not the prose. Split it.",
          id: "cmt-101",
          headSha: ROUND_ONE_HEAD,
          roundNumber: 1,
          createdAt: "2026-07-17T16:55:00.000Z",
          carriedForward: false,
          drifted: false,
          resolved: true,
        },
      ],
    },
    {
      number: 2,
      headSha: ROUND_TWO_HEAD,
      createdAt: "2026-07-18T09:12:00.000Z",
      status: "open",
      comments: [
        {
          scope: "range",
          path: "briefs/onboarding.md",
          startLine: 3,
          endLine: 4,
          quote:
            "Loose context is where good work goes to die. The brief exists to bind it.",
          body: "Strong. Keep this as the lead; it carries the whole page.",
          id: "cmt-201",
          headSha: ROUND_TWO_HEAD,
          roundNumber: 2,
          createdAt: "2026-07-18T09:20:00.000Z",
          carriedForward: true,
          drifted: false,
          resolved: true,
        },
        {
          scope: "line",
          path: "briefs/onboarding.ko.html",
          line: 2,
          quote: "느슨한 맥락은 좋은 작업이 사라지는 곳입니다.",
          body: "The mirror drifted from the English source. Re-verify against the current head before approving.",
          id: "cmt-202",
          headSha: ROUND_TWO_HEAD,
          roundNumber: 2,
          createdAt: "2026-07-18T09:24:00.000Z",
          carriedForward: false,
          drifted: true,
          resolved: false,
        },
      ],
    },
  ],
};
