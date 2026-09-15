/**
 * Message protocol between the UI and the analysis worker. The worker owns
 * the full parsed log (which can be large); the UI receives only the compact
 * summary it renders.
 */

import type { LogStats } from "../analysis/rms";
import type { FluenceMap } from "../analysis/fluence";
import type { Subbeam, TrajectoryHeader, TrajectoryMetadata } from "../parser/types";

export type WorkerRequest =
  | { type: "parse"; buffer: ArrayBuffer }
  | { type: "csv" };

export interface ChartSeries {
  expected: Float32Array;
  actual: Float32Array;
}

export type FluenceResult =
  | { status: "pending" }
  | { status: "ready"; expected: FluenceMap; actual: FluenceMap }
  | { status: "unsupported"; reason: string };

export interface LogSummary {
  header: TrajectoryHeader;
  metadata: TrajectoryMetadata;
  subbeams: Subbeam[];
  stats: LogStats;
  gantry: ChartSeries | null;
  mu: ChartSeries | null;
  worstLeaf: ChartSeries | null;
  /** Fluence is the slow step, so it arrives in a separate message. */
  fluence: FluenceResult;
}

export type WorkerResponse =
  | { type: "parsed"; summary: LogSummary }
  | { type: "fluence"; fluence: FluenceResult }
  | { type: "parse-error"; message: string }
  | { type: "csv"; text: string };
