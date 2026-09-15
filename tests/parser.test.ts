import { describe, expect, it } from "vitest";
import { parseTrajectoryLog, TrajectoryParseError } from "../src/parser/parse";
import { AXIS, AxisScale, MLCModel } from "../src/parser/types";
import {
  angularDifference,
  computeLogStats,
  mlcStats,
  scalarAxisStats,
} from "../src/analysis/rms";
import { toCSV } from "../src/analysis/csv";
import { buildFluence } from "../src/analysis/fluence";
import { generateDemoLog, DEMO_TOTAL_MU, STICKY_LEAF_SAMPLE } from "../src/demo/generator";

type Pair = [expected: number, actual: number];

interface LogSpec {
  version?: string;
  model?: MLCModel;
  snapshots: number;
  /** Header value when it should differ from the snapshots actually written. */
  declaredSnapshots?: number;
  isTruncated?: number;
  gantry?: (s: number) => Pair;
  mu?: (s: number) => Pair;
  beamHold?: (s: number) => Pair;
  /** MLC axis with this many samples (carriages included); values per sample. */
  mlc?: { samples: number; value: (sample: number, s: number) => Pair };
}

/**
 * Parametric byte-level log builder for layout variants the demo generator
 * does not cover (other MLC models, v2.x subbeams, truncation, beam holds).
 */
function buildLog(spec: LogSpec): ArrayBuffer {
  const version = spec.version ?? "3.1";
  const nameBytes = Number.parseFloat(version) >= 3 ? 512 : 32;
  const axes: { id: number; samples: number; value: (sample: number, s: number) => Pair }[] = [];
  if (spec.gantry) axes.push({ id: AXIS.Gantry, samples: 1, value: (_, s) => spec.gantry!(s) });
  if (spec.mu) axes.push({ id: AXIS.MU, samples: 1, value: (_, s) => spec.mu!(s) });
  if (spec.beamHold) {
    axes.push({ id: AXIS.BeamHold, samples: 1, value: (_, s) => spec.beamHold!(s) });
  }
  if (spec.mlc) axes.push({ id: AXIS.MLC, samples: spec.mlc.samples, value: spec.mlc.value });

  const numAxes = axes.length;
  const perSnapshot = axes.reduce((sum, a) => sum + a.samples, 0) * 8;
  const size = 1024 + (16 + nameBytes + 32) + spec.snapshots * perSnapshot;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let o = 0;
  const ascii = (text: string, width: number) => {
    for (let i = 0; i < text.length; i++) bytes[o + i] = text.charCodeAt(i);
    o += width;
  };
  const int32 = (v: number) => {
    view.setInt32(o, v, true);
    o += 4;
  };
  const float32 = (v: number) => {
    view.setFloat32(o, v, true);
    o += 4;
  };

  ascii("VOSTL", 16);
  ascii(version, 16);
  int32(1024);
  int32(20);
  int32(numAxes);
  for (const a of axes) int32(a.id);
  for (const a of axes) int32(a.samples);
  int32(AxisScale.ModifiedIEC);
  int32(1);
  int32(spec.isTruncated ?? 0);
  int32(spec.declaredSnapshots ?? spec.snapshots);
  int32(spec.model ?? MLCModel.NDS120);
  o = 1024;

  int32(0);
  float32(100);
  float32(spec.snapshots * 0.02);
  int32(0);
  ascii("Static Beam", nameBytes + 32);

  for (let s = 0; s < spec.snapshots; s++) {
    for (const a of axes) {
      for (let sample = 0; sample < a.samples; sample++) {
        const [expected, actual] = a.value(sample, s);
        float32(expected);
        float32(actual);
      }
    }
  }
  expect(o).toBe(size);
  return buffer;
}

/** Linear MU ramp 0..100 with no error. */
const linearMU = (snapshots: number) => (s: number): Pair => {
  const mu = (100 * s) / (snapshots - 1);
  return [mu, mu];
};

/**
 * Golden file: a minimal 2-axis (gantry + MU), 3-snapshot, 1-subbeam log
 * constructed byte-for-byte with raw DataView writes, independent of any
 * encoder in the app.
 */
function buildGoldenLog(): ArrayBuffer {
  const numAxes = 2;
  const snapshots = 3;
  const reserve = 1024 - (64 + numAxes * 8); // 944
  const size = 1024 + 560 + snapshots * numAxes * 8;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const ascii = (text: string, offset: number) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  let o = 0;
  ascii("VOSTL", o); o += 16;
  ascii("3.1", o); o += 16;
  view.setInt32(o, 1024, true); o += 4; // header size
  view.setInt32(o, 20, true); o += 4; // interval ms
  view.setInt32(o, numAxes, true); o += 4;
  view.setInt32(o, 1, true); o += 4; // axis: gantry
  view.setInt32(o, 40, true); o += 4; // axis: MU
  view.setInt32(o, 1, true); o += 4; // samples: gantry
  view.setInt32(o, 1, true); o += 4; // samples: MU
  view.setInt32(o, 2, true); o += 4; // scale: Modified IEC
  view.setInt32(o, 1, true); o += 4; // subbeams
  view.setInt32(o, 0, true); o += 4; // not truncated
  view.setInt32(o, snapshots, true); o += 4;
  view.setInt32(o, 3, true); o += 4; // MLC model: NDS120HD
  expect(o).toBe(64 + numAxes * 8);
  ascii(
    "Patient ID:GOLD-123\nPlan Name:Golden Plan\nSOP Instance UID:1.2.3.4\n" +
      "MU Planned:100.5\nMU Remaining:0\nEnergy:10X\nBeam Name:G1\n",
    o,
  );
  o = 64 + numAxes * 8 + reserve;
  expect(o).toBe(1024);

  // Subbeam: cp=5, mu=100.5, radtime=12.25, seq=0, name="Beam One"
  view.setInt32(o, 5, true); o += 4;
  view.setFloat32(o, 100.5, true); o += 4;
  view.setFloat32(o, 12.25, true); o += 4;
  view.setInt32(o, 0, true); o += 4;
  ascii("Beam One", o); o += 512 + 32;

  // Snapshots: gantry (exp, act) then MU (exp, act) per snapshot.
  const rows: number[][] = [
    [180, 180.5, 0, 0],
    [90, 89.75, 50, 49.5],
    [0, 0.25, 100, 100.25],
  ];
  for (const row of rows) {
    for (const value of row) {
      view.setFloat32(o, value, true);
      o += 4;
    }
  }
  expect(o).toBe(size);
  return buffer;
}

describe("parser: golden file", () => {
  const log = parseTrajectoryLog(buildGoldenLog());

  it("parses the header", () => {
    expect(log.header.signature).toBe("VOSTL");
    expect(log.header.version).toBe("3.1");
    expect(log.header.headerSize).toBe(1024);
    expect(log.header.sampleIntervalMS).toBe(20);
    expect(log.header.numberOfAxesSampled).toBe(2);
    expect(log.header.axisEnumeration).toEqual([1, 40]);
    expect(log.header.samplesPerAxis).toEqual([1, 1]);
    expect(log.header.axisScale).toBe(AxisScale.ModifiedIEC);
    expect(log.header.numberOfSubbeams).toBe(1);
    expect(log.header.isTruncated).toBe(0);
    expect(log.header.numberOfSnapshots).toBe(3);
    expect(log.header.mlcModel).toBe(MLCModel.NDS120HD);
  });

  it("parses metadata key:value lines", () => {
    expect(log.metadata.patientId).toBe("GOLD-123");
    expect(log.metadata.planName).toBe("Golden Plan");
    expect(log.metadata.sopInstanceUid).toBe("1.2.3.4");
    expect(log.metadata.muPlanned).toBeCloseTo(100.5);
    expect(log.metadata.muRemaining).toBe(0);
    expect(log.metadata.energy).toBe("10X");
    expect(log.metadata.beamName).toBe("G1");
  });

  it("parses subbeams", () => {
    expect(log.subbeams).toHaveLength(1);
    const sb = log.subbeams[0]!;
    expect(sb.controlPoint).toBe(5);
    expect(sb.mu).toBeCloseTo(100.5);
    expect(sb.radTime).toBeCloseTo(12.25);
    expect(sb.sequenceNumber).toBe(0);
    expect(sb.name).toBe("Beam One");
  });

  it("parses interleaved expected/actual snapshot data", () => {
    const gantry = log.axes.get(AXIS.Gantry)!;
    expect(Array.from(gantry.expected[0]!)).toEqual([180, 90, 0]);
    expect(Array.from(gantry.actual[0]!)).toEqual([180.5, 89.75, 0.25]);
    const mu = log.axes.get(AXIS.MU)!;
    expect(Array.from(mu.expected[0]!)).toEqual([0, 50, 100]);
    expect(Array.from(mu.actual[0]!)).toEqual([0, 49.5, 100.25]);
  });

  it("computes scalar RMS and max deviation like the reference", () => {
    const gantry = log.axes.get(AXIS.Gantry)!;
    const stats = scalarAxisStats(gantry.expected[0]!, gantry.actual[0]!);
    // diffs: +0.5, -0.25, +0.25 -> RMS = sqrt((0.25+0.0625+0.0625)/3)
    expect(stats.rms).toBeCloseTo(Math.sqrt(0.375 / 3), 6);
    expect(stats.maxDeviation).toBeCloseTo(0.5, 6);
    expect(stats.maxDeviationLocation).toBeCloseTo(180.5, 6);
  });

  it("exports CSV in the reference row layout", () => {
    const lines = toCSV(log).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Signature,VOSTL");
    expect(lines[5]).toBe("Axis Enumeration,[1\t 40]");
    expect(lines[11]).toBe("MLC Model,NDS120HD (HD120)");
    expect(lines[12]).toBe("Gantry Expected[deg],180,90,0");
    expect(lines[13]).toBe("Gantry Actual[deg],180.5,89.75,0.25");
    expect(lines[14]).toBe("MU Expected,0,50,100");
    expect(lines[15]).toBe("MU Actual,0,49.5,100.25");
    expect(lines).toHaveLength(16);
  });
});

describe("parser: malformed input", () => {
  it("rejects files that are too small", () => {
    expect(() => parseTrajectoryLog(new ArrayBuffer(100))).toThrow(TrajectoryParseError);
    expect(() => parseTrajectoryLog(new ArrayBuffer(100))).toThrow(/too small/);
  });

  it("rejects wrong signature", () => {
    const buffer = new ArrayBuffer(2048);
    new Uint8Array(buffer).set([0x50, 0x4b, 0x03, 0x04]); // ZIP magic
    expect(() => parseTrajectoryLog(buffer)).toThrow(/signature/);
  });

  it("rejects truncated snapshot data", () => {
    const full = buildGoldenLog();
    const truncated = full.slice(0, full.byteLength - 8);
    expect(() => parseTrajectoryLog(truncated)).toThrow(/truncated/i);
  });

  it("rejects garbage axis counts", () => {
    const buffer = buildGoldenLog().slice(0);
    new DataView(buffer).setInt32(40, 9999, true); // numberOfAxesSampled
    expect(() => parseTrajectoryLog(buffer)).toThrow(/axes/i);
  });

  it("rejects a header size other than 1024 instead of misreading offsets", () => {
    const buffer = buildGoldenLog().slice(0);
    new DataView(buffer).setInt32(32, 2048, true); // headerSize
    expect(() => parseTrajectoryLog(buffer)).toThrow(/header size/i);
  });

  it("rejects a huge declared snapshot count before allocating", () => {
    const buffer = buildGoldenLog().slice(0);
    new DataView(buffer).setInt32(72, 2_000_000_000, true); // numberOfSnapshots
    expect(() => parseTrajectoryLog(buffer)).toThrow(/truncated/i);
  });
});

describe("parser: format variants", () => {
  it("reads 32-byte subbeam names in logs before version 3.0", () => {
    const log = parseTrajectoryLog(
      buildLog({ version: "2.1", snapshots: 3, gantry: (s) => [10 * s, 10 * s + 0.5] }),
    );
    expect(log.subbeams[0]!.name).toBe("Static Beam");
    expect(Array.from(log.axes.get(AXIS.Gantry)!.actual[0]!)).toEqual([0.5, 10.5, 20.5]);
    // No metadata block before v4.0: numeric fields must be NaN, never a fake 0.
    expect(log.metadata.muPlanned).toBeNaN();
    expect(log.metadata.patientId).toBe("");
  });

  it("reads the recorded snapshots of a log the machine flagged as truncated", () => {
    const log = parseTrajectoryLog(
      buildLog({
        snapshots: 3,
        declaredSnapshots: 10,
        isTruncated: 1,
        gantry: (s) => [s, s],
      }),
    );
    expect(log.header.numberOfSnapshots).toBe(10);
    expect(log.header.snapshotsRead).toBe(3);
    expect(log.axes.get(AXIS.Gantry)!.expected[0]!.length).toBe(3);
  });

  it("still rejects short files that are not flagged as truncated", () => {
    const buffer = buildLog({ snapshots: 3, declaredSnapshots: 10, gantry: (s) => [s, s] });
    expect(() => parseTrajectoryLog(buffer)).toThrow(/truncated/i);
  });
});

describe("analysis: rotational axes", () => {
  it("takes the shortest angular difference across 0/360", () => {
    expect(angularDifference(0.01, 359.99)).toBeCloseTo(0.02, 6);
    expect(angularDifference(359.99, 0.01)).toBeCloseTo(-0.02, 6);
    expect(angularDifference(90, 0)).toBe(90);
    expect(angularDifference(180, 0)).toBe(180);
  });

  it("does not report a ~360 deg gantry error when an arc crosses 0/360", () => {
    // Second sample: expected still below 360, actual already past it.
    const expected = new Float32Array([359.9, 359.99, 0.02, 0.05]);
    const actual = new Float32Array([359.92, 0.01, 0.03, 0.03]);
    const naive = scalarAxisStats(expected, actual);
    expect(Math.abs(naive.maxDeviation)).toBeGreaterThan(359);
    const angular = scalarAxisStats(expected, actual, true);
    expect(Math.abs(angular.maxDeviation)).toBeLessThan(0.05);
    expect(angular.rms).toBeLessThan(0.05);
  });
});

describe("analysis: beam hold", () => {
  // Leaf error of 5 cm only while the beam is held (first two snapshots).
  const log = parseTrajectoryLog(
    buildLog({
      snapshots: 10,
      mu: linearMU(10),
      beamHold: (s) => [s < 2 ? 1 : 0, s < 2 ? 1 : 0],
      mlc: { samples: 122, value: (_, s) => [1, s < 2 ? 6 : 1] },
    }),
  );

  it("excludes beam-hold snapshots from MLC statistics by default", () => {
    const stats = mlcStats(log)!;
    expect(stats.beamHoldSnapshotsExcluded).toBe(2);
    expect(stats.averageLeafRms).toBe(0);
    expect(stats.maxDeviation).toBe(0);
  });

  it("includes them when asked", () => {
    const stats = mlcStats(log, false)!;
    expect(stats.beamHoldSnapshotsExcluded).toBe(0);
    expect(stats.maxDeviation).toBeCloseTo(5, 6);
    expect(stats.averageLeafRms).toBeCloseTo(Math.sqrt((2 * 25) / 10), 6);
  });
});

describe("fluence: geometry", () => {
  const N = 11;
  // Varian convention: positive values are retracted from the midline. Bank A
  // (samples 2..61) opens to +x in the image, bank B (62..121) opens to -x.
  const staticNDS = (model: MLCModel, x2: number, x1: number) =>
    parseTrajectoryLog(
      buildLog({
        model,
        snapshots: N,
        mu: linearMU(N),
        mlc: {
          samples: 122,
          value: (sample) => {
            const pos = sample < 2 ? 0 : sample < 62 ? x2 : x1;
            return [pos, pos];
          },
        },
      }),
    );

  it("places a static NDS120 aperture at the right columns with value 1.0", () => {
    const map = buildFluence(staticNDS(MLCModel.NDS120, 2, 3), "expected");
    expect(map.width).toBe(800);
    expect(map.height).toBe(800);
    const at = (x: number, y: number) => map.data[y * map.width + x]!;
    // columns [400 - 3*20, 400 + 2*20) = [340, 440), every row open
    for (const y of [0, 399, 799]) {
      expect(at(339, y)).toBe(0);
      expect(at(340, y)).toBeCloseTo(1, 9);
      expect(at(439, y)).toBeCloseTo(1, 9);
      expect(at(440, y)).toBe(0);
    }
  });

  it("maps leaf 1 to the bottom rows with its 1 cm width on NDS120", () => {
    const log = parseTrajectoryLog(
      buildLog({
        snapshots: N,
        mu: linearMU(N),
        mlc: {
          samples: 122,
          // Only the first leaf pair (samples 2 and 62) is open.
          value: (sample) => (sample === 2 || sample === 62 ? [5, 5] : [0, 0]),
        },
      }),
    );
    const map = buildFluence(log, "actual");
    const at = (x: number, y: number) => map.data[y * map.width + x]!;
    // 1 cm leaf = 20 half-mm rows, laid from the bottom: y in [780, 799]
    expect(at(400, 799)).toBeCloseTo(1, 9);
    expect(at(400, 780)).toBeCloseTo(1, 9);
    expect(at(400, 779)).toBe(0);
  });

  it("uses the 440-row HD layout for NDS120HD", () => {
    const map = buildFluence(staticNDS(MLCModel.NDS120HD, 1, 1), "expected");
    expect(map.width).toBe(800);
    expect(map.height).toBe(440);
    const at = (x: number, y: number) => map.data[y * map.width + x]!;
    for (const y of [0, 219, 439]) {
      expect(at(379, y)).toBe(0);
      expect(at(380, y)).toBeCloseTo(1, 9);
      expect(at(419, y)).toBeCloseTo(1, 9);
      expect(at(420, y)).toBe(0);
    }
  });

  it("builds a 280 mm SX2 (Halcyon) aperture at 1 mm resolution", () => {
    const log = parseTrajectoryLog(
      buildLog({
        model: MLCModel.SX2,
        snapshots: N,
        mu: linearMU(N),
        mlc: { samples: 116, value: (sample) => (sample < 2 ? [0, 0] : [5, 5]) },
      }),
    );
    const map = buildFluence(log, "expected");
    expect(map.width).toBe(280);
    expect(map.height).toBe(280);
    expect(map.resolution).toBe(1);
    const at = (x: number, y: number) => map.data[y * map.width + x]!;
    // columns [140 - 50, 140 + 50) = [90, 190), all 28 leaf rows open
    for (const y of [0, 139, 279]) {
      expect(at(89, y)).toBe(0);
      expect(at(90, y)).toBeCloseTo(1, 9);
      expect(at(189, y)).toBeCloseTo(1, 9);
      expect(at(190, y)).toBe(0);
    }
  });

  it("refuses a model/sample-count mismatch instead of indexing garbage", () => {
    const log = parseTrajectoryLog(
      buildLog({
        model: MLCModel.NDS120,
        snapshots: N,
        mu: linearMU(N),
        mlc: { samples: 82, value: () => [1, 1] },
      }),
    );
    expect(() => buildFluence(log, "expected")).toThrow(/requires 122/);
  });
});

describe("csv: formatting", () => {
  it("prints float32 values with 7 significant digits like the reference", () => {
    const log = parseTrajectoryLog(
      buildLog({ snapshots: 2, gantry: () => [0.1, 2.34], mu: () => [0, 0] }),
    );
    const lines = toCSV(log).split("\r\n");
    expect(lines.find((l) => l.startsWith("Gantry Expected"))).toBe("Gantry Expected[deg],0.1,0.1");
    expect(lines.find((l) => l.startsWith("Gantry Actual"))).toBe("Gantry Actual[deg],2.34,2.34");
  });

  it("labels the first two MLC samples as carriages on SX2 as well", () => {
    const log = parseTrajectoryLog(
      buildLog({
        model: MLCModel.SX2,
        snapshots: 1,
        mu: () => [0, 0],
        mlc: { samples: 116, value: () => [0, 0] },
      }),
    );
    const lines = toCSV(log).split("\r\n");
    expect(lines.some((l) => l.startsWith("Carriage A Expected"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Leaf -1"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Leaf 1 Expected"))).toBe(true);
  });
});

describe("demo log round-trip", () => {
  const log = parseTrajectoryLog(generateDemoLog(300));

  it("is a valid NDS120 log with all standard axes", () => {
    expect(log.header.signature).toBe("VOSTL");
    expect(log.header.mlcModel).toBe(MLCModel.NDS120);
    expect(log.header.numberOfSnapshots).toBe(300);
    expect(log.axes.get(AXIS.MLC)!.expected).toHaveLength(122);
    expect(log.metadata.patientId).toBe("DEMO-SYNTHETIC");
    expect(log.metadata.muPlanned).toBe(DEMO_TOTAL_MU);
  });

  it("surfaces the planted sticky leaf as the worst leaf", () => {
    const stats = mlcStats(log)!;
    expect(stats.maxDeviationSampleIndex).toBe(STICKY_LEAF_SAMPLE);
    expect(Math.abs(stats.maxDeviation)).toBeGreaterThan(0.1);
    // First 60 leaf samples are Varian bank A (under the X1 jaw).
    expect(stats.worstLeafLabel).toBe("Leaf A29 (X1 side)");
  });

  it("computes stats for all tracked axes", () => {
    const stats = computeLogStats(log);
    expect(stats.gantry).not.toBeNull();
    expect(stats.collimator).not.toBeNull();
    expect(stats.mu).not.toBeNull();
    expect(stats.gantry!.rms).toBeLessThan(0.1);
    expect(stats.mu!.rms).toBeLessThan(0.1);
  });

  it("builds normalized expected and actual fluence", () => {
    const expected = buildFluence(log, "expected");
    expect(expected.width).toBe(800);
    expect(expected.height).toBe(800);
    const maxValue = expected.data.reduce((max, v) => Math.max(max, v), 0);
    expect(maxValue).toBeGreaterThan(0);
    expect(maxValue).toBeLessThanOrEqual(1.0001);
    const actual = buildFluence(log, "actual");
    // The sticky leaf must make actual fluence differ from expected.
    let diff = 0;
    for (let i = 0; i < expected.data.length; i++) {
      diff += Math.abs(expected.data[i]! - actual.data[i]!);
    }
    expect(diff).toBeGreaterThan(0);
  });
});
