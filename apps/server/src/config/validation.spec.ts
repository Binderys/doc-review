import { validationSchema } from "./validation";

// Mirrors how ConfigModule.forRoot validates process.env: unknown keys allowed.
const validate = (env: Record<string, string>) =>
  validationSchema.validate(env, { allowUnknown: true });

describe("validationSchema", () => {
  it("applies safe defaults outside production", () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe("development");
    expect(value.HOST).toBe("127.0.0.1");
    expect(value.PORT).toBe(3000);
  });

  it("rejects an unknown NODE_ENV", () => {
    const { error } = validate({ NODE_ENV: "staging" });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/NODE_ENV/);
  });
});
