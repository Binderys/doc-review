import { apiEnvelopeSchema, healthResponseSchema } from "../src/index";

describe("healthResponseSchema", () => {
  it("accepts the ok status", () => {
    expect(healthResponseSchema.safeParse({ status: "ok" }).success).toBe(true);
  });

  it("rejects any other status", () => {
    expect(healthResponseSchema.safeParse({ status: "down" }).success).toBe(
      false,
    );
  });
});

describe("apiEnvelopeSchema", () => {
  const envelope = apiEnvelopeSchema(healthResponseSchema);

  it("accepts a wrapped health payload", () => {
    const result = envelope.safeParse({
      success: true,
      data: { status: "ok" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unwrapped payload", () => {
    expect(envelope.safeParse({ status: "ok" }).success).toBe(false);
  });
});
