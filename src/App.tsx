import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDrop } from "./components/FileDrop";
import { TraceChart, EXPECTED_COLOR, ACTUAL_COLOR } from "./components/Chart";
import { FluenceCanvas, fieldCrop } from "./components/FluenceCanvas";
import { AccuracyTable, DEFAULT_TOLERANCES, type Tolerances } from "./components/AccuracyTable";
import { HeaderPanel, MetadataPanel, SubbeamTable } from "./components/Panels";
import { PrivacyDialog } from "./components/PrivacyDialog";
import { generateDemoLog } from "./demo/generator";
import type { LogSummary, WorkerResponse } from "./worker/protocol";
import type { FluenceMap } from "./analysis/fluence";

type AppState =
  | { phase: "idle" }
  | { phase: "parsing"; fileName: string }
  | { phase: "ready"; fileName: string; fileSize: number; summary: LogSummary }
  | { phase: "error"; fileName: string; message: string };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function errorDiff(expected: Float32Array, actual: Float32Array): Float32Array {
  const diff = new Float32Array(expected.length);
  for (let i = 0; i < expected.length; i++) diff[i] = actual[i]! - expected[i]!;
  return diff;
}

export default function App() {
  const [state, setState] = useState<AppState>({ phase: "idle" });
  const [tolerances, setTolerances] = useState<Tolerances>(DEFAULT_TOLERANCES);
  const workerRef = useRef<Worker | null>(null);
  const pendingFile = useRef<{ name: string; size: number }>({ name: "", size: 0 });
  const csvName = useRef("trajectory-log.csv");

  useEffect(() => {
    const worker = new Worker(new URL("./worker/analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === "parsed") {
        setState({
          phase: "ready",
          fileName: pendingFile.current.name,
          fileSize: pendingFile.current.size,
          summary: response.summary,
        });
      } else if (response.type === "fluence") {
        setState((prev) =>
          prev.phase === "ready"
            ? { ...prev, summary: { ...prev.summary, fluence: response.fluence } }
            : prev,
        );
      } else if (response.type === "parse-error") {
        setState({
          phase: "error",
          fileName: pendingFile.current.name,
          message: response.message,
        });
      } else if (response.type === "csv") {
        const blob = new Blob([response.text], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = csvName.current;
        a.click();
        URL.revokeObjectURL(url);
      }
    };
    // A crashed worker (for example out of memory on a huge file) never
    // posts a message; without this the UI would stay on "Parsing" forever.
    worker.onerror = (event) => {
      setState({
        phase: "error",
        fileName: pendingFile.current.name,
        message: `The analysis worker failed: ${event.message || "unknown error"}. The file may be too large for this browser's memory.`,
      });
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const parseBuffer = useCallback((buffer: ArrayBuffer, name: string, size: number) => {
    pendingFile.current = { name, size };
    csvName.current = name.replace(/\.bin$/i, "") + ".csv";
    setState({ phase: "parsing", fileName: name });
    workerRef.current?.postMessage({ type: "parse", buffer }, [buffer]);
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setState({ phase: "parsing", fileName: file.name });
      file
        .arrayBuffer()
        .then((buffer) => parseBuffer(buffer, file.name, file.size))
        .catch((error: unknown) => {
          setState({
            phase: "error",
            fileName: file.name,
            message: `Could not read the file from disk: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
    },
    [parseBuffer],
  );

  const handleDemo = useCallback(() => {
    const buffer = generateDemoLog();
    parseBuffer(buffer, "synthetic-demo.bin", buffer.byteLength);
  }, [parseBuffer]);

  const handleToleranceChange = useCallback((key: keyof Tolerances, value: number) => {
    setTolerances((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
  }, []);

  const busy = state.phase === "parsing";

  // Chart series are memoized so tolerance edits do not trigger canvas redraws.
  const summary = state.phase === "ready" ? state.summary : null;
  const charts = useMemo(() => {
    if (!summary) return null;
    const pair = (s: { expected: Float32Array; actual: Float32Array }) => [
      { label: "Expected", color: EXPECTED_COLOR, values: s.expected },
      { label: "Actual", color: ACTUAL_COLOR, values: s.actual },
    ];
    return {
      gantry: summary.gantry && pair(summary.gantry),
      mu: summary.mu && pair(summary.mu),
      worstLeaf:
        summary.worstLeaf && summary.stats.mlc
          ? [
              {
                label: "Actual minus expected",
                color: ACTUAL_COLOR,
                values: errorDiff(summary.worstLeaf.expected, summary.worstLeaf.actual),
              },
            ]
          : null,
    };
  }, [summary]);

  const fluence = summary?.fluence.status === "ready" ? summary.fluence : null;
  const fluenceView = useMemo(() => {
    if (!fluence) return null;
    const { expected, actual } = fluence;
    const data = new Float64Array(expected.data.length);
    for (let i = 0; i < data.length; i++) data[i] = actual.data[i]! - expected.data[i]!;
    const diff: FluenceMap = { ...expected, data };
    return { diff, crop: fieldCrop([expected, actual]) };
  }, [fluence]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <svg
              className="brand-mark"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="2 12 6 12 9 5 13 19 16 12 22 12" />
            </svg>
            <h1>
              TrajectoryLog <span className="brand-sub">Inspector</span>
            </h1>
          </div>
          <p className="local-badge" role="status">
            <span className="local-dot" aria-hidden="true" />
            Local processing only. Files never leave this device.
          </p>
        </div>
      </header>

      <main className="app-main">
        <section className="hero" aria-labelledby="intro-heading">
          <div className="hero-copy">
            <h2 id="intro-heading">Trajectory log analysis, entirely in your browser</h2>
            <p className="hero-lead">
              Varian TrueBeam, Edge, and Halcyon machines record a binary trajectory log during
              every treatment delivery. This tool translates that <code>.bin</code> file into
              readable plan metadata, expected versus actual accuracy statistics, axis charts,
              and fluence images to support delivery QA review.
            </p>
            <ol className="how-to">
              <li>
                <span className="step-num">01</span>
                <span>
                  Copy a <code>.bin</code> log from the machine or your log archive.
                </span>
              </li>
              <li>
                <span className="step-num">02</span>
                <span>Drop it here. Parsing happens on this device.</span>
              </li>
              <li>
                <span className="step-num">03</span>
                <span>Review accuracy, charts, and fluence; export CSV.</span>
              </li>
            </ol>
          </div>

          <div className="hero-panel">
            <div className="drop-card">
              <FileDrop onFile={handleFile} disabled={busy} />
              <button
                type="button"
                className="demo-button"
                onClick={handleDemo}
                disabled={busy}
              >
                Try with a synthetic demo log
              </button>
              <p className="demo-note">
                No file needed. Generates a synthetic VMAT arc in memory, with a planted
                sticky-leaf error for the tool to catch.
              </p>
            </div>
            <div className="privacy-note">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <div>
                <p>
                  Your file is processed entirely inside your browser. It is never uploaded.
                  You can disconnect from the internet after loading this page and everything
                  still works.
                </p>
                <PrivacyDialog />
              </div>
            </div>
          </div>
        </section>

        {state.phase === "parsing" && (
          <p className="status-line" role="status">
            Parsing <span className="mono">{state.fileName}</span> locally…
          </p>
        )}

        {state.phase === "error" && (
          <div className="error-box" role="alert">
            <h2>Could not read {state.fileName}</h2>
            <p>{state.message}</p>
          </div>
        )}

        {state.phase === "ready" && (
          <div className="results">
            <p className="status-line" role="status">
              <span className="mono">{state.fileName}</span> ({formatBytes(state.fileSize)}).
              Processed locally; nothing was uploaded.
            </p>

            <div className="panel-grid">
              <MetadataPanel metadata={state.summary.metadata} />
              <HeaderPanel header={state.summary.header} />
            </div>

            <section className="panel" aria-labelledby="accuracy-heading">
              <div className="panel-head">
                <h2 id="accuracy-heading">Delivery accuracy</h2>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => workerRef.current?.postMessage({ type: "csv" })}
                >
                  Export CSV
                </button>
              </div>
              <AccuracyTable
                stats={state.summary.stats}
                tolerances={tolerances}
                onToleranceChange={handleToleranceChange}
              />
              <p className="panel-note">
                Tolerances are configurable defaults, not clinical action levels. Gantry and
                collimator errors use the shortest angular difference, so arcs crossing 0/360
                are not penalized.
                {state.summary.stats.mlc && state.summary.stats.mlc.beamHoldSnapshotsExcluded > 0 && (
                  <>
                    {" "}
                    MLC statistics exclude{" "}
                    {state.summary.stats.mlc.beamHoldSnapshotsExcluded.toLocaleString()}{" "}
                    beam-hold snapshots, where leaves reposition with the beam off.
                  </>
                )}{" "}
                The CSV export follows the TrajectoryLog.NET layout and contains no patient
                identifiers.
              </p>
            </section>

            <SubbeamTable subbeams={state.summary.subbeams} />

            <section className="panel" aria-labelledby="charts-heading">
              <div className="panel-head">
                <h2 id="charts-heading">Axis traces</h2>
              </div>
              <div className="chart-grid">
                {charts?.gantry && (
                  <TraceChart
                    title="Gantry rotation"
                    unit="[deg]"
                    sampleIntervalMS={state.summary.header.sampleIntervalMS}
                    series={charts.gantry}
                    breakAbove={180}
                  />
                )}
                {charts?.mu && (
                  <TraceChart
                    title="Cumulative MU"
                    unit="[MU]"
                    sampleIntervalMS={state.summary.header.sampleIntervalMS}
                    series={charts.mu}
                  />
                )}
                {charts?.worstLeaf && state.summary.stats.mlc && (
                  <TraceChart
                    title={`Position error, worst leaf (${state.summary.stats.mlc.worstLeafLabel})`}
                    unit="[cm]"
                    sampleIntervalMS={state.summary.header.sampleIntervalMS}
                    series={charts.worstLeaf}
                  />
                )}
              </div>
            </section>

            <section className="panel" aria-labelledby="fluence-heading">
              <div className="panel-head">
                <h2 id="fluence-heading">Fluence reconstruction</h2>
              </div>
              {state.summary.fluence.status === "pending" && (
                <p className="status-line" role="status">
                  Reconstructing fluence locally…
                </p>
              )}
              {state.summary.fluence.status === "unsupported" && (
                <p className="panel-note">{state.summary.fluence.reason}</p>
              )}
              {state.summary.fluence.status === "ready" && (
                <>
                  <div className="fluence-grid">
                    <FluenceCanvas
                      map={state.summary.fluence.expected}
                      label="Expected"
                      crop={fluenceView?.crop}
                    />
                    <FluenceCanvas
                      map={state.summary.fluence.actual}
                      label="Actual"
                      crop={fluenceView?.crop}
                    />
                    {fluenceView && (
                      <FluenceCanvas
                        map={fluenceView.diff}
                        label="Actual minus expected"
                        mode="signed"
                        crop={fluenceView.crop}
                      />
                    )}
                  </div>
                  <p className="panel-note">
                    MU-weighted fluence reconstructed from MLC leaf positions, following the
                    BuildFluence method in TrajectoryLog.NET, cropped to the treated field.
                    In the difference map, orange marks more fluence than planned and blue
                    marks less; brightness is relative to the largest difference. Known
                    limitations: jaw positions are not applied, and both maps are weighted by
                    the expected MU trace.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </main>

      <section className="about-band" aria-labelledby="about-heading">
        <div className="about-inner">
          <h2 id="about-heading" className="about-label">
            About the data
          </h2>
          <div>
            <p>
              The trajectory log records the expected (planned) and actual (delivered) value of
              every machine axis, including gantry, collimator, jaws, couch, monitor units,
              beam holds, and each MLC leaf, at a fixed sampling interval (typically 20 ms).
              Binary format interpretation is based on the open-source{" "}
              <a
                href="https://github.com/WUSTL-ClinicalDev/TrajectoryLog.NET"
                rel="noopener noreferrer"
              >
                TrajectoryLog.NET
              </a>{" "}
              project by WUSTL-ClinicalDev (Washington University in St. Louis).
            </p>
            <div className="disclaimer">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p>
                This tool supports QA review only. It is not a medical device, and its
                results must be independently verified before any clinical decision.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="app-footer">
        <p>
          All processing happens in your browser. This site has no backend, no database, no
          cookies, and no analytics. Format credit:{" "}
          <a
            href="https://github.com/WUSTL-ClinicalDev/TrajectoryLog.NET"
            rel="noopener noreferrer"
          >
            WUSTL-ClinicalDev/TrajectoryLog.NET
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
