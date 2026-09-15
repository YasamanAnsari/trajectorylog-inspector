/**
 * CSV serialization matching the row layout of ToCSV in
 * WUSTL-ClinicalDev/TrajectoryLog.NET. Contains no patient identifiers.
 */

// Enum names (not display names) so header rows match the reference CSV.
import { AXIS, AxisScale, MLCModel, type TrajectoryLog } from "../parser/types";

/**
 * 7 significant digits, matching .NET's default float formatting in the
 * reference CSV. Printing the widened double (e.g. 0.10000000149011612) would
 * quadruple the file size while adding no real precision.
 */
function joinFloats(values: Float32Array): string {
  return Array.from(values, (v) => String(Number(v.toPrecision(7)))).join(",");
}

export function toCSV(log: TrajectoryLog): string {
  const { header } = log;
  const lines: string[] = [
    `Signature,${header.signature}`,
    `Version,${header.version}`,
    `Header Size,${header.headerSize}`,
    `Sampling Interval (mS),${header.sampleIntervalMS}`,
    `Number of Axes Sampled,${header.numberOfAxesSampled}`,
    `Axis Enumeration,[${header.axisEnumeration.join("\t ")}]`,
    `Samples Per Axis,[${header.samplesPerAxis.join("\t ")}]`,
    `Axis Scale,${AxisScale[header.axisScale] ?? header.axisScale}`,
    `Number of Subbeams,${header.numberOfSubbeams}`,
    `Is Truncated (1 = truncated / 0 = not truncated),${header.isTruncated}`,
    `Number of Snapshots,${header.numberOfSnapshots}`,
    `MLC Model,${MLCModel[header.mlcModel] ?? header.mlcModel}`,
  ];

  const axisRow = (axisId: number, label: string, unit: string): void => {
    const series = log.axes.get(axisId);
    if (!series || series.expected.length === 0) return;
    lines.push(`${label} Expected${unit},${joinFloats(series.expected[0]!)}`);
    lines.push(`${label} Actual${unit},${joinFloats(series.actual[0]!)}`);
  };

  axisRow(AXIS.Gantry, "Gantry", "[deg]");
  axisRow(AXIS.Collimator, "Collimator", "[deg]");
  axisRow(AXIS.X1, "X1", "[cm]");
  axisRow(AXIS.X2, "X2", "[cm]");
  axisRow(AXIS.Y1, "Y1", "[cm]");
  axisRow(AXIS.Y2, "Y2", "[cm]");
  axisRow(AXIS.CouchLat, "Couch Lat ", "[cm]");
  axisRow(AXIS.CouchLng, "Couch Lng ", "[cm]");
  axisRow(AXIS.CouchVrt, "Couch Vert ", "[cm]");
  axisRow(AXIS.CouchRtn, "Couch Rtn ", "[deg]");
  axisRow(AXIS.CouchPit, "Couch Pit ", "[deg]");
  axisRow(AXIS.CouchRol, "Couch Roll ", "[deg]");
  axisRow(AXIS.MU, "MU", "");
  axisRow(AXIS.BeamHold, "Beam Hold", "");
  axisRow(AXIS.ControlPoint, "Control Point", "");

  // The first two MLC samples are carriages on every model (the reference
  // skips them for RMS and fluence on SX2 too, but its CSV mislabels them
  // "Leaf -1" and "Leaf 0" there).
  const mlc = log.axes.get(AXIS.MLC);
  if (mlc) {
    for (let i = 0; i < mlc.expected.length; i++) {
      const label = i < 2 ? `Carriage ${i === 0 ? "A" : "B"}` : `Leaf ${i - 1}`;
      lines.push(`${label} Expected [cm],${joinFloats(mlc.expected[i]!)}`);
      lines.push(`${label} Actual [cm],${joinFloats(mlc.actual[i]!)}`);
    }
  }

  return lines.join("\r\n") + "\r\n";
}
