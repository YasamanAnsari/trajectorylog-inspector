/// <reference lib="webworker" />
/**
 * Analysis worker: parses the log and computes statistics/fluence off the
 * main thread so multi-hundred-MB logs never freeze the UI. The parsed log
 * stays in the worker; only render-ready data crosses back.
 */

import { parseTrajectoryLog, TrajectoryParseError } from "../parser/parse";
import { AXIS, type TrajectoryLog } from "../parser/types";
import {
  CORRECTED_STATS,
  REFERENCE_STATS,
  computeLogStats,
  type LogStats,
} from "../analysis/rms";
import { buildFluence, fluenceSupported } from "../analysis/fluence";
import { toCSV } from "../analysis/csv";
import { mlcModelName } from "../parser/types";
import type {
  ChartSeries,
  FluenceResult,
  LogSummary,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

let currentLog: TrajectoryLog | null = null;

function scalarSeries(log: TrajectoryLog, axisId: number): ChartSeries | null {
  const series = log.axes.get(axisId);
  if (!series || series.expected.length === 0) return null;
  return { expected: series.expected[0]!, actual: series.actual[0]! };
}

function worstLeafSeries(log: TrajectoryLog, stats: LogStats): ChartSeries | null {
  if (!stats.mlc) return null;
  const mlc = log.axes.get(AXIS.MLC)!;
  const index = stats.mlc.maxDeviationSampleIndex;
  return { expected: mlc.expected[index]!, actual: mlc.actual[index]! };
}

function buildSummary(log: TrajectoryLog): LogSummary {
  const stats = computeLogStats(log, CORRECTED_STATS);
  const referenceStats = computeLogStats(log, REFERENCE_STATS);

  return {
    header: log.header,
    metadata: log.metadata,
    subbeams: log.subbeams,
    stats,
    referenceStats,
    gantry: scalarSeries(log, AXIS.Gantry),
    mu: scalarSeries(log, AXIS.MU),
    worstLeaf: worstLeafSeries(log, stats),
    referenceWorstLeaf: worstLeafSeries(log, referenceStats),
    fluence: { status: "pending" },
  };
}

function computeFluence(log: TrajectoryLog): FluenceResult {
  if (!fluenceSupported(log.header.mlcModel)) {
    return {
      status: "unsupported",
      reason: `Fluence reconstruction is not supported for ${mlcModelName(log.header.mlcModel)} (matching the reference library).`,
    };
  }
  try {
    return {
      status: "ready",
      expected: buildFluence(log, "expected"),
      actual: buildFluence(log, "actual"),
    };
  } catch (error) {
    return { status: "unsupported", reason: error instanceof Error ? error.message : String(error) };
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === "parse") {
    try {
      currentLog = parseTrajectoryLog(request.buffer);
    } catch (error) {
      currentLog = null;
      const message =
        error instanceof TrajectoryParseError
          ? error.message
          : `Unexpected error while reading the file: ${error instanceof Error ? error.message : String(error)}`;
      self.postMessage({ type: "parse-error", message } satisfies WorkerResponse);
      return;
    }

    // Stats are cheap; ship them first so the dashboard appears while the
    // (much slower) fluence reconstruction is still running.
    self.postMessage({ type: "parsed", summary: buildSummary(currentLog) } satisfies WorkerResponse);

    const fluence = computeFluence(currentLog);
    const transfers =
      fluence.status === "ready" ? [fluence.expected.data.buffer, fluence.actual.data.buffer] : [];
    self.postMessage({ type: "fluence", fluence } satisfies WorkerResponse, { transfer: transfers });
    return;
  }

  if (request.type === "csv") {
    if (!currentLog) return;
    const response: WorkerResponse = { type: "csv", text: toCSV(currentLog) };
    self.postMessage(response);
  }
};
