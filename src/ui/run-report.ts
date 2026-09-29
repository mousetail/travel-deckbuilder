import type { CareerStats } from "../game/career";
import type { Anomaly } from "../game/state";
import type { RunScores, RunStats } from "../game/stats";

const ENDPOINT =
  "https://fractal-hash-backend.mousetail.nl/travel-card-game-stats";

/** The end-of-run payload sent to the developers, when the player opted in. */
export type RunReport = {
  /** The git commit the build was made from, injected by Vite. */
  commit: string;
  userAgent: string;
  origin: string;
  /** Wall-clock milliseconds from the run starting to it ending. */
  durationMs: number;
  seed: number;
  anomalies: readonly Anomaly[];
  scores: RunScores;
  run: RunStats;
  career: CareerStats;
};

export function buildRunReport(
  scores: RunScores,
  run: RunStats,
  career: CareerStats,
  anomalies: readonly Anomaly[],
  seed: number,
  startedAt: number,
): RunReport {
  return {
    commit: __COMMIT_HASH__,
    userAgent: navigator.userAgent,
    origin: window.location.origin,
    durationMs: Date.now() - startedAt,
    seed,
    anomalies,
    scores,
    run,
    career,
  };
}

/** Send a finished run's report. Best-effort: failures are ignored. */
export function uploadRunReport(report: RunReport): void {
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  }).catch(() => {
    // Sharing must never disturb the player, so a network error is swallowed.
  });
}
