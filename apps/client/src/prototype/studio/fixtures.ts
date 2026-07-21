// Deterministic, self-contained fixtures for the studio prototype. Nothing is fetched;
// these are plain shapes (not the API contract) so the throwaway UI has the freedom to
// show real review density - watched repos under two GitHub resource owners, document
// PRs in several formats, review rounds and drifted feedback - without a backend or any
// wall-clock input. Ages are expressed as fixed strings so the prototype is stable.

export type DocFormat = "md" | "docx" | "html" | "pdf";

export type ReviewState =
  | "awaiting" // no round opened yet
  | "in-review" // a round is open
  | "changes" // feedback left, changes requested
  | "approved"; // approved this round

export interface DocFile {
  path: string;
  format: DocFormat;
  changeType: "added" | "modified" | "removed";
  /** rendered HTML for the reading pane (the constant across the app) */
  html: string;
  /** inline word diff for the change ribbon; null when added/removed wholesale */
  diff?: { value: string; added?: boolean; removed?: boolean }[] | null;
}

export interface FeedbackNote {
  id: string;
  path: string;
  quote: string;
  body: string;
  author: string;
  when: string;
  drifted?: boolean;
  resolved?: boolean;
}

export interface DocPr {
  number: number;
  title: string;
  branch: string;
  author: string;
  age: string;
  round: number;
  state: ReviewState;
  summary: string;
  files: DocFile[];
  feedback: FeedbackNote[];
}

export interface RepoGroup {
  owner: string;
  repo: string; // owner/name slug
  status: "available" | "unavailable";
  unavailableReason?: "access" | "rate-limited" | "github-unavailable";
  prs: DocPr[];
}

const onboardingPr: DocPr = {
  number: 33,
  title: "Refound the client onboarding brief and its Korean mirror",
  branch: "brief-refound",
  author: "drafting-agent",
  age: "2h ago",
  round: 2,
  state: "changes",
  summary:
    "Rewrote the onboarding brief lead so the promise reads in one breath, split the pricing table into the canonical deliverable, and re-synced the Korean mirror against the English source of truth.",
  files: [
    {
      path: "briefs/onboarding.md",
      format: "md",
      changeType: "modified",
      html: [
        "<h2>Onboarding, bound</h2>",
        "<p>Loose context is where good work goes to die. The brief exists to bind it: one page the client and the studio both sign, so the shape of the work is settled before the first draft.</p>",
        "<h3>What the client owes us</h3>",
        "<ul><li>The single sentence that describes done.</li><li>Two references they wish they had written.</li><li>The one constraint that is not negotiable.</li></ul>",
        "<p>Everything else, we can discover together.</p>",
      ].join(""),
      diff: [
        { value: "Loose context " },
        { value: "is where good work goes to die", added: true },
        { value: "leaks", removed: true },
        { value: ". The brief exists to bind it." },
      ],
    },
    {
      path: "deliverables/onboarding.docx",
      format: "docx",
      changeType: "added",
      html: [
        "<h1>Studio onboarding</h1>",
        "<p>This is the deliverable actually sent to the client: the canonical record of the engagement, generated from the mirror and never hand-edited.</p>",
        "<h2>Fees</h2>",
        "<p>A single fixed fee, invoiced on the bound brief and again on delivery.</p>",
        "<table><thead><tr><th>Stage</th><th>Invoice</th></tr></thead><tbody><tr><td>Bound brief</td><td>50%</td></tr><tr><td>Delivery</td><td>50%</td></tr></tbody></table>",
      ].join(""),
      diff: null,
    },
    {
      path: "briefs/onboarding.ko.html",
      format: "html",
      changeType: "modified",
      html: [
        "<h2>온보딩, 제본하다</h2>",
        "<p>느슨한 맥락은 좋은 작업이 사라지는 곳입니다. 브리프는 그것을 제본합니다: 클라이언트와 스튜디오가 함께 서명하는 한 페이지.</p>",
      ].join(""),
      diff: [
        { value: "느슨한 맥락은 " },
        { value: "좋은 작업이 사라지는 곳입니다", added: true },
        { value: "샙니다", removed: true },
        { value: ". 브리프는 그것을 제본합니다." },
      ],
    },
  ],
  feedback: [
    {
      id: "cmt-201",
      path: "briefs/onboarding.md",
      quote:
        "Loose context is where good work goes to die. The brief exists to bind it.",
      body: "Strong. Keep this as the lead; it carries the whole page.",
      author: "you",
      when: "1h ago",
      resolved: true,
    },
    {
      id: "cmt-202",
      path: "briefs/onboarding.ko.html",
      quote: "느슨한 맥락은 좋은 작업이 사라지는 곳입니다.",
      body: "The mirror drifted from the English source. Re-verify against the current head before approving.",
      author: "you",
      when: "54m ago",
      drifted: true,
    },
  ],
};

const proposalPr: DocPr = {
  number: 41,
  title: "Q3 partnership proposal - executive summary and terms",
  branch: "proposal-q3",
  author: "research-agent",
  age: "5h ago",
  round: 1,
  state: "in-review",
  summary:
    "First draft of the partnership proposal: an executive summary that leads with the shared outcome, a scoped terms section, and a one-page appendix of prior work.",
  files: [
    {
      path: "proposals/partnership-q3.md",
      format: "md",
      changeType: "added",
      html: [
        "<h2>A partnership, not a purchase</h2>",
        "<p>The strongest engagements are the ones where both sides carry risk. This proposal is written to be signed, not admired: every term below maps to a decision one of us has to make this quarter.</p>",
        "<h3>The shared outcome</h3>",
        "<p>By the end of Q3, a working surface both teams use daily - measured, not promised.</p>",
      ].join(""),
      diff: null,
    },
    {
      path: "proposals/appendix.pdf",
      format: "pdf",
      changeType: "added",
      html: [
        "<h1>Appendix - prior work</h1>",
        "<p>Three engagements, each a document deliverable the client still uses. Rendered on the server; the PDF never leaves the network.</p>",
      ].join(""),
      diff: null,
    },
  ],
  feedback: [],
};

const memoPr: DocPr = {
  number: 44,
  title: "Internal memo: retiring the warm greyscale grounds",
  branch: "memo-grounds",
  author: "drafting-agent",
  age: "1d ago",
  round: 3,
  state: "approved",
  summary:
    "A short internal memo recording why the grounds moved to cool paper, with the recomputed WCAG ratios inline so the decision is auditable.",
  files: [
    {
      path: "memos/cool-grounds.md",
      format: "md",
      changeType: "modified",
      html: [
        "<h2>Why the grounds went cool</h2>",
        "<p>The warm greyscale read too close to a competitor's paper. Both themes moved to one temperature: a cool paper white and a slate ink. The images carry the colour; the chrome does not compete.</p>",
        "<p>Every ratio was recomputed against the unchanged signature and thread. Nothing regressed.</p>",
      ].join(""),
      diff: [
        { value: "Both themes moved to " },
        { value: "one temperature", added: true },
        { value: "a warmer neutral", removed: true },
        { value: "." },
      ],
    },
  ],
  feedback: [
    {
      id: "cmt-301",
      path: "memos/cool-grounds.md",
      quote: "The images carry the colour; the chrome does not compete.",
      body: "This is the whole memo in one line. Approved.",
      author: "you",
      when: "1d ago",
      resolved: true,
    },
  ],
};

const styleGuidePr: DocPr = {
  number: 12,
  title: "Bilingual style guide - punctuation and the em dash ban",
  branch: "style-punctuation",
  author: "editing-agent",
  age: "3d ago",
  round: 1,
  state: "awaiting",
  summary:
    "Adds the punctuation section to the house style guide, including the plain-dash rule and the Korean-English spacing conventions.",
  files: [
    {
      path: "style/punctuation.md",
      format: "md",
      changeType: "added",
      html: [
        "<h2>Punctuation</h2>",
        "<p>Plain dash, never the em dash. A sentence that needs one usually wants two sentences.</p>",
        "<h3>Bilingual spacing</h3>",
        "<p>One space between Latin and Hangul runs; none inside a run.</p>",
      ].join(""),
      diff: null,
    },
  ],
  feedback: [],
};

export const dashboard: RepoGroup[] = [
  {
    owner: "Binderys",
    repo: "Binderys/doc-review",
    status: "available",
    prs: [onboardingPr, proposalPr],
  },
  {
    owner: "Binderys",
    repo: "Binderys/studio-briefs",
    status: "available",
    prs: [memoPr, styleGuidePr],
  },
  {
    owner: "skhlo",
    repo: "skhlo/client-deliverables",
    status: "unavailable",
    unavailableReason: "rate-limited",
    prs: [],
  },
];

export const allPrs: DocPr[] = dashboard.flatMap((group) =>
  group.prs.map((pr) => pr),
);

export function findPr(number: number): { repo: string; pr: DocPr } | null {
  for (const group of dashboard) {
    const pr = group.prs.find((candidate) => candidate.number === number);
    if (pr) return { repo: group.repo, pr };
  }
  return null;
}
