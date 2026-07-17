import { z } from "zod";

// Wire shape of `GET /health` (apps/server/src/modules/health/health.controller.ts),
// as it leaves the server inside the success envelope.
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
