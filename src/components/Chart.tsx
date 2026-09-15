import { useEffect, useRef } from "react";

export const EXPECTED_COLOR = "#1d5fd1";
export const ACTUAL_COLOR = "#d97706";

interface TraceChartProps {
  title: string;
  unit: string;
  sampleIntervalMS: number;
  series: { label: string; color: string; values: Float32Array }[];
  height?: number;
  /**
   * Break the line where neighbouring values jump by more than this amount,
   * so a rotational axis crossing 0/360 is not drawn as a vertical spike.
   */
  breakAbove?: number;
}

interface Bucket {
  min: number;
  max: number;
}

/** Min/max bucketing per pixel column: keeps spikes visible at any zoom. */
function downsample(values: Float32Array, buckets: number): Bucket[] {
  const result: Bucket[] = new Array(buckets);
  const perBucket = values.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * perBucket);
    const to = Math.max(from + 1, Math.floor((b + 1) * perBucket));
    let min = Infinity;
    let max = -Infinity;
    for (let i = from; i < to && i < values.length; i++) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    result[b] = { min, max };
  }
  return result;
}

function niceStep(range: number, maxTicks: number): number {
  const rough = range / maxTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const mult of [1, 2, 5, 10]) {
    if (power * mult >= rough) return power * mult;
  }
  return power * 10;
}

export function TraceChart({
  title,
  unit,
  sampleIntervalMS,
  series,
  height = 220,
  breakAbove,
}: TraceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = wrap.clientWidth;
      if (cssWidth === 0) return;
      canvas.width = cssWidth * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const pad = { left: 58, right: 12, top: 10, bottom: 26 };
      const plotW = cssWidth - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      if (plotW <= 10 || series.length === 0) return;

      let yMin = Infinity;
      let yMax = -Infinity;
      for (const s of series) {
        for (const v of s.values) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
      if (!Number.isFinite(yMin)) return;
      if (yMax - yMin < 1e-6) {
        yMax += 1;
        yMin -= 1;
      }
      const yPad = (yMax - yMin) * 0.06;
      yMin -= yPad;
      yMax += yPad;

      const n = series[0]!.values.length;
      const totalSeconds = (n * sampleIntervalMS) / 1000;
      const toX = (frac: number) => pad.left + frac * plotW;
      const toY = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

      // Grid + axes
      ctx.font = "11px 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "#63798f";
      ctx.strokeStyle = "#dfe8f3";
      ctx.lineWidth = 1;
      // Ticks are integer multiples of the step (not accumulated sums) so
      // labels come out exact, and -0 is normalised to 0.
      const yStep = niceStep(yMax - yMin, 5);
      const yDecimals = Math.max(0, -Math.floor(Math.log10(yStep)));
      for (let k = Math.ceil(yMin / yStep); k * yStep <= yMax; k++) {
        const v = k * yStep;
        const y = toY(v);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(cssWidth - pad.right, y);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText((v === 0 ? 0 : v).toFixed(yDecimals), pad.left - 6, y + 3);
      }
      const xStep = niceStep(totalSeconds, 8);
      for (let k = 0; k * xStep <= totalSeconds; k++) {
        const t = k * xStep;
        const x = toX(totalSeconds > 0 ? t / totalSeconds : 0);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, height - pad.bottom);
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillText(`${t.toFixed(0)}s`, x, height - 8);
      }

      // Traces. Earlier series are drawn wider so that when a later one
      // (actual) sits exactly on top of an earlier one (expected), both
      // remain visible as a line with a coloured halo.
      const buckets = Math.min(n, Math.floor(plotW));
      series.forEach((s, index) => {
        const sampled = downsample(s.values, buckets);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = index === series.length - 1 ? 1.4 : 3.2;
        ctx.beginPath();
        let started = false;
        for (let b = 0; b < sampled.length; b++) {
          const x = toX(buckets > 1 ? b / (buckets - 1) : 0);
          const { min, max } = sampled[b]!;
          const prev = b > 0 ? sampled[b - 1]! : null;
          const jumps =
            breakAbove !== undefined &&
            (max - min > breakAbove ||
              (prev !== null && Math.abs(min - prev.max) > breakAbove) ||
              (prev !== null && Math.abs(max - prev.min) > breakAbove));
          if (jumps) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(x, toY(min));
            started = true;
          }
          ctx.lineTo(x, toY(max));
          if (max !== min) ctx.lineTo(x, toY(min));
        }
        ctx.stroke();
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [series, sampleIntervalMS, height, breakAbove]);

  return (
    <figure className="chart" ref={wrapRef}>
      <figcaption className="chart-title">
        <span>
          {title} <span className="chart-unit">{unit}</span>
        </span>
        <span className="chart-legend">
          {series.map((s) => (
            <span key={s.label} className="legend-item">
              <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height }}
        role="img"
        aria-label={`${title} chart, ${series.map((s) => s.label).join(" and ")} over time`}
      />
    </figure>
  );
}
