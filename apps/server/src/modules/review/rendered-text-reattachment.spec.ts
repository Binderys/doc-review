import {
  decideRenderedTextReattachment,
  type RenderedTextSelector,
} from "./rendered-text-reattachment";

// #68: a pure, deterministic reattachment decision for a stored rendered-text Mirror
// selector against a freshly normalized review-text. Positions are hints only; the
// exact quote plus prefix/suffix context decide whether one location is safe, and
// every ambiguous or missing result is drifted rather than guessed. This is the
// decision table: each block is one acceptance criterion.

// Builds a selector whose position hints are the quote's location in `text`, so a
// same-text decision sees a hint that matches and a changed-text decision sees a hint
// that no longer does. `prefix`/`suffix` are the stored context captured at selection.
function selectorAt(
  text: string,
  quote: string,
  prefix = "",
  suffix = "",
): RenderedTextSelector {
  const start = text.indexOf(quote);
  if (start === -1) {
    throw new Error(`fixture quote not found in text: ${quote}`);
  }
  return { quote, prefix, suffix, start, end: start + quote.length };
}

describe("decideRenderedTextReattachment", () => {
  // AC1: an unchanged exact quote at the original position reattaches there.
  describe("same position", () => {
    it("reattaches an unchanged quote at its original position", () => {
      const text = "The KEYSTONE clause stands unchanged in this Mirror.";
      const selector = selectorAt(text, "KEYSTONE", "The ", " clause");

      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "reattached",
        start: selector.start,
        end: selector.end,
      });
    });
  });

  // AC2: when the original position no longer matches, a unique moved exact quote
  // reattaches with updated start and end hints. Distinct old/new position sentinels. The
  // quote is mid-document with non-empty context (a boundary quote is covered by the
  // boundary-context suite below), so its stored context travels with it and still agrees.
  describe("unique move", () => {
    it("reattaches a unique moved quote at its new position", () => {
      const oldText = "Here the KEYSTONE clause leads the whole Mirror.";
      const newText =
        "A brand new opening sentence now precedes the KEYSTONE clause today.";
      const selector = selectorAt(oldText, "KEYSTONE", "the ", " clause");
      const oldStart = selector.start;
      const newStart = newText.indexOf("KEYSTONE");

      // The hint (old position) is genuinely stale, so the decision must recompute.
      expect(oldStart).not.toBe(newStart);
      expect(newText.slice(selector.start, selector.end)).not.toBe(
        selector.quote,
      );

      expect(decideRenderedTextReattachment(selector, newText)).toEqual({
        outcome: "reattached",
        start: newStart,
        end: newStart + "KEYSTONE".length,
      });
    });
  });

  // AC3: duplicate exact quotes reattach only when prefix and suffix context identify
  // one candidate. The counter-cases keep the stored position hint fixed at the first
  // occurrence and flip only one context field, proving both fields are decision-bearing.
  describe("context disambiguation", () => {
    it("lets the prefix alone pick the winning duplicate (shared suffix)", () => {
      const text = "left SIGMA tail and right SIGMA tail";
      const occ1 = text.indexOf("SIGMA");
      const occ2 = text.lastIndexOf("SIGMA");
      const base = { quote: "SIGMA", start: occ1, end: occ1 + "SIGMA".length };

      // Changing ONLY the prefix flips the winner from occ1 to occ2.
      expect(
        decideRenderedTextReattachment(
          { ...base, prefix: "left ", suffix: " tail" },
          text,
        ),
      ).toEqual({ outcome: "reattached", start: occ1, end: occ1 + 5 });
      expect(
        decideRenderedTextReattachment(
          { ...base, prefix: "right ", suffix: " tail" },
          text,
        ),
      ).toEqual({ outcome: "reattached", start: occ2, end: occ2 + 5 });
    });

    it("lets the suffix alone pick the winning duplicate (shared prefix)", () => {
      const text = "edge SIGMA red and edge SIGMA blue";
      const occ1 = text.indexOf("SIGMA");
      const occ2 = text.lastIndexOf("SIGMA");
      const base = { quote: "SIGMA", start: occ1, end: occ1 + "SIGMA".length };

      // Changing ONLY the suffix flips the winner from occ1 to occ2.
      expect(
        decideRenderedTextReattachment(
          { ...base, prefix: "edge ", suffix: " red" },
          text,
        ),
      ).toEqual({ outcome: "reattached", start: occ1, end: occ1 + 5 });
      expect(
        decideRenderedTextReattachment(
          { ...base, prefix: "edge ", suffix: " blue" },
          text,
        ),
      ).toEqual({ outcome: "reattached", start: occ2, end: occ2 + 5 });
    });
  });

  // AC4: equally ranked duplicates, missing quotes, deleted text, changed quote text,
  // empty context that cannot disambiguate, malformed offsets, and out-of-range offsets
  // all drift, preserving the original selector evidence.
  describe("ambiguous and missing", () => {
    it("drifts equally ranked duplicates that context cannot separate", () => {
      const text = "ditto ECHO ditto ECHO ditto";
      const selector = selectorAt(text, "ECHO", "ditto ", " ditto");

      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "drifted",
        selector,
      });
    });

    it("drifts a missing quote", () => {
      const selector = selectorAt("The GHOST once haunted here.", "GHOST");

      expect(
        decideRenderedTextReattachment(selector, "Nothing haunts this text."),
      ).toEqual({ outcome: "drifted", selector });
    });

    it("drifts deleted text", () => {
      const oldText = "Keep this DOOMED sentence for now.";
      const selector = selectorAt(oldText, "DOOMED", "this ", " sentence");

      expect(
        decideRenderedTextReattachment(selector, "Keep this sentence for now."),
      ).toEqual({ outcome: "drifted", selector });
    });

    it("drifts changed quote text", () => {
      const selector = selectorAt(
        "The ORIGINAL PHRASE anchored the note.",
        "ORIGINAL PHRASE",
      );

      expect(
        decideRenderedTextReattachment(
          selector,
          "The REVISED PHRASE anchored the note.",
        ),
      ).toEqual({ outcome: "drifted", selector });
    });

    it("drifts a both-empty (whole-document) claim against a longer text with duplicates", () => {
      // Both context sides empty is a whole-document claim (starts AND ends the document).
      // Neither occurrence in this longer text satisfies both boundaries, so it drifts -
      // empty context is a boundary claim, never a wildcard that matches a mid-text repeat.
      const text = "MOTIF then MOTIF";
      const occ1 = text.indexOf("MOTIF");
      const selector: RenderedTextSelector = {
        quote: "MOTIF",
        prefix: "",
        suffix: "",
        start: occ1,
        end: occ1 + "MOTIF".length,
      };

      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "drifted",
        selector,
      });
    });

    it("drifts malformed offsets even when the quote is findable", () => {
      const text = "A UNIQUE token lives here.";
      const selector: RenderedTextSelector = {
        quote: "UNIQUE",
        prefix: "",
        suffix: "",
        start: -1,
        end: 5,
      };

      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "drifted",
        selector,
      });
    });

    it("drifts out-of-range offsets even when the quote is findable", () => {
      const text = "A UNIQUE token lives here.";
      const selector: RenderedTextSelector = {
        quote: "UNIQUE",
        prefix: "",
        suffix: "",
        start: 500,
        end: 500 + "UNIQUE".length,
      };

      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "drifted",
        selector,
      });
    });
  });

  // AC4 (deleted-text row, refined): a lone surviving occurrence is not a safe home
  // when it is a coincidental identical quote whose surroundings contradict the stored
  // non-empty context. Position is a hint; context still decides even at cardinality one.
  describe("context agreement on unique reattachment", () => {
    it("drifts to a coincidental unique quote whose context contradicts the stored context", () => {
      // Original passage carried "alpha REPEAT omega"; that passage is deleted and only
      // an unrelated "gamma REPEAT delta" survives - one exact occurrence, wrong context.
      const oldText = "keep alpha REPEAT omega here";
      const selector = selectorAt(oldText, "REPEAT", "alpha ", " omega");
      const newText = "unrelated gamma REPEAT delta survives";

      // Exactly one surviving occurrence, so the defect is a cardinality-one guess.
      expect(newText.split("REPEAT").length - 1).toBe(1);
      expect(decideRenderedTextReattachment(selector, newText)).toEqual({
        outcome: "drifted",
        selector,
      });
    });

    it("reattaches a unique moved quote whose non-empty context still agrees", () => {
      const oldText = "start alpha MOVER omega end";
      const selector = selectorAt(oldText, "MOVER", "alpha ", " omega");
      const newText = "prefixed text then alpha MOVER omega trailing";
      const newStart = newText.indexOf("MOVER");

      expect(selector.start).not.toBe(newStart);
      expect(decideRenderedTextReattachment(selector, newText)).toEqual({
        outcome: "reattached",
        start: newStart,
        end: newStart + "MOVER".length,
      });
    });
  });

  // Boundary context: an empty prefix is a document-START claim and an empty suffix a
  // document-END claim, not a wildcard. A boundary-anchored quote reattaches only while it
  // still sits at that boundary; once content is prepended (start) or appended (end) it
  // drifts, so the decision agrees with the client paint gate and the anchor-validation seam
  // rather than reattaching to a location the client would refuse to highlight.
  describe("boundary context (empty prefix/suffix is a document-boundary claim)", () => {
    it("reattaches a document-start quote that still begins the text", () => {
      const text = "ALPHA leads the rest of the text.";
      const selector = selectorAt(text, "ALPHA", "", " leads the");

      expect(selector.start).toBe(0);
      expect(selector.prefix).toBe("");
      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "reattached",
        start: 0,
        end: "ALPHA".length,
      });
    });

    it("drifts a document-start quote once content is prepended off the boundary", () => {
      const oldText = "ALPHA leads the rest of the text.";
      const selector = selectorAt(oldText, "ALPHA", "", " leads the");
      const newText = "Intro sentence. ALPHA leads the rest of the text.";

      // The quote is still unique and its suffix still agrees, but the empty prefix claimed
      // the document start and the quote no longer begins the text.
      expect(newText.indexOf("ALPHA")).toBeGreaterThan(0);
      expect(decideRenderedTextReattachment(selector, newText)).toEqual({
        outcome: "drifted",
        selector,
      });
    });

    it("reattaches a document-end quote that still ends the text", () => {
      const text = "the rest precedes the OMEGA";
      const selector = selectorAt(text, "OMEGA", "precedes the ", "");

      expect(selector.end).toBe(text.length);
      expect(selector.suffix).toBe("");
      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "reattached",
        start: selector.start,
        end: selector.end,
      });
    });

    it("drifts a document-end quote once content is appended off the boundary", () => {
      const oldText = "the rest precedes the OMEGA";
      const selector = selectorAt(oldText, "OMEGA", "precedes the ", "");
      const newText = "the rest precedes the OMEGA and a new trailing clause.";

      // The quote is still unique and its prefix still agrees, but the empty suffix claimed
      // the document end and the quote no longer ends the text.
      const occurrence = newText.indexOf("OMEGA");
      expect(occurrence + "OMEGA".length).toBeLessThan(newText.length);
      expect(decideRenderedTextReattachment(selector, newText)).toEqual({
        outcome: "drifted",
        selector,
      });
    });

    it("reattaches a whole-document quote while it still spans the whole text", () => {
      const text = "WHOLE";
      const selector = selectorAt(text, "WHOLE");

      expect(selector.start).toBe(0);
      expect(selector.end).toBe(text.length);
      expect(decideRenderedTextReattachment(selector, text)).toEqual({
        outcome: "reattached",
        start: 0,
        end: text.length,
      });
    });

    it("drifts a whole-document quote once the text grows beyond it", () => {
      // Both context sides empty (starts AND ends the document); once the text carries a
      // trailing clause the end boundary no longer holds, so it drifts.
      const selector: RenderedTextSelector = {
        quote: "WHOLE",
        prefix: "",
        suffix: "",
        start: 0,
        end: "WHOLE".length,
      };

      expect(
        decideRenderedTextReattachment(selector, "WHOLE plus appended tail."),
      ).toEqual({ outcome: "drifted", selector });
    });

    it("drifts against an empty review-text", () => {
      const selector: RenderedTextSelector = {
        quote: "X",
        prefix: "",
        suffix: "",
        start: 0,
        end: 1,
      };

      expect(decideRenderedTextReattachment(selector, "")).toEqual({
        outcome: "drifted",
        selector,
      });
    });
  });

  // AC5: a position holding different text never reattaches merely because the offsets
  // are in range (or a browser Range could be revived there).
  describe("wrong quote at a valid position", () => {
    it("drifts rather than reattaching to a stale in-range span", () => {
      const oldText = "The FLAG marker sits here originally.";
      const selector = selectorAt(oldText, "FLAG", "The ", " marker");
      const newText = "The DIFFERENT marker sits here now, no flag word today.";

      // The stored span is still in range, but holds different text and the exact
      // quote is absent from the whole document.
      expect(selector.end).toBeLessThanOrEqual(newText.length);
      expect(newText.slice(selector.start, selector.end)).not.toBe(
        selector.quote,
      );
      expect(newText.includes(selector.quote)).toBe(false);

      expect(decideRenderedTextReattachment(selector, newText)).toEqual({
        outcome: "drifted",
        selector,
      });
    });
  });

  // AC6: fuzzy, case-insensitive, whitespace-approximate, and semantic matches are not
  // accepted when the exact quote is absent.
  describe("near matches are not exact matches", () => {
    it("drifts a case-only difference", () => {
      const selector = selectorAt("A Canonical heading here.", "Canonical");

      expect(
        decideRenderedTextReattachment(selector, "A canonical heading here."),
      ).toEqual({ outcome: "drifted", selector });
    });

    it("drifts a whitespace-approximate difference", () => {
      const selector = selectorAt("keep alpha beta close", "alpha beta");

      expect(
        decideRenderedTextReattachment(selector, "keep alpha  beta apart"),
      ).toEqual({ outcome: "drifted", selector });
    });

    it("drifts a one-planted-token difference", () => {
      const selector = selectorAt(
        "please review the final draft soon",
        "review the final draft",
      );

      expect(
        decideRenderedTextReattachment(
          selector,
          "please review the initial final draft soon",
        ),
      ).toEqual({ outcome: "drifted", selector });
    });
  });

  // AC7: the decision is a pure function of the selector and normalized text, with no
  // Recogito, DOM, persistence, or format dependency. This suite runs in the server's
  // node test environment with no browser or annotation-library setup.
  describe("purity", () => {
    it("runs with no DOM present and is deterministic", () => {
      expect(typeof (globalThis as { document?: unknown }).document).toBe(
        "undefined",
      );
      const text = "A REPEATABLE token in a stable Mirror.";
      const selector = selectorAt(text, "REPEATABLE", "A ", " token");

      const first = decideRenderedTextReattachment(selector, text);
      const second = decideRenderedTextReattachment(selector, text);
      expect(first).toEqual(second);
      expect(first).toEqual({
        outcome: "reattached",
        start: selector.start,
        end: selector.end,
      });
    });
  });
});
