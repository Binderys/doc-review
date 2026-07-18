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

  it.each(["GITHUB_TOKEN", "WATCHED_REPOS"])(
    "requires %s in production",
    (requiredVariable) => {
      const productionEnv: Record<string, string> = {
        NODE_ENV: "production",
        GITHUB_TOKEN: "read-scope-token",
        WATCHED_REPOS: "operator/real-document-repo",
      };
      delete productionEnv[requiredVariable];

      const { error } = validate(productionEnv);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(new RegExp(requiredVariable));
    },
  );

  it("rejects a production watched-repo value with no owner/repo entries", () => {
    const { error } = validate({
      NODE_ENV: "production",
      GITHUB_TOKEN: "read-scope-token",
      WATCHED_REPOS: " , ",
    });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/WATCHED_REPOS/);
  });
});
