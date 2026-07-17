import {
  dashboardResponseSchema,
  type DashboardResponse,
} from "@doc-review/api-contracts";
import { apiClient, type ApiClient } from "./apiClient";

// Thin, typed domain API over the read-only `GET /dashboard` endpoint. Each call
// parses its response against the contract schema at the boundary.
export type DashboardApi = {
  getDashboard(): Promise<DashboardResponse>;
};

export const createDashboardApi = (client: ApiClient): DashboardApi => ({
  getDashboard: () =>
    client.get("/dashboard", { schema: dashboardResponseSchema }),
});

export const dashboardApi = createDashboardApi(apiClient);
