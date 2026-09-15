/**
 * MU-weighted fluence reconstruction from MLC positions, ported from
 * BuildFluence / AddFluenceFromMLCData in WUSTL-ClinicalDev/TrajectoryLog.NET.
 *
 * Known limitation (inherited from the reference): jaw positions are NOT
 * applied, so fluence outside the jaw aperture is included.
 * NDS80 is unsupported, matching the reference.
 */

import { MLCModel, AXIS, type TrajectoryLog } from "../parser/types";

export interface FluenceMap {
  /** Pixels, row-major, data[y * width + x]. Values are normalized MU. */
  data: Float64Array;
  width: number;
  height: number;
  /** mm per pixel. */
  resolution: number;
}

export function fluenceSupported(model: MLCModel): boolean {
  return model === MLCModel.NDS120 || model === MLCModel.NDS120HD || model === MLCModel.SX2;
}

/** Leaf widths in half-mm units, mirroring the reference tables. */
function leafWidthsHalfMm(isEdge: boolean): number[] {
  const widths = new Array<number>(60);
  for (let i = 0; i < 10; i++) widths[i] = isEdge ? 10 : 20;
  for (let i = 10; i < 14; i++) widths[i] = 10;
  for (let i = 14; i < 46; i++) widths[i] = isEdge ? 5 : 10;
  for (let i = 46; i < 50; i++) widths[i] = 10;
  for (let i = 50; i < 60; i++) widths[i] = isEdge ? 10 : 20;
  return widths;
}

export function buildFluence(log: TrajectoryLog, which: "expected" | "actual"): FluenceMap {
  const model = log.header.mlcModel;
  if (!fluenceSupported(model)) {
    throw new Error(`Fluence reconstruction is not supported for MLC model ${model}.`);
  }

  const mlc = log.axes.get(AXIS.MLC);
  const mu = log.axes.get(AXIS.MU);
  if (!mlc || !mu || mu.expected.length === 0) {
    throw new Error("Log does not contain the MLC and MU axis data needed for fluence.");
  }
  // 2 carriages + 120 leaves (NDS120/HD) or 2 + 114 (SX2). The leaf index
  // arithmetic below reads up to these counts; extra trailing samples are
  // tolerated, as in the reference.
  const requiredSamples = model === MLCModel.SX2 ? 116 : 122;
  if (mlc.expected.length < requiredSamples) {
    throw new Error(
      `MLC axis has ${mlc.expected.length} samples but model ${model} requires ${requiredSamples}; fluence layout unknown.`,
    );
  }

  // Reference dimensions: fluence[fieldY, fieldX], rendered with
  // width = fieldY and height = fieldX (see BuildFluenceImage).
  let fieldX = 800;
  let fieldY = 800;
  if (model === MLCModel.SX2) {
    fieldX = 280;
    fieldY = 280;
  } else if (model === MLCModel.NDS120HD) {
    fieldX = 440;
  }
  const width = fieldY;
  const height = fieldX;
  const data = new Float64Array(width * height);

  const leaves = which === "expected" ? mlc.expected : mlc.actual;
  const muExpected = mu.expected[0]!;
  const muSeries = which === "expected" ? mu.expected[0]! : mu.actual[0]!;
  let totalMU = 0;
  for (const v of muSeries) totalMU = Math.max(totalMU, v);
  if (totalMU <= 0) {
    throw new Error("Total MU in the log is zero; cannot normalize fluence.");
  }

  const snapshots = leaves[2]!.length;
  const halfWidth = width / 2;
  const rows = height - 1;

  if (model === MLCModel.SX2) {
    let muStart = 0;
    for (let cp = 0; cp < snapshots; cp++) {
      // As in the reference, MU weights come from the expected MU trace for
      // both expected and actual fluence.
      const muCurrent = muExpected[cp]!;
      const delta = (muCurrent - muStart) / totalMU;
      for (let i = 0; i < 28; i++) {
        const colStart = halfWidth - Math.round(leaves[57 + i + 2]![cp]! * 10);
        const colEnd = halfWidth + Math.round(leaves[i + 2]![cp]! * 10);
        const colAfterStart = halfWidth - Math.round(leaves[57 + i + 31]![cp]! * 10);
        const colAfterEnd = halfWidth + Math.round(leaves[i + 31]![cp]! * 10);
        const colBeforeStart = halfWidth - Math.round(leaves[57 + i + 30]![cp]! * 10);
        const colBeforeEnd = halfWidth + Math.round(leaves[i + 30]![cp]! * 10);

        const lowerStart = Math.max(colStart, colBeforeStart);
        const upperStart = Math.max(colStart, colAfterStart);
        const lowerEnd = Math.min(colEnd, colBeforeEnd);
        const upperEnd = Math.min(colEnd, colAfterEnd);
        const rowStart = i * 10;

        for (let r = 0; r < 5; r++) {
          const y = rows - (rowStart + r);
          if (y < 0 || y >= height) continue;
          for (let x = Math.max(0, lowerStart); x < Math.min(width, lowerEnd); x++) {
            data[y * width + x] = data[y * width + x]! + delta;
          }
        }
        for (let r = 5; r < 10; r++) {
          const y = rows - (rowStart + r);
          if (y < 0 || y >= height) continue;
          for (let x = Math.max(0, upperStart); x < Math.min(width, upperEnd); x++) {
            data[y * width + x] = data[y * width + x]! + delta;
          }
        }
      }
      muStart = muCurrent;
    }
    return { data, width, height, resolution: 1 };
  }

  // NDS120 / NDS120HD
  const widths = leafWidthsHalfMm(model === MLCModel.NDS120HD);
  let muStart = 0;
  for (let cp = 0; cp < snapshots; cp++) {
    const muCurrent = muExpected[cp]!;
    const delta = (muCurrent - muStart) / totalMU;
    let currentRow = 0;
    for (let i = 0; i < 60; i++) {
      const rowEnd = currentRow + widths[i]!;
      const colStart = halfWidth - Math.round(leaves[i + 62]![cp]! * 20);
      const colEnd = halfWidth + Math.round(leaves[i + 2]![cp]! * 20);
      const xFrom = Math.max(0, colStart);
      const xTo = Math.min(width, colEnd);
      for (let j = currentRow; j < rowEnd; j++) {
        const y = rows - j;
        if (y < 0 || y >= height) continue;
        for (let x = xFrom; x < xTo; x++) {
          data[y * width + x] = data[y * width + x]! + delta;
        }
      }
      currentRow = rowEnd;
    }
    muStart = muCurrent;
  }
  return { data, width, height, resolution: 0.5 };
}
