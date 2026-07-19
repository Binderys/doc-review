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
      typeof value.WATCHED_REPOS !== "string"
    ) {
      return value;
    }

    const watchedOwners = [
      ...new Set(
        value.WATCHED_REPOS.split(",").map((repo) =>
          githubResourceOwner(repo.trim()),
        ),
      ),
    ];
    const missingCredentials = watchedOwners
      .map((owner) => ({
        owner,
        variable: githubCredentialEnvironmentVariable(owner),
      }))
      .filter(({ variable }) => !hasCredential(value[variable]));

    if (missingCredentials.length > 0) {
      return helpers.error("object.resourceOwnerCredentials", {
        credentials: missingCredentials
          .map(({ owner, variable }) => `${owner} (${variable})`)
          .join(", "),
      });
    }
    return value;
  })
  .messages({
    "object.resourceOwnerCredentials":
      "Resource-owner credential(s) {{#credentials}} are required in production",
  });
