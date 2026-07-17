import {
  contextAgreesAt,
  exactOccurrences,
  locateUniqueContextMatch,
} from "../src/index";

// #82: the single source of the rendered-text quote+context matching core. These are the
// pure string primitives the server reattachment module, the server anchor validator, and
// the client paint gate all decide from - so this suite pins the semantics those three used
// to each restate: overlapping exact occurrence location, position-hint context agreement
// with document-boundary semantics for empty context, and scanning single-out.

describe("exactOccurrences", () => {
  it("returns every start index of an exact match", () => {
    expect(exactOccurrences("one two one", "one")).toEqual([0, 8]);
  });

  it("counts overlapping occurrences (advance by one)", () => {
    // "aa" overlaps itself at 0, 1, 2 in "aaaa"; advancing by one keeps every near-repeat
    // so a downstream decision can only grow more conservative, never less.
    expect(exactOccurrences("aaaa", "aa")).toEqual([0, 1, 2]);
  });

  it("returns no starts when the needle is absent", () => {
    expect(exactOccurrences("nothing to see", "xyz")).toEqual([]);
  });

  it("matches exactly - case and whitespace differences are not occurrences", () => {
    expect(exactOccurrences("Alpha", "alpha")).toEqual([]);
    expect(exactOccurrences("alpha  beta", "alpha beta")).toEqual([]);
  });

  it("fails closed on an empty quote rather than looping forever", () => {
    // `indexOf("")` clamps to the length instead of returning -1, so an unguarded
    // advance-by-one scan would never terminate; an empty quote is never a valid anchor.
    expect(exactOccurrences("abc", "")).toEqual([]);
    expect(exactOccurrences("", "")).toEqual([]);
  });
});

describe("contextAgreesAt", () => {
  describe("non-empty context sits exactly around the span", () => {
    it("agrees when the stored prefix and suffix abut the span", () => {
      const text = "The KEYSTONE clause stands here.";
      const span = { start: 4, end: 12 };
      expect(text.slice(span.start, span.end)).toBe("KEYSTONE");
      expect(
        contextAgreesAt(text, span, { prefix: "The ", suffix: " clause" }),
      ).toBe(true);
    });

    it("rejects context that does not abut the span exactly", () => {
      const text = "The KEYSTONE clause stands here.";
      const span = { start: 4, end: 12 };
      expect(
        contextAgreesAt(text, span, { prefix: "the ", suffix: " clause" }),
      ).toBe(false);
      expect(
        contextAgreesAt(text, span, { prefix: "The ", suffix: " CLAUSE" }),
      ).toBe(false);
    });
  });

  describe("empty prefix is a document-start claim, not a wildcard", () => {
    it("agrees only when the span begins the document", () => {
      const text = "ALPHA leads the rest.";
      const span = { start: 0, end: 5 };
      expect(
        contextAgreesAt(text, span, { prefix: "", suffix: " leads" }),
      ).toBe(true);
    });

    it("rejects an empty prefix on a mid-document span", () => {
      const text = "Intro. ALPHA leads the rest.";
      const start = text.indexOf("ALPHA");
      const span = { start, end: start + "ALPHA".length };
      expect(start).toBeGreaterThan(0);
      expect(
        contextAgreesAt(text, span, { prefix: "", suffix: " leads" }),
      ).toBe(false);
    });
  });

  describe("empty suffix is a document-end claim, not a wildcard", () => {
    it("agrees only when the span ends the document", () => {
      const text = "the rest precedes OMEGA";
      const span = { start: text.length - 5, end: text.length };
      expect(text.slice(span.start, span.end)).toBe("OMEGA");
      expect(
        contextAgreesAt(text, span, { prefix: "precedes ", suffix: "" }),
      ).toBe(true);
    });

    it("rejects an empty suffix on a mid-document span", () => {
      const text = "the rest precedes OMEGA and then more";
      const start = text.indexOf("OMEGA");
      const span = { start, end: start + "OMEGA".length };
      expect(span.end).toBeLessThan(text.length);
      expect(
        contextAgreesAt(text, span, { prefix: "precedes ", suffix: "" }),
      ).toBe(false);
    });
  });

  describe("both-empty context is a whole-document claim", () => {
    it("agrees when the span spans the whole text", () => {
      expect(
        contextAgreesAt(
          "WHOLE",
          { start: 0, end: 5 },
          { prefix: "", suffix: "" },
        ),
      ).toBe(true);
    });

    it("rejects when the text extends past the span on either side", () => {
      expect(
        contextAgreesAt(
          "WHOLE tail",
          { start: 0, end: 5 },
          { prefix: "", suffix: "" },
        ),
      ).toBe(false);
    });
  });
});

describe("locateUniqueContextMatch", () => {
  it("locates the span when a unique quote's context agrees", () => {
    const text = "start alpha MOVER omega end";
    const start = text.indexOf("MOVER");
    expect(
      locateUniqueContextMatch(text, {
        quote: "MOVER",
        prefix: "alpha ",
        suffix: " omega",
      }),
    ).toEqual({ start, end: start + "MOVER".length });
  });

  it("uses context to single out one of several occurrences", () => {
    const text = "left SIGMA tail and right SIGMA tail";
    const occ1 = text.indexOf("SIGMA");
    const occ2 = text.lastIndexOf("SIGMA");
    expect(
      locateUniqueContextMatch(text, {
        quote: "SIGMA",
        prefix: "left ",
        suffix: " tail",
      }),
    ).toEqual({ start: occ1, end: occ1 + 5 });
    expect(
      locateUniqueContextMatch(text, {
        quote: "SIGMA",
        prefix: "right ",
        suffix: " tail",
      }),
    ).toEqual({ start: occ2, end: occ2 + 5 });
  });

  it("returns null for a near-repeat the context cannot separate", () => {
    // Both occurrences carry the identical surrounding context, so the location is
    // ambiguous and is never guessed at.
    const text = "ditto ECHO ditto ECHO ditto";
    expect(
      locateUniqueContextMatch(text, {
        quote: "ECHO",
        prefix: "ditto ",
        suffix: " ditto",
      }),
    ).toBeNull();
  });

  it("returns null when a boundary claim no longer holds off the boundary", () => {
    // The quote is unique and its suffix agrees, but the empty prefix claims the document
    // start and the quote no longer begins the text.
    const text = "Intro sentence. ALPHA leads the rest.";
    expect(
      locateUniqueContextMatch(text, {
        quote: "ALPHA",
        prefix: "",
        suffix: " leads",
      }),
    ).toBeNull();
  });

  it("returns null when the quote is absent", () => {
    expect(
      locateUniqueContextMatch("nothing matches here", {
        quote: "GHOST",
        prefix: "",
        suffix: "",
      }),
    ).toBeNull();
  });

  it("returns null for an empty quote (inherits the fail-closed occurrence scan)", () => {
    // An empty quote yields zero occurrences, so the context filter has nothing to single
    // out - null, never a hang.
    expect(
      locateUniqueContextMatch("any text at all", {
        quote: "",
        prefix: "",
        suffix: "",
      }),
    ).toBeNull();
  });
});
