import Joi from "joi";

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  HOST: Joi.string().default("127.0.0.1"),
  PORT: Joi.number().default(3000),
  // Both optional: the app boots without a token (unauthenticated GitHub reads) and
  // falls back to the launch-default watched repo when WATCHED_REPOS is unset.
  GITHUB_TOKEN: Joi.string().optional(),
  WATCHED_REPOS: Joi.string().optional(),
  REVIEW_STATE_PATH: Joi.string().default(".data/review-state.json"),
});
