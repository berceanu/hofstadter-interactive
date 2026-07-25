import { extent } from "../utils/arrays";
import { useResultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";

function pairs(values: Float64Array) {
  const output: [number, number][] = [];
  for (let index = 0; index < values.length; index += 2) {
    output.push([values[index], values[index + 1]]);
  }
  return output;
}

function pathFrom(
  points: [number, number][],
  x: (value: number) => number,
  y: (value: number) => number,
) {
  return points
    .map(([px, py], index) => `${index ? "L" : "M"}${x(px)},${y(py)}`)
    .join(" ");
}

interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function equalAspectProjection(points: [number, number][], box: PlotBox) {
  const xExtent = extent(points.map((point) => point[0]), [-1, 1]);
  const yExtent = extent(points.map((point) => point[1]), [-1, 1]);
  const xSpan = Math.max(1e-9, xExtent[1] - xExtent[0]);
  const ySpan = Math.max(1e-9, yExtent[1] - yExtent[0]);
  const scale = Math.min(box.width / xSpan, box.height / ySpan);
  const centerX = (xExtent[0] + xExtent[1]) / 2;
  const centerY = (yExtent[0] + yExtent[1]) / 2;
  const screenCenterX = box.left + box.width / 2;
  const screenCenterY = box.top + box.height / 2;
  return {
    x: (value: number) => screenCenterX + (value - centerX) * scale,
    y: (value: number) => screenCenterY - (value - centerY) * scale,
  };
}

export function LatticeView({ compact = false }: { compact?: boolean }) {
  const { lattice, latticeStale } = useResultCache();
  const parameters = useAppStore((state) => state.parameters);
  const latticeName = parameters.lattice;
  if (!lattice) {
    return <div className="view-loading">Constructing the real-space cell…</div>;
  }

  const sites = pairs(lattice.sites);
  const unitCell = pairs(lattice.unitCell);
  const magneticCell = pairs(lattice.magneticCell);
  const localProjection = equalAspectProjection(
    [...sites, ...unitCell],
    { left: 45, top: 94, width: 420, height: 365 },
  );
  const x = localProjection.x;
  const y = localProjection.y;
  const magneticBzPoints = pairs(lattice.bz);
  const ordinaryBzPoints = pairs(lattice.ordinaryBz);
  const reciprocalVectors = pairs(lattice.ordinaryReciprocalVectors);
  const magneticReciprocalVectors = pairs(lattice.reciprocalVectors);
  const symmetryPoints = lattice.symPoints.map((point) => {
    const k1 = point.k1 > 0.5 ? point.k1 - 1 : point.k1;
    const k2 = point.k2 > 0.5 ? point.k2 - 1 : point.k2;
    return {
      label: point.label,
      x:
        k1 * magneticReciprocalVectors[0][0]
        + k2 * magneticReciprocalVectors[1][0],
      y:
        k1 * magneticReciprocalVectors[0][1]
        + k2 * magneticReciprocalVectors[1][1],
    };
  });
  const reciprocalProjection = equalAspectProjection(
    [
      ...ordinaryBzPoints,
      ...magneticBzPoints,
      [0, 0],
      ...reciprocalVectors.map(
        ([vx, vy]) => [vx * 0.42, vy * 0.42] as [number, number],
      ),
      ...symmetryPoints.map(
        (point) => [point.x, point.y] as [number, number],
      ),
    ],
    { left: 535, top: 95, width: 420, height: 360 },
  );
  const bx = reciprocalProjection.x;
  const by = reciprocalProjection.y;
  const magneticProjection = equalAspectProjection(
    magneticCell,
    { left: 344, top: 126, width: 100, height: 112 },
  );

  return (
    <div
      className={[
        "plot-shell",
        "lattice-shell",
        compact ? "compact" : "",
        latticeStale ? "is-stale" : "",
      ].filter(Boolean).join(" ")}
      data-recomputing={latticeStale}
    >
      <svg
        className="lattice-svg"
        viewBox="0 0 1000 550"
        role="img"
        aria-label={`${latticeName} real-space lattice with ordinary and magnetic Brillouin zones`}
      >
        <defs>
          <pattern id="fine-grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M 22 0 L 0 0 0 22" fill="none" stroke="#ffffff0a" />
          </pattern>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ffd166" />
          </marker>
        </defs>
        <rect x="20" y="20" width="470" height="490" rx="18" className="panel-bg" />
        <rect x="510" y="20" width="470" height="490" rx="18" className="panel-bg" />
        <rect x="20" y="20" width="470" height="490" rx="18" fill="url(#fine-grid)" />
        <text x="44" y="52" className="panel-kicker">
          REAL SPACE
        </text>
        <text x="534" y="52" className="panel-kicker">
          RECIPROCAL SPACE
        </text>
        <text x="44" y="78" className="panel-title">
          {latticeName[0].toUpperCase() + latticeName.slice(1)} lattice
        </text>
        <text x="534" y="78" className="panel-title">
          Brillouin zones · magnetic folding ×{parameters.q}
        </text>
        <g className="hopping-links">
          {Array.from({ length: lattice.links.length / 6 }, (_, index) => {
            const offset = index * 6;
            return (
              <line
                key={index}
                x1={x(lattice.links[offset])}
                y1={y(lattice.links[offset + 1])}
                x2={x(lattice.links[offset + 2])}
                y2={y(lattice.links[offset + 3])}
                className={`neighbor-${Math.round(lattice.links[offset + 4])}`}
              />
            );
          })}
        </g>
        <path d={pathFrom(unitCell, x, y)} className="unit-cell" />
        <g className="lattice-sites">
          {sites.map(([px, py], index) => (
            <circle
              key={`${px}-${py}-${index}`}
              cx={x(px)}
              cy={y(py)}
              r={lattice.siteBasis[index] === 0 ? 4.5 : 3.6}
              className={`basis-${lattice.siteBasis[index] % 3}`}
            />
          ))}
        </g>
        {pairs(lattice.latticeVectors).map(([vx, vy], index) => (
          <g key={`a-${index}`}>
            <line
              x1={x(0)}
              y1={y(0)}
              x2={x(vx)}
              y2={y(vy)}
              className="vector-arrow"
              markerEnd="url(#arrow)"
            />
            <text x={x(vx) + 8} y={y(vy) - 8} className="vector-label">
              a{index + 1}
            </text>
          </g>
        ))}
        <g className="magnetic-inset">
          <rect x="326" y="92" width="136" height="166" rx="10" />
          <text x="338" y="111" className="panel-kicker">
            MAGNETIC CELL
          </text>
          <text x="338" y="127">
            q = {parameters.q} · a₂
          </text>
          <path
            d={pathFrom(
              magneticCell,
              magneticProjection.x,
              magneticProjection.y,
            )}
            className="magnetic-cell"
          />
        </g>
        <path
          d={pathFrom(ordinaryBzPoints, bx, by)}
          className="bz-boundary"
        />
        <path
          d={pathFrom(magneticBzPoints, bx, by)}
          className="magnetic-bz-boundary"
        />
        {reciprocalVectors.map(([vx, vy], index) => (
          <g key={`b-${index}`}>
            <line
              x1={bx(0)}
              y1={by(0)}
              x2={bx(vx * 0.42)}
              y2={by(vy * 0.42)}
              className="vector-arrow reciprocal-arrow"
              markerEnd="url(#arrow)"
            />
            <text
              x={bx(vx * 0.42) + 8}
              y={by(vy * 0.42) - 8}
              className="vector-label"
            >
              b{index + 1}
            </text>
          </g>
        ))}
        <g
          className="symmetry-points"
          style={{ opacity: Math.min(1, 12 / parameters.q) }}
        >
          {symmetryPoints.map((point) => (
            <g key={point.label}>
              <circle
                cx={bx(point.x)}
                cy={by(point.y)}
                r="4.5"
                className="gamma-point"
              />
              <text
                x={bx(point.x) + 9}
                y={by(point.y) - 9}
                className="vector-label"
              >
                {point.label}
              </text>
            </g>
          ))}
        </g>
        <g className="lattice-legend">
          <line x1="48" x2="76" y1="495" y2="495" className="unit-cell" />
          <text x="84" y="500">
            {lattice.basisCount > 1
              ? `${lattice.basisCount}-site primitive cell`
              : "primitive cell"}
          </text>
          <text x="190" y="500">equal spatial scale · MUC shown in inset</text>
        </g>
        <g className="bz-legend">
          <line x1="548" x2="576" y1="498" y2="498" className="bz-boundary" />
          <text x="584" y="502">ordinary BZ</text>
          <line
            x1="694"
            x2="722"
            y1="498"
            y2="498"
            className="magnetic-bz-boundary"
          />
          <text x="730" y="502">magnetic BZ (folded ×{parameters.q})</text>
        </g>
      </svg>
      {latticeStale && (
        <div className="recompute-chip" role="status">
          recomputing
        </div>
      )}
    </div>
  );
}
