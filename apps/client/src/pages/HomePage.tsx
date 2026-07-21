import type { DashboardResponse } from "@doc-review/api-contracts";
import { useEffect, useState } from "react";
import { dashboardApi } from "../shared/api";
import { DashboardView } from "./DashboardView";

// Home page: does the client-side fetch and hands the grouped data to the
// presentational DashboardView. Fetched per mount, so a reload reflects newly
// opened PRs.
export function HomePage() {
  const [data, setData] = useState<DashboardResponse>({ repos: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    dashboardApi
      .getDashboard()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Failed to load dashboard",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell__inner" aria-labelledby="page-title">
      <p className="app-shell__eyebrow">doc-review</p>
      <h1 id="page-title">Open pull requests</h1>
      {error ? (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      ) : (
        <DashboardView repos={data.repos} />
      )}
    </main>
  );
}
