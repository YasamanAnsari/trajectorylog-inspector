/**
 * Synthetic trajectory log generator. Produces a byte-valid NDS120 VMAT-style
 * log entirely in memory, with a planted "sticky leaf" delivery error so the
 * viewer demonstrably catches a real problem. Contains no patient data.
 */

import { AXIS } from "../parser/types";

/** Deterministic PRNG so the demo (and tests) are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_SNAPSHOTS = 1500; // 30 s at 20 ms
export const DEMO_TOTAL_MU = 240;
/** MLC sample index of the planted sticky leaf (leaf 29, X2 bank). */
export const STICKY_LEAF_SAMPLE = 30;

const MLC_SAMPLES = 122; // 2 carriages + 120 leaves (NDS120)
const AXIS_ENUMERATION = [
  AXIS.Collimator,
  AXIS.Gantry,
  AXIS.Y1,
  AXIS.Y2,
  AXIS.X1,
  AXIS.X2,
  AXIS.CouchVrt,
  AXIS.CouchLng,
  AXIS.CouchLat,
  AXIS.CouchRtn,
  AXIS.CouchPit,
  AXIS.CouchRol,
  AXIS.MU,
  AXIS.BeamHold,
  AXIS.ControlPoint,
  AXIS.MLC,
];
const SAMPLES_PER_AXIS = AXIS_ENUMERATION.map((axis) => (axis === AXIS.MLC ? MLC_SAMPLES : 1));

class ByteWriter {
  private readonly buffer: ArrayBuffer;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  offset = 0;

  constructor(size: number) {
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  int32(value: number): void {
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  float32(value: number): void {
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  /** Write string then zero-pad to exactly `size` bytes. */
  paddedString(text: string, size: number): void {
    const encoded = new TextEncoder().encode(text);
    if (encoded.length > size) {
      throw new Error(`String "${text.slice(0, 20)}..." exceeds field size ${size}.`);
    }
    this.bytes.set(encoded, this.offset);
    this.offset += size;
  }

  finish(): ArrayBuffer {
    return this.buffer;
  }
}

/** Aperture half-width (cm) per leaf: smooth lens-like field shape. */
function apertureHalfWidth(leaf: number, phase: number): number {
  const center = 29.5;
  const shape = Math.max(0, 1 - ((leaf - center) / 22) ** 2);
  return shape * (2.5 + 1.5 * Math.sin(phase * Math.PI));
}

export function generateDemoLog(snapshots: number = DEMO_SNAPSHOTS): ArrayBuffer {
  const rand = mulberry32(0xbeef);
  const noise = (scale: number): number => (rand() - 0.5) * 2 * scale;

  const numAxes = AXIS_ENUMERATION.length;
  const metadataReserve = 1024 - (64 + numAxes * 8);
  const snapshotBytes = SAMPLES_PER_AXIS.reduce((sum, s) => sum + s, 0) * 8 * snapshots;
  const subbeamCount = 1;
  const writer = new ByteWriter(1024 + subbeamCount * 560 + snapshotBytes);

  // --- Header (1024 bytes) ---
  writer.paddedString("VOSTL", 16);
  writer.paddedString("4.0", 16);
  writer.int32(1024); // header size
  writer.int32(20); // sampling interval ms
  writer.int32(numAxes);
  for (const axis of AXIS_ENUMERATION) writer.int32(axis);
  for (const samples of SAMPLES_PER_AXIS) writer.int32(samples);
  writer.int32(2); // axis scale: Modified IEC
  writer.int32(subbeamCount);
  writer.int32(0); // not truncated
  writer.int32(snapshots);
  writer.int32(2); // MLC model: NDS120
  writer.paddedString(
    [
      "Patient ID:DEMO-SYNTHETIC",
      "Plan Name:Demo VMAT Arc",
      "SOP Instance UID:0.0.000.000000.0.0.0000.demo.not.a.real.uid",
      `MU Planned:${DEMO_TOTAL_MU}`,
      "MU Remaining:0",
      "Energy:6X-FFF",
      "Beam Name:CW Arc (synthetic)",
      "",
    ].join("\n"),
    metadataReserve,
  );

  // --- Subbeam (560 bytes) ---
  writer.int32(0); // starting control point
  writer.float32(DEMO_TOTAL_MU);
  writer.float32(snapshots * 0.02);
  writer.int32(0); // sequence number
  writer.paddedString("Demo Arc Beam", 512 + 32);

  // --- Snapshots ---
  // Sticky window: the planted leaf freezes for the middle third of delivery.
  const stickFrom = Math.floor(snapshots / 3);
  const stickTo = Math.floor((2 * snapshots) / 3);
  let stuckPosition = 0;

  for (let s = 0; s < snapshots; s++) {
    const t = snapshots > 1 ? s / (snapshots - 1) : 0;
    const gantry = 181 - t * 358; // CW arc 181 deg -> -177 deg
    const mu = DEMO_TOTAL_MU * t;

    for (const axis of AXIS_ENUMERATION) {
      switch (axis) {
        case AXIS.Collimator:
          writer.float32(30);
          writer.float32(30 + noise(0.02));
          break;
        case AXIS.Gantry: {
          const wrapped = ((gantry % 360) + 360) % 360;
          writer.float32(wrapped);
          writer.float32(wrapped + noise(0.06));
          break;
        }
        case AXIS.Y1:
        case AXIS.Y2:
          writer.float32(10);
          writer.float32(10 + noise(0.01));
          break;
        case AXIS.X1:
        case AXIS.X2:
          writer.float32(6);
          writer.float32(6 + noise(0.01));
          break;
        case AXIS.CouchVrt:
        case AXIS.CouchLng:
        case AXIS.CouchLat:
          writer.float32(100);
          writer.float32(100 + noise(0.005));
          break;
        case AXIS.CouchRtn:
        case AXIS.CouchPit:
        case AXIS.CouchRol:
          writer.float32(180);
          writer.float32(180 + noise(0.005));
          break;
        case AXIS.MU:
          writer.float32(mu);
          writer.float32(mu + noise(0.03));
          break;
        case AXIS.BeamHold:
          writer.float32(0);
          writer.float32(0);
          break;
        case AXIS.ControlPoint:
          writer.float32(t * 177);
          writer.float32(t * 177);
          break;
        case AXIS.MLC: {
          // Samples 0-1: carriages. 2-61: X2 bank leaves. 62-121: X1 bank.
          for (let sample = 0; sample < MLC_SAMPLES; sample++) {
            if (sample < 2) {
              writer.float32(0);
              writer.float32(0);
              continue;
            }
            const leaf = sample < 62 ? sample - 2 : sample - 62;
            const expected = apertureHalfWidth(leaf, t);
            let actual = expected + noise(0.012);
            if (sample === STICKY_LEAF_SAMPLE) {
              if (s === stickFrom) stuckPosition = expected;
              if (s >= stickFrom && s < stickTo) actual = stuckPosition;
            }
            writer.float32(expected);
            writer.float32(actual);
          }
          break;
        }
        default:
          throw new Error(`Demo generator has no writer for axis ${axis}.`);
      }
    }
  }

  return writer.finish();
}
