import { useEffect, useRef } from "react";
import type { FluenceMap } from "../analysis/fluence";

/**
 * Renders a fluence map as a grayscale image, normalized to its own min/max
 * (mirroring BuildFluenceImage in the reference library).
 */
export function FluenceCanvas({ map, label }: { map: FluenceMap; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = map.width;
    canvas.height = map.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let min = Infinity;
    let max = -Infinity;
    for (const v of map.data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;

    const image = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.data.length; i++) {
      const gray = Math.round(255 * ((map.data[i]! - min) / range));
      image.data[i * 4] = gray;
      image.data[i * 4 + 1] = gray;
      image.data[i * 4 + 2] = gray;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [map]);

  const sizeMm = `${Math.round(map.width * map.resolution)}×${Math.round(map.height * map.resolution)} mm`;
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
