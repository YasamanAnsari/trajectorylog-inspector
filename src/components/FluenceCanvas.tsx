import { useEffect, useRef } from "react";
import type { FluenceMap } from "../analysis/fluence";

/** Grayscale normalised to the map's own min/max (as BuildFluenceImage does). */
function paintGray(image: ImageData, data: Float64Array): void {
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (let i = 0; i < data.length; i++) {
    const gray = Math.round(255 * ((data[i]! - min) / range));
    image.data[i * 4] = gray;
    image.data[i * 4 + 1] = gray;
    image.data[i * 4 + 2] = gray;
    image.data[i * 4 + 3] = 255;
  }
}

/**
 * Signed scale on black: orange where the value is positive (more fluence
 * than planned), blue where negative, intensity proportional to |value| / max.
 */
function paintSigned(image: ImageData, data: Float64Array): void {
  let maxAbs = 0;
  for (const v of data) maxAbs = Math.max(maxAbs, Math.abs(v));
  const scale = maxAbs || 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    const t = Math.abs(v) / scale;
    const [r, g, b] = v >= 0 ? [245, 158, 11] : [59, 130, 246];
    image.data[i * 4] = Math.round(r * t);
    image.data[i * 4 + 1] = Math.round(g * t);
    image.data[i * 4 + 2] = Math.round(b * t);
    image.data[i * 4 + 3] = 255;
  }
}

/** Pixel rectangle within a fluence map (x1/y1 exclusive). */
export interface Crop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Square window around every non-zero pixel in the given maps, with a
 * margin, so the treated field fills the canvas instead of a 40 cm frame.
 */
export function fieldCrop(maps: FluenceMap[], marginPx = 20): Crop {
  const { width, height } = maps[0]!;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (const map of maps) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (map.data[y * width + x] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: width, y1: height };

  const side = Math.min(Math.max(x1 - x0, y1 - y0) + 1 + 2 * marginPx, width, height);
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  const left = Math.round(Math.min(Math.max(0, cx - side / 2), width - side));
  const top = Math.round(Math.min(Math.max(0, cy - side / 2), height - side));
  return { x0: left, y0: top, x1: left + side, y1: top + side };
}

function cropData(map: FluenceMap, crop: Crop): Float64Array {
  const w = crop.x1 - crop.x0;
  const out = new Float64Array(w * (crop.y1 - crop.y0));
  for (let y = crop.y0; y < crop.y1; y++) {
    out.set(map.data.subarray(y * map.width + crop.x0, y * map.width + crop.x1), (y - crop.y0) * w);
  }
  return out;
}

export function FluenceCanvas({
  map,
  label,
  mode = "gray",
  crop,
}: {
  map: FluenceMap;
  label: string;
  mode?: "gray" | "signed";
  crop?: Crop;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = crop ? crop.x1 - crop.x0 : map.width;
  const height = crop ? crop.y1 - crop.y0 : map.height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = crop ? cropData(map, crop) : map.data;
    const image = ctx.createImageData(width, height);
    if (mode === "signed") paintSigned(image, data);
    else paintGray(image, data);
    ctx.putImageData(image, 0, 0);
  }, [map, mode, crop, width, height]);

  const sizeMm = `${Math.round(width * map.resolution)}×${Math.round(height * map.resolution)} mm`;
  return (
    <figure className="fluence-figure">
      <canvas
        ref={canvasRef}
        className="fluence-canvas"
        role="img"
        aria-label={`${label} fluence map, ${sizeMm}`}
      />
      <figcaption>
        {label} <span className="dim">({sizeMm})</span>
      </figcaption>
    </figure>
  );
}
