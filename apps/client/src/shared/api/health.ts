import {
  healthResponseSchema,
  type HealthResponse,
} from "@doc-review/api-contracts";
import { apiClient, type ApiClient } from "./apiClient";

// Thin, typed domain API over the public `GET /health` endpoint. Each call parses
// its response against the contract schema.
export type HealthApi = {
  getHealth(): Promise<HealthResponse>;
};

export const createHealthApi = (client: ApiClient): HealthApi => ({
  getHealth: () => client.get("/health", { schema: healthResponseSchema }),
});

export const healthApi = createHealthApi(apiClient);
