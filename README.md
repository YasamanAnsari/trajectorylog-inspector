# TrajectoryLog Inspector

A single-page web application that parses and analyzes Varian linear accelerator
trajectory log (`.bin`) files **entirely in the browser**. The file never leaves
the user's machine: there is no backend, no upload, no analytics, and the
production build ships a Content-Security-Policy with `connect-src 'none'` so
the browser itself enforces the guarantee. The app keeps working if you
disconnect from the network after page load.

Drop a trajectory log on the page and get an instant QA report: plan/beam
metadata (patient identifiers masked by default), log header summary, RMS and
max-deviation accuracy table against configurable tolerances, expected-vs-actual
charts for gantry and cumulative MU, the error trace of the worst MLC leaf,
side-by-side expected/actual fluence maps, a subbeam table, and a local CSV
export.

> For QA review support only. Not a medical device. Results must be
> independently verified before clinical decisions.

## Quick start

```bash
npm install
npm run dev        # local development server
npm test           # parser/analysis unit tests (Node, no browser needed)
npm run build      # production build to dist/
npm run check:no-network   # CI guard: greps the bundle for network APIs
```

Deploy `dist/` to any static HTTPS host (nginx, GitHub Pages, S3+CloudFront,
Azure Static Web Apps). No server-side code.

This repository is published to GitHub Pages from the `gh-pages` branch.
`npm run deploy` runs the tests, the production build, and the no-network
check, then pushes `dist/` as a fresh snapshot to that branch.

## Architecture

- `src/parser/`: pure TypeScript port of the binary layout (1024-byte header,
  metadata block on v4.0+, subbeams with 512-byte names on v3.0+ and 32-byte
  names before, interleaved expected/actual float32 snapshots). Importable and
  testable in Node; no DOM APIs.
- `src/analysis/`: RMS/max-deviation statistics, fluence reconstruction
  (NDS120, NDS120HD, SX2; NDS80 unsupported, matching the reference), CSV
  serialization.
- `src/demo/`: synthetic log generator (valid bytes, no patient data, planted
  sticky-leaf error) used by the demo button and as a test fixture.
- `src/worker/`: Web Worker so parsing and fluence never block the UI.
- `src/components/`: dashboard UI (React).
- `tests/`: unit tests against a byte-for-byte golden file constructed in the
  test itself.

## Analysis notes

Where this tool deliberately departs from TrajectoryLog.NET:

- Gantry and collimator errors use the shortest angular difference, so a VMAT
  arc crossing 0/360 does not register a ~360 degree deviation.
- MLC statistics exclude snapshots where Beam Hold was active (leaves
  reposition with the beam off). The count of excluded snapshots is shown
  under the accuracy table. This matches pylinac's default.
- A log the machine flagged as truncated is read up to the last complete
  snapshot and labeled as such, instead of being rejected.
- A header size other than 1024 bytes is rejected rather than parsed with
  shifted offsets.
- CSV floats are written with 7 significant digits (as .NET does) and the two
  carriage samples are labeled as carriages on every MLC model.
- Leaves are named with Varian's bank letters: the first 60 leaf samples are
  bank A (under the X1 jaw), the next 60 are bank B (under X2). The reference
  labels these banks the other way round.

Fluence follows the reference exactly, including its limitations: jaw
positions are not applied and both maps are weighted by the expected MU trace.

## Validation status

Tests cover a byte-constructed golden file, format variants (v2.x subbeams,
truncated logs), angular wrap, beam-hold exclusion, and static-aperture fluence
geometry for all three supported MLC models. The parser has not yet been
cross-checked against real machine logs or the C# library's CSV output; do
that before clinical use.

## Credits

Binary format interpretation is based on the open-source
[TrajectoryLog.NET](https://github.com/WUSTL-ClinicalDev/TrajectoryLog.NET)
project by WUSTL-ClinicalDev (Washington University in St. Louis).
