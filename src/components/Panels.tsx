import { useState } from "react";
import {
  axisScaleName,
  mlcModelName,
  type Subbeam,
  type TrajectoryHeader,
  type TrajectoryMetadata,
} from "../parser/types";

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value || "N/A"}</dd>
    </div>
  );
}

const MASK = "••••••••••";

/** Empty string (rendered as N/A) for absent numeric fields; never a fake 0. */
function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

export function MetadataPanel({ metadata }: { metadata: TrajectoryMetadata }) {
  const [showIdentifiers, setShowIdentifiers] = useState(false);

  return (
    <section className="panel" aria-labelledby="metadata-heading">
      <div className="panel-head">
        <h2 id="metadata-heading">Plan &amp; beam</h2>
        <button
          type="button"
          className="ghost-button"
          aria-pressed={showIdentifiers}
          onClick={() => setShowIdentifiers((v) => !v)}
        >
          {showIdentifiers ? "Hide identifiers" : "Show identifiers"}
        </button>
      </div>
      <dl className="field-grid">
        <Field label="Beam name" value={metadata.beamName} />
        <Field label="Plan name" value={metadata.planName} />
        <Field label="Energy" value={metadata.energy} />
        <Field label="MU planned" value={formatNumber(metadata.muPlanned)} />
        <Field label="MU remaining" value={formatNumber(metadata.muRemaining)} />
        <Field
          label="Patient ID"
          value={showIdentifiers ? metadata.patientId : metadata.patientId && MASK}
        />
        <Field
          label="SOP Instance UID"
          value={showIdentifiers ? metadata.sopInstanceUid : metadata.sopInstanceUid && MASK}
        />
      </dl>
      {!showIdentifiers && (
        <p className="panel-note">
          Patient identifiers are masked to protect screen shares. They were read locally and
          never left this device.
        </p>
      )}
    </section>
  );
}

export function HeaderPanel({ header }: { header: TrajectoryHeader }) {
  const deliverySeconds = (header.snapshotsRead * header.sampleIntervalMS) / 1000;
  const shortRead = header.snapshotsRead < header.numberOfSnapshots;
  return (
    <section className="panel" aria-labelledby="header-heading">
      <div className="panel-head">
        <h2 id="header-heading">Log header</h2>
      </div>
      <dl className="field-grid">
        <Field label="Log version" value={header.version} />
        <Field label="MLC model" value={mlcModelName(header.mlcModel)} />
        <Field label="Axis scale" value={axisScaleName(header.axisScale)} />
        <Field
          label="Snapshots"
          value={
            shortRead
              ? `${header.snapshotsRead.toLocaleString()} of ${header.numberOfSnapshots.toLocaleString()} declared`
              : header.numberOfSnapshots.toLocaleString()
          }
        />
        <Field label="Sampling interval" value={`${header.sampleIntervalMS} ms`} />
        <Field label="Recorded time" value={`${deliverySeconds.toFixed(1)} s`} />
        <Field label="Axes sampled" value={String(header.numberOfAxesSampled)} />
        <Field label="Subbeams" value={String(header.numberOfSubbeams)} />
        <Field
          label="Truncated"
          value={header.isTruncated === 1 ? "Yes (log is incomplete)" : "No"}
        />
      </dl>
      {header.isTruncated === 1 && (
        <p className="panel-note warn">
          The machine marked this log as truncated; results below cover only the{" "}
          {header.snapshotsRead.toLocaleString()} snapshots that were recorded, not the full
          delivery.
        </p>
      )}
    </section>
  );
}

export function SubbeamTable({ subbeams }: { subbeams: Subbeam[] }) {
  if (subbeams.length <= 1) return null;
  return (
    <section className="panel" aria-labelledby="subbeam-heading">
      <div className="panel-head">
        <h2 id="subbeam-heading">Subbeams</h2>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Name</th>
            <th scope="col">Starting control point</th>
            <th scope="col">MU</th>
            <th scope="col">Radiation time (s)</th>
          </tr>
        </thead>
        <tbody>
          {subbeams.map((sb) => (
            <tr key={sb.sequenceNumber}>
              <td className="num">{sb.sequenceNumber + 1}</td>
              <td>{sb.name || "N/A"}</td>
              <td className="num">{sb.controlPoint}</td>
              <td className="num">{sb.mu.toFixed(2)}</td>
              <td className="num">{sb.radTime.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
