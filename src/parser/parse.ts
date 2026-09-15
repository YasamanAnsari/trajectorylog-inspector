/**
 * Pure binary parser for Varian trajectory log (.bin) files.
 * Byte layout ported from WUSTL-ClinicalDev/TrajectoryLog.NET (Trajectory.cs).
 * All values are little-endian. Runs in browser or Node (no DOM APIs).
 */

import {
  AxisScale,
  MLCModel,
  AXIS_NAMES,
  type AxisSeries,
  type Subbeam,
  type TrajectoryHeader,
  type TrajectoryLog,
  type TrajectoryMetadata,
} from "./types";

export class TrajectoryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrajectoryParseError";
  }
}

const SIGNATURE = "VOSTL";
const HEADER_TOTAL_BYTES = 1024;
const KNOWN_AXES = new Set(Object.keys(AXIS_NAMES).map(Number));

class Reader {
  private readonly view: DataView;
  private readonly ascii = new TextDecoder("ascii");
  private readonly utf8 = new TextDecoder("utf-8");
  offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  get byteLength(): number {
    return this.view.byteLength;
  }

  private ensure(bytes: number, what: string): void {
    if (this.offset + bytes > this.view.byteLength) {
      throw new TrajectoryParseError(
        `File ended unexpectedly while reading ${what}: needed ${bytes} bytes at offset ${this.offset}, but the file is only ${this.view.byteLength} bytes. The log may be truncated or not a trajectory log.`,
      );
    }
  }

  int32(what: string): number {
    this.ensure(4, what);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  float32(what: string): number {
    this.ensure(4, what);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  bytes(count: number, what: string): Uint8Array {
    this.ensure(count, what);
    const slice = new Uint8Array(this.view.buffer, this.offset, count);
    this.offset += count;
    return slice;
  }

  asciiString(count: number, what: string): string {
    return this.ascii.decode(this.bytes(count, what)).replace(/\0/g, "");
  }

  utf8String(count: number, what: string): string {
    return this.utf8.decode(this.bytes(count, what)).replace(/\0/g, "");
  }
}

function parseMetadata(text: string): TrajectoryMetadata {
  const lines = text
    .replace(/[\r\t]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(":"));

  const fields = new Map<string, string>();
  for (const line of lines) {
    const sep = line.indexOf(":");
    fields.set(line.slice(0, sep).trim().toLowerCase(), line.slice(sep + 1).trim());
  }

  const get = (...keys: string[]): string => {
    for (const key of keys) {
      const value = fields.get(key);
      if (value !== undefined) return value;
    }
    return "";
  };

  return {
    patientId: get("patient id", "patientid"),
    planName: get("plan name", "planname"),
    sopInstanceUid: get("sop instance uid", "sopinstanceuid"),
    muPlanned: Number.parseFloat(get("mu planned", "muplanned")),
    muRemaining: Number.parseFloat(get("mu remaining", "muremaining")),
    energy: get("energy"),
    beamName: get("beam name", "beamname"),
    rawLines: lines,
  };
}

function parseHeader(reader: Reader): { header: TrajectoryHeader; metadata: TrajectoryMetadata } {
  const signature = reader.asciiString(16, "signature");
  if (!signature.startsWith(SIGNATURE)) {
    throw new TrajectoryParseError(
      `This does not look like a Varian trajectory log: expected signature "${SIGNATURE}" in the first 16 bytes, found "${signature.slice(0, 16) || "(empty)"}".`,
    );
  }

  const version = reader.asciiString(16, "version").trim();
  const headerSize = reader.int32("header size");
  // Every offset below assumes the 1024-byte header from the Varian spec. A
  // different declared size would shift all snapshot reads and yield
  // plausible-looking garbage, so refuse rather than guess.
  if (headerSize !== HEADER_TOTAL_BYTES) {
    throw new TrajectoryParseError(
      `Unsupported header size ${headerSize} (expected ${HEADER_TOTAL_BYTES}). This log version is not supported.`,
    );
  }
  const sampleIntervalMS = reader.int32("sampling interval");
  const numberOfAxesSampled = reader.int32("number of axes sampled");

  if (numberOfAxesSampled <= 0 || numberOfAxesSampled > 100) {
    throw new TrajectoryParseError(
      `Invalid number of sampled axes (${numberOfAxesSampled}). The header is malformed.`,
    );
  }

  const axisEnumeration: number[] = [];
  for (let i = 0; i < numberOfAxesSampled; i++) {
    axisEnumeration.push(reader.int32(`axis enumeration [${i}]`));
  }
  const samplesPerAxis: number[] = [];
  for (let i = 0; i < numberOfAxesSampled; i++) {
    const samples = reader.int32(`samples per axis [${i}]`);
    if (samples < 0 || samples > 4096) {
      throw new TrajectoryParseError(
        `Invalid sample count (${samples}) for axis ${axisEnumeration[i]}. The header is malformed.`,
      );
    }
    samplesPerAxis.push(samples);
  }

  const axisScale = reader.int32("axis scale") as AxisScale;
  const numberOfSubbeams = reader.int32("number of subbeams");
  const isTruncated = reader.int32("truncation flag");
  const numberOfSnapshots = reader.int32("number of snapshots");
  const mlcModel = reader.int32("MLC model") as MLCModel;

  if (numberOfSubbeams < 0 || numberOfSubbeams > 1000) {
    throw new TrajectoryParseError(`Invalid subbeam count (${numberOfSubbeams}).`);
  }
  if (numberOfSnapshots < 0) {
    throw new TrajectoryParseError(`Invalid snapshot count (${numberOfSnapshots}).`);
  }

  // Remaining header reserve holds UTF-8 "Key:Value" metadata lines.
  const reserveSize = HEADER_TOTAL_BYTES - (64 + numberOfAxesSampled * 8);
  if (reserveSize < 0) {
    throw new TrajectoryParseError(
      `Header metadata block has negative size (${reserveSize} bytes); axis count ${numberOfAxesSampled} is inconsistent with the 1024-byte header.`,
    );
  }
  const metadata = parseMetadata(reader.utf8String(reserveSize, "metadata block"));

  return {
    header: {
      signature,
      version,
      headerSize,
      sampleIntervalMS,
      numberOfAxesSampled,
      axisEnumeration,
      samplesPerAxis,
      axisScale,
      numberOfSubbeams,
      isTruncated,
      numberOfSnapshots,
      snapshotsRead: numberOfSnapshots,
      mlcModel,
    },
    metadata,
  };
}

/** Subbeam name is 512 bytes from log version 3.0; earlier versions use 32. */
function subbeamNameBytes(version: string): number {
  const major = Number.parseFloat(version);
  if (!Number.isFinite(major)) {
    throw new TrajectoryParseError(`Unrecognized log version "${version}".`);
  }
  return major >= 3 ? 512 : 32;
}

function parseSubbeams(reader: Reader, count: number, version: string): Subbeam[] {
  const nameBytes = subbeamNameBytes(version);
  const subbeams: Subbeam[] = [];
  for (let i = 0; i < count; i++) {
    const what = `subbeam ${i + 1} of ${count}`;
    const controlPoint = reader.int32(what);
    const mu = reader.float32(what);
    const radTime = reader.float32(what);
    const sequenceNumber = reader.int32(what);
    const name = reader.asciiString(nameBytes, what).trim();
    reader.bytes(32, `${what} (reserved)`);
    subbeams.push({ controlPoint, mu, radTime, sequenceNumber, name });
  }
  return subbeams;
}

function parseSnapshots(reader: Reader, header: TrajectoryHeader): Map<number, AxisSeries> {
  const { axisEnumeration, samplesPerAxis, numberOfSnapshots } = header;

  // Size check comes before any allocation so a corrupt header cannot
  // trigger a multi-gigabyte allocation attempt.
  const bytesPerSnapshot = samplesPerAxis.reduce((sum, s) => sum + s, 0) * 8;
  const needed = bytesPerSnapshot * numberOfSnapshots;
  const available = reader.byteLength - reader.offset;
  let snapshots = numberOfSnapshots;
  if (available < needed) {
    // Only a log the machine itself flagged as truncated may be shorter than
    // declared; otherwise a short file most likely means a misread layout.
    const complete = bytesPerSnapshot > 0 ? Math.floor(available / bytesPerSnapshot) : 0;
    if (header.isTruncated !== 1 || complete === 0) {
      throw new TrajectoryParseError(
        `Snapshot data is incomplete: the header declares ${numberOfSnapshots} snapshots (${needed.toLocaleString()} bytes) but only ${available.toLocaleString()} bytes remain. The log file is truncated.`,
      );
    }
    snapshots = complete;
  }
  header.snapshotsRead = snapshots;

  const axes = new Map<number, AxisSeries>();
  for (const [i, axis] of axisEnumeration.entries()) {
    const samples = samplesPerAxis[i] ?? 0;
    axes.set(axis, {
      expected: Array.from({ length: samples }, () => new Float32Array(snapshots)),
      actual: Array.from({ length: samples }, () => new Float32Array(snapshots)),
    });
  }

  for (let snapshot = 0; snapshot < snapshots; snapshot++) {
    for (const [i, axis] of axisEnumeration.entries()) {
      const series = axes.get(axis)!;
      const samples = samplesPerAxis[i] ?? 0;
      for (let sample = 0; sample < samples; sample++) {
        series.expected[sample]![snapshot] = reader.float32("snapshot data");
        series.actual[sample]![snapshot] = reader.float32("snapshot data");
      }
    }
  }
  return axes;
}

/**
 * Parse a complete trajectory log from a binary buffer.
 * @throws TrajectoryParseError with a human-readable message on malformed input.
 */
export function parseTrajectoryLog(buffer: ArrayBuffer): TrajectoryLog {
  if (buffer.byteLength < HEADER_TOTAL_BYTES) {
    throw new TrajectoryParseError(
      `File is too small to be a trajectory log (${buffer.byteLength} bytes; the header alone is ${HEADER_TOTAL_BYTES} bytes).`,
    );
  }

  const reader = new Reader(buffer);
  const { header, metadata } = parseHeader(reader);

  const unknownAxes = header.axisEnumeration.filter((a) => !KNOWN_AXES.has(a));
  if (unknownAxes.length > 0) {
    throw new TrajectoryParseError(
      `Log declares unknown axis ID(s) ${unknownAxes.join(", ")}. This log version may not be supported.`,
    );
  }

  const subbeams = parseSubbeams(reader, header.numberOfSubbeams, header.version);
  const axes = parseSnapshots(reader, header);

  return { header, metadata, subbeams, axes };
}
