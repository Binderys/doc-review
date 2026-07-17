import type { DashboardResponse } from "@doc-review/api-contracts";
import { Controller, Get } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";

// Read-only: only a GET handler. Every PR action stays on GitHub via deep link
// (ADR 0001); the server exposes no mutating routes.
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  getDashboard(): Promise<DashboardResponse> {
    return this.dashboard.getDashboard();
  }
}
