import Joi from "joi";
import {
  githubCredentialEnvironmentVariable,
  githubResourceOwner,
} from "./env";

const watchedReposSchema = Joi.string().pattern(
  /^[^/,\s]+\/[^/,\s]+(?:\s*,\s*[^/,\s]+\/[^/,\s]+)*$/,
);

const hasCredential = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  HOST: Joi.string().default("127.0.0.1"),
  PORT: Joi.number().default(3000),
  // Development can use unauthenticated reads. During the resource-owner
  // credential expansion, production may still use this compatibility token.
  GITHUB_TOKEN: Joi.string().allow("").optional(),
  WATCHED_REPOS: Joi.when("NODE_ENV", {
    is: "production",
    then: watchedReposSchema.required(),
    otherwise: watchedReposSchema.optional(),
  }),
  DOC_REVIEW_GITHUB_SOURCE: Joi.string()
    .valid("github", "compose-smoke")
    .default("github"),
  REVIEW_STATE_PATH: Joi.string().default(".data/review-state.json"),
})
  .custom((value: Record<string, unknown>, helpers) => {
    if (
      value.NODE_ENV !== "production" ||
      typeof value.WATCHED_REPOS !== "string" ||
      hasCredential(value.GITHUB_TOKEN)
    ) {
      return value;
    }

    const missingCredentials = [
      ...new Set(
        value.WATCHED_REPOS.split(",").map((repo) =>
          githubCredentialEnvironmentVariable(githubResourceOwner(repo.trim())),
        ),
      ),
    ].filter((variable) => !hasCredential(value[variable]));

    if (missingCredentials.length > 0) {
      return helpers.error("object.resourceOwnerCredentials", {
        variables: missingCredentials.join(", "),
      });
    }
    return value;
  })
  .messages({
    "object.resourceOwnerCredentials":
      "Resource-owner credential(s) {{#variables}} are required in production",
  });
