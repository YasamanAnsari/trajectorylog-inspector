import type { LogStats } from "../analysis/rms";

export interface Tolerances {
  gantryRms: number;
  gantryMax: number;
  collimatorRms: number;
  collimatorMax: number;
  muRms: number;
  muMax: number;
  mlcRms: number;
  mlcMax: number;
}

export const DEFAULT_TOLERANCES: Tolerances = {
  gantryRms: 0.3,
  gantryMax: 1.0,
  collimatorRms: 0.3,
  collimatorMax: 1.0,
  muRms: 0.5,
  muMax: 1.0,
  mlcRms: 0.05,
  mlcMax: 0.1,
};

interface Row {
  axis: string;
  unit: string;
  rmsLabel: string;
  rms: number;
  rmsTolKey: keyof Tolerances;
  max: number;
  maxLocation: string;
  maxTolKey: keyof Tolerances;
}

function Verdict({ value, tolerance }: { value: number; tolerance: number }) {
  const pass = Math.abs(value) <= tolerance;
  return (
    <span className={pass ? "verdict pass" : "verdict flag"}>{pass ? "PASS" : "FLAG"}</span>
  );
}

export function AccuracyTable({
  stats,
  tolerances,
  onToleranceChange,
}: {
  stats: LogStats;
  tolerances: Tolerances;
  onToleranceChange: (key: keyof Tolerances, value: number) => void;
}) {
  const rows: Row[] = [];
  if (stats.gantry) {
    rows.push({
      axis: "Gantry",
      unit: "deg",
      rmsLabel: "RMS",
      rms: stats.gantry.rms,
      rmsTolKey: "gantryRms",
      max: stats.gantry.maxDeviation,
      maxLocation: `at ${stats.gantry.maxDeviationLocation.toFixed(1)} deg`,
      maxTolKey: "gantryMax",
    });
  }
  if (stats.collimator) {
    rows.push({
      axis: "Collimator",
      unit: "deg",
      rmsLabel: "RMS",
      rms: stats.collimator.rms,
      rmsTolKey: "collimatorRms",
      max: stats.collimator.maxDeviation,
      maxLocation: `at ${stats.collimator.maxDeviationLocation.toFixed(1)} deg`,
      maxTolKey: "collimatorMax",
    });
  }
  if (stats.mu) {
    rows.push({
      axis: "MU",
      unit: "MU",
      rmsLabel: "RMS",
      rms: stats.mu.rms,
      rmsTolKey: "muRms",
      max: stats.mu.maxDeviation,
      maxLocation: `at ${stats.mu.maxDeviationLocation.toFixed(1)} MU`,
      maxTolKey: "muMax",
    });
  }
  if (stats.mlc) {
    rows.push({
      axis: "MLC",
      unit: "cm",
      rmsLabel: "Avg leaf RMS",
      rms: stats.mlc.averageLeafRms,
      rmsTolKey: "mlcRms",
      max: stats.mlc.maxDeviation,
      maxLocation: stats.mlc.worstLeafLabel,
      maxTolKey: "mlcMax",
    });
  }

  return (
    <table className="data-table accuracy-table">
      <caption className="visually-hidden">
        Delivery accuracy: RMS error and maximum deviation per axis, against configurable
        tolerances
      </caption>
      <thead>
        <tr>
          <th scope="col">Axis</th>
          <th scope="col">RMS error</th>
          <th scope="col">RMS tolerance</th>
          <th scope="col" aria-label="RMS verdict"></th>
          <th scope="col">Max deviation</th>
          <th scope="col">Max tolerance</th>
          <th scope="col" aria-label="Max deviation verdict"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.axis}>
            <th scope="row">{row.axis}</th>
            <td className="num">
              {row.rms.toFixed(4)} {row.unit}
              {row.axis === "MLC" && <span className="dim"> ({row.rmsLabel})</span>}
            </td>
            <td className="num">
              <input
                type="number"
                className="tolerance-input"
                aria-label={`${row.axis} RMS tolerance in ${row.unit}`}
                value={tolerances[row.rmsTolKey]}
                min={0}
                step={0.01}
                onChange={(e) => onToleranceChange(row.rmsTolKey, e.target.valueAsNumber)}
              />{" "}
              {row.unit}
            </td>
            <td>
              <Verdict value={row.rms} tolerance={tolerances[row.rmsTolKey]} />
            </td>
            <td className="num">
              {row.max >= 0 ? "+" : ""}
              {row.max.toFixed(4)} {row.unit} <span className="dim">{row.maxLocation}</span>
            </td>
            <td className="num">
              <input
                type="number"
                className="tolerance-input"
                aria-label={`${row.axis} max deviation tolerance in ${row.unit}`}
                value={tolerances[row.maxTolKey]}
                min={0}
                step={0.01}
                onChange={(e) => onToleranceChange(row.maxTolKey, e.target.valueAsNumber)}
              />{" "}
              {row.unit}
            </td>
            <td>
              <Verdict value={row.max} tolerance={tolerances[row.maxTolKey]} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
