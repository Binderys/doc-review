import { env } from "./env";
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

  it("requires WATCHED_REPOS in production", () => {
    const { error } = validate({
      NODE_ENV: "production",
      GITHUB_TOKEN: "read-scope-token",
    });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/WATCHED_REPOS/);
  });

  it("rejects a production watched-repo value with no owner/repo entries", () => {
    const { error } = validate({
      NODE_ENV: "production",
      GITHUB_TOKEN: "read-scope-token",
      WATCHED_REPOS: " , ",
    });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/WATCHED_REPOS/);
  });

  describe("resource-owner credential configuration", () => {
    it("normalizes mixed-case and hyphenated watched owners once at the configuration boundary", () => {
      const configuration = env({
        WATCHED_REPOS:
          "Binderys/board-review,bInDeRyS/legal-review,acme-legal/contracts",
        GITHUB_TOKEN_BINDERYS: "binderys-owner-token",
        GITHUB_TOKEN_ACME_LEGAL: "acme-owner-token",
      });

      expect(configuration).toMatchObject({
        githubCredentialsByOwner: {
          binderys: "binderys-owner-token",
          "acme-legal": "acme-owner-token",
        },
      });
    });

    it("accepts production configuration with one owner credential for every watched owner", () => {
      const { error } = validate({
        NODE_ENV: "production",
        WATCHED_REPOS:
          "Binderys/board-review,binderys/legal-review,acme-legal/contracts",
        GITHUB_TOKEN_BINDERYS: "binderys-owner-token",
        GITHUB_TOKEN_ACME_LEGAL: "acme-owner-token",
      });

      expect(error).toBeUndefined();
    });

    it("temporarily accepts the legacy global token in production", () => {
      const { error } = validate({
        NODE_ENV: "production",
        WATCHED_REPOS: "Binderys/board-review,acme-legal/contracts",
        GITHUB_TOKEN: "legacy-compatibility-token",
      });

      expect(error).toBeUndefined();
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
    ])(
      "rejects a %s resource-owner credential without printing planted secrets",
      (_case, acmeCredential) => {
        const binderysSecret = "BINDERYS_SECRET_SENTINEL";
        const legacySecret = "LEGACY_SECRET_SENTINEL";
        const productionEnv: Record<string, string> = {
          NODE_ENV: "production",
          WATCHED_REPOS: "Binderys/board-review,acme-legal/contracts",
          GITHUB_TOKEN_BINDERYS: binderysSecret,
        };
        if (acmeCredential !== undefined) {
          productionEnv.GITHUB_TOKEN_ACME_LEGAL = acmeCredential;
        }

        const { error } = validate(productionEnv);
        const message = error?.message ?? "";

        expect(error).toBeDefined();
        expect(message).toMatch(/GITHUB_TOKEN_ACME_LEGAL/);
        expect(message).not.toContain(binderysSecret);
        expect(message).not.toContain(legacySecret);
      },
    );
  });
});
