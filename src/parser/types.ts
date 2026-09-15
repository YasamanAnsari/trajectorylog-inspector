/**
 * Type definitions for parsed Varian trajectory log files.
 * Binary layout ported from WUSTL-ClinicalDev/TrajectoryLog.NET (Trajectory.cs).
 */

export enum AxisScale {
  MachineScale = 1,
  ModifiedIEC = 2,
  MachineScaleIsocentric = 3,
}

export enum MLCModel {
  NDS80 = 0,
  NDS120 = 2,
  NDS120HD = 3,
  SX2 = 6, // Halcyon
}

/** Axis IDs as enumerated in the log header. */
export const AXIS_NAMES: Record<number, string> = {
  0: "Collimator Rtn",
  1: "Gantry Rtn",
  2: "Y1",
  3: "Y2",
  4: "X1",
  5: "X2",
  6: "Couch Vrt",
  7: "Couch Lng",
  8: "Couch Lat",
  9: "Couch Rtn",
  10: "Couch Pit",
  11: "Couch Rol",
  40: "MU",
  41: "Beam Hold",
  42: "Control Point",
  50: "MLC",
  60: "Target Position",
  61: "Tracking Target",
  62: "Tracking Base",
  63: "Tracking Phase",
  64: "Tracking Conformity Index",
};

export const AXIS = {
  Collimator: 0,
  Gantry: 1,
  Y1: 2,
  Y2: 3,
  X1: 4,
  X2: 5,
  CouchVrt: 6,
  CouchLng: 7,
  CouchLat: 8,
  CouchRtn: 9,
  CouchPit: 10,
  CouchRol: 11,
  MU: 40,
  BeamHold: 41,
  ControlPoint: 42,
  MLC: 50,
} as const;

export interface TrajectoryHeader {
  signature: string;
  version: string;
  headerSize: number;
  sampleIntervalMS: number;
  numberOfAxesSampled: number;
  axisEnumeration: number[];
  samplesPerAxis: number[];
  axisScale: AxisScale;
  numberOfSubbeams: number;
  isTruncated: number;
  /** Snapshot count declared in the header. */
  numberOfSnapshots: number;
  /**
   * Snapshots actually present in the file. Equals numberOfSnapshots unless
   * the machine flagged the log as truncated and stopped writing early.
   */
  snapshotsRead: number;
  mlcModel: MLCModel;
}

export interface TrajectoryMetadata {
  patientId: string;
  planName: string;
  sopInstanceUid: string;
  /** NaN when the field is absent or not numeric (logs before v4.0 have no metadata). */
  muPlanned: number;
  muRemaining: number;
  energy: string;
  beamName: string;
  /** Raw decoded key:value lines, for display of any extra fields. */
  rawLines: string[];
}

export interface Subbeam {
  controlPoint: number;
  mu: number;
  radTime: number;
  sequenceNumber: number;
  name: string;
}

/**
 * Time series for one axis: one Float32Array per sample (length =
 * numberOfSnapshots). Scalar axes have 1 sample; the MLC axis has one per
 * carriage/leaf.
 */
export interface AxisSeries {
  expected: Float32Array[];
  actual: Float32Array[];
}

export interface TrajectoryLog {
  header: TrajectoryHeader;
  metadata: TrajectoryMetadata;
  subbeams: Subbeam[];
  /** Keyed by axis ID (see AXIS_NAMES). */
  axes: Map<number, AxisSeries>;
}

export function mlcModelName(model: MLCModel): string {
  switch (model) {
    case MLCModel.NDS80:
      return "NDS80";
    case MLCModel.NDS120:
      return "NDS120 (Millennium)";
    case MLCModel.NDS120HD:
      return "NDS120HD (HD120)";
    case MLCModel.SX2:
      return "SX2 (Halcyon)";
    default:
      return `Unknown (${model})`;
  }
}

export function axisScaleName(scale: AxisScale): string {
  switch (scale) {
    case AxisScale.MachineScale:
      return "Machine Scale";
    case AxisScale.ModifiedIEC:
      return "Modified IEC 61217";
    case AxisScale.MachineScaleIsocentric:
      return "Machine Scale (Isocentric)";
    default:
      return `Unknown (${scale})`;
  }
}
