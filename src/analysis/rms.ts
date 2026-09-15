/**
 * RMS / max-deviation statistics, mirroring CalculateRMS in
 * WUSTL-ClinicalDev/TrajectoryLog.NET (Trajectory.cs).
 */

import { MLCModel, AXIS, type TrajectoryLog } from "../parser/types";

export interface AxisStats {
  rms: number;
  maxDeviation: number;
  /** Actual axis value at the snapshot where the max deviation occurred. */
  maxDeviationLocation: number;
}

export interface MLCStats {
  /** Average of per-leaf RMS values (carriage samples excluded). */
  averageLeafRms: number;
  maxDeviation: number;
  /** MLC sample index (including carriage offset) where max deviation occurred. */
  maxDeviationSampleIndex: number;
  /** Human-readable worst leaf, e.g. "Leaf A31 (X1 side)". */
  worstLeafLabel: string;
  /** Per-leaf RMS keyed by MLC sample index. */
  perLeafRms: Map<number, number>;
  /** Snapshots left out of the MLC statistics because the beam was held. */
  beamHoldSnapshotsExcluded: number;
}

/** Shortest signed difference between two angles in degrees, in (-180, 180]. */
export function angularDifference(actual: number, expected: number): number {
  const diff = (actual - expected) % 360;
  if (diff > 180) return diff - 360;
  if (diff <= -180) return diff + 360;
  return diff;
}

/**
 * RMS + max deviation for a scalar axis (first sample of the series).
 * Rotational axes wrap at 0/360, so a VMAT arc crossing that boundary must
 * use the angular difference or a single sample reads as a ~360 deg error.
 */
export function scalarAxisStats(
  expected: Float32Array,
  actual: Float32Array,
  angular = false,
): AxisStats {
  let sumSquares = 0;
  let maxDeviation = 0;
  let maxDeviationLocation = 0;
  for (let i = 0; i < actual.length; i++) {
    const diff = angular
      ? angularDifference(actual[i]!, expected[i]!)
      : actual[i]! - expected[i]!;
    sumSquares += diff * diff;
    if (Math.abs(diff) > Math.abs(maxDeviation)) {
      maxDeviation = diff;
      maxDeviationLocation = actual[i]!;
    }
  }
  return {
    rms: actual.length > 0 ? Math.sqrt(sumSquares / actual.length) : 0,
    maxDeviation,
    maxDeviationLocation,
  };
}

/**
 * Label an MLC sample index (carriages are samples 0 and 1) as a leaf.
 *
 * TrueBeam-family MLCs use Varian's naming: the first 60 leaves in the log
 * are bank A, which sits under the X1 jaw, and the next 60 are bank B under
 * X2. The reference library labels these the other way round; that is a
 * documented error, not a convention we follow.
 *
 * Halcyon (SX2) has no independent source for its layer/bank layout, so the
 * reference's numbering is kept there.
 */
export function mlcSampleLabel(sampleIndex: number, model: MLCModel): string {
  if (model === MLCModel.SX2) {
    return sampleIndex > 58
      ? `Leaf ${sampleIndex - 58}, X1 side`
      : `Leaf ${sampleIndex - 1}, X2 side`;
  }
  return sampleIndex > 61
    ? `Leaf B${sampleIndex - 61} (X2 side)`
    : `Leaf A${sampleIndex - 1} (X1 side)`;
}

/**
 * Snapshot indices where the beam was on (Beam Hold actual == 0). Leaves
 * legitimately reposition while the beam is held, so those samples are not
 * delivery errors; pylinac excludes them from MLC statistics by default too.
 * Returns null when the log has no Beam Hold axis.
 */
function beamOnSnapshots(log: TrajectoryLog): number[] | null {
  const hold = log.axes.get(AXIS.BeamHold)?.actual[0];
  if (!hold) return null;
  const indices: number[] = [];
  for (let i = 0; i < hold.length; i++) if (hold[i] === 0) indices.push(i);
  return indices;
}

/**
 * MLC stats: per-leaf RMS averaged, skipping the two carriage samples.
 * With excludeBeamHold, only beam-on snapshots contribute.
 */
export function mlcStats(log: TrajectoryLog, excludeBeamHold = true): MLCStats | null {
  const mlc = log.axes.get(AXIS.MLC);
  if (!mlc || mlc.actual.length <= 2) return null;

  const total = mlc.actual[2]!.length;
  const beamOn = excludeBeamHold ? beamOnSnapshots(log) : null;
  const indices = beamOn ?? Array.from({ length: total }, (_, i) => i);
  if (indices.length === 0) return null;

  const perLeafRms = new Map<number, number>();
  let rmsSum = 0;
  let maxDeviation = 0;
  let maxDeviationSampleIndex = 2;

  for (let i = 2; i < mlc.actual.length; i++) {
    const actual = mlc.actual[i]!;
    const expected = mlc.expected[i]!;
    let sumSquares = 0;
    for (const j of indices) {
      const diff = actual[j]! - expected[j]!;
      sumSquares += diff * diff;
      if (Math.abs(diff) > Math.abs(maxDeviation)) {
        maxDeviation = diff;
        maxDeviationSampleIndex = i;
      }
    }
    const leafRms = Math.sqrt(sumSquares / indices.length);
    perLeafRms.set(i, leafRms);
    rmsSum += leafRms;
  }

  return {
    averageLeafRms: rmsSum / perLeafRms.size,
    maxDeviation,
    maxDeviationSampleIndex,
    worstLeafLabel: mlcSampleLabel(maxDeviationSampleIndex, log.header.mlcModel),
    perLeafRms,
    beamHoldSnapshotsExcluded: total - indices.length,
  };
}

export interface LogStats {
  gantry: AxisStats | null;
  collimator: AxisStats | null;
  mu: AxisStats | null;
  mlc: MLCStats | null;
}

export interface StatsOptions {
  /** Shortest angular difference for rotational axes (gantry, collimator). */
  angular: boolean;
  /** Leave beam-hold snapshots out of the MLC statistics. */
  excludeBeamHold: boolean;
}

/** Corrected statistics (this tool's default). */
export const CORRECTED_STATS: StatsOptions = { angular: true, excludeBeamHold: true };

/** Plain differences over every snapshot, reproducing TrajectoryLog.NET. */
export const REFERENCE_STATS: StatsOptions = { angular: false, excludeBeamHold: false };

export function computeLogStats(log: TrajectoryLog, options = CORRECTED_STATS): LogStats {
  const scalar = (axisId: number, rotational = false): AxisStats | null => {
    const series = log.axes.get(axisId);
    if (!series || series.expected.length === 0) return null;
    return scalarAxisStats(series.expected[0]!, series.actual[0]!, rotational && options.angular);
  };
  return {
    gantry: scalar(AXIS.Gantry, true),
    collimator: scalar(AXIS.Collimator, true),
    mu: scalar(AXIS.MU),
    mlc: mlcStats(log, options.excludeBeamHold),
  };
}
