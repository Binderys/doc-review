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
    });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/WATCHED_REPOS/);
  });

  it("rejects a production watched-repo value with no owner/repo entries", () => {
    const { error } = validate({
      NODE_ENV: "production",
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
        GITHUB_TOKEN: "legacy-global-token",
        GITHUB_TOKEN_BINDERYS: "binderys-owner-token",
        GITHUB_TOKEN_ACME_LEGAL: "acme-owner-token",
      });

      expect(configuration).toMatchObject({
        githubCredentialsByOwner: {
          binderys: "binderys-owner-token",
          "acme-legal": "acme-owner-token",
        },
      });
      expect(configuration).not.toHaveProperty("githubToken");
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

    it("rejects a legacy global credential when watched owners are uncovered", () => {
      const legacySecret = "LEGACY_SECRET_SENTINEL";
      const { error } = validate({
        NODE_ENV: "production",
        WATCHED_REPOS: "Binderys/board-review,acme-legal/contracts",
        GITHUB_TOKEN: legacySecret,
      });
      const message = error?.message ?? "";

      expect(error).toBeDefined();
      expect(message).toMatch(/binderys.*GITHUB_TOKEN_BINDERYS/i);
      expect(message).toMatch(/acme-legal.*GITHUB_TOKEN_ACME_LEGAL/i);
      expect(message).not.toContain(legacySecret);
    });

    it.each([
      ["a missing", undefined],
      ["an empty", ""],
    ])(
      "rejects %s resource-owner credential without printing planted secrets",
      (_case, acmeCredential) => {
        const binderysSecret = "BINDERYS_SECRET_SENTINEL";
        const legacySecret = "LEGACY_SECRET_SENTINEL";
        const productionEnv: Record<string, string> = {
          NODE_ENV: "production",
          WATCHED_REPOS: "Binderys/board-review,acme-legal/contracts",
          GITHUB_TOKEN: legacySecret,
          GITHUB_TOKEN_BINDERYS: binderysSecret,
          GITHUB_TOKEN_OTHER_OWNER: "OTHER_OWNER_SECRET_SENTINEL",
        };
        if (acmeCredential !== undefined) {
          productionEnv.GITHUB_TOKEN_ACME_LEGAL = acmeCredential;
        }

        const { error } = validate(productionEnv);
        const message = error?.message ?? "";

        expect(error).toBeDefined();
        expect(message).toMatch(/acme-legal/);
        expect(message).toMatch(/GITHUB_TOKEN_ACME_LEGAL/);
        expect(message).not.toContain(binderysSecret);
        expect(message).not.toContain(legacySecret);
        expect(message).not.toContain("OTHER_OWNER_SECRET_SENTINEL");
      },
    );

    it("keeps development configuration valid without credentials", () => {
      const { error } = validate({
        NODE_ENV: "development",
        WATCHED_REPOS: "public-owner/public-fixture",
      });

      expect(error).toBeUndefined();
    });
  });
});
