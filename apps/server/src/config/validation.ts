import Joi from "joi";

const watchedReposSchema = Joi.string().pattern(
  /^[^/,\s]+\/[^/,\s]+(?:\s*,\s*[^/,\s]+\/[^/,\s]+)*$/,
);

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  HOST: Joi.string().default("127.0.0.1"),
  PORT: Joi.number().default(3000),
  // Development can use unauthenticated reads and the launch fixture default.
  // Production must name its real read credential and watched repos explicitly.
  GITHUB_TOKEN: Joi.when("NODE_ENV", {
    is: "production",
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  WATCHED_REPOS: Joi.when("NODE_ENV", {
    is: "production",
    then: watchedReposSchema.required(),
    otherwise: watchedReposSchema.optional(),
  }),
  DOC_REVIEW_GITHUB_SOURCE: Joi.string()
    .valid("github", "compose-smoke")
    .default("github"),
  REVIEW_STATE_PATH: Joi.string().default(".data/review-state.json"),
});
