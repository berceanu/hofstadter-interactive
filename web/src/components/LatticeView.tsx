import { scaleLinear } from "d3-scale";
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

export function LatticeView() {
  const { lattice } = useResultCache();
  const latticeName = useAppStore((state) => state.parameters.lattice);
  if (!lattice) {
    return <div className="view-loading">Constructing the real-space cell…</div>;
  }

  const sites = pairs(lattice.sites);
  const xExtent = extent(
    sites.map((site) => site[0]),
    [-2, 2],
  );
  const yExtent = extent(
    sites.map((site) => site[1]),
    [-2, 2],
  );
  const x = scaleLinear().domain(xExtent).nice().range([45, 470]);
  const y = scaleLinear().domain(yExtent).nice().range([470, 38]);
  const bzPoints = pairs(lattice.bz);
  const bzXExtent = extent(
    bzPoints.map((point) => point[0]),
    [-Math.PI, Math.PI],
  );
  const bzYExtent = extent(
    bzPoints.map((point) => point[1]),
    [-Math.PI, Math.PI],
  );
  const bx = scaleLinear().domain(bzXExtent).nice().range([570, 955]);
  const by = scaleLinear().domain(bzYExtent).nice().range([450, 58]);
  const unitCell = pairs(lattice.unitCell);
  const magneticCell = pairs(lattice.magneticCell);

  return (
    <div className="plot-shell lattice-shell" data-plot-export>
      <svg
        className="lattice-svg"
        viewBox="0 0 1000 550"
        role="img"
        aria-label={`${latticeName} real-space lattice and Brillouin zone`}
        data-export-layer
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
          First Brillouin zone
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
        <path d={pathFrom(magneticCell, x, y)} className="magnetic-cell" />
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
        <path d={pathFrom(bzPoints, bx, by)} className="bz-boundary" />
        {pairs(lattice.reciprocalVectors).map(([vx, vy], index) => (
          <g key={`b-${index}`}>
            <line
              x1={bx(0)}
              y1={by(0)}
              x2={bx(vx * 0.45)}
              y2={by(vy * 0.45)}
              className="vector-arrow reciprocal-arrow"
              markerEnd="url(#arrow)"
            />
            <text
              x={bx(vx * 0.45) + 8}
              y={by(vy * 0.45) - 8}
              className="vector-label"
            >
              b{index + 1}
            </text>
          </g>
        ))}
        <circle cx={bx(0)} cy={by(0)} r="5" className="gamma-point" />
        <text x={bx(0) + 10} y={by(0) - 10} className="vector-label">
          Γ
        </text>
        <g className="lattice-legend">
          <line x1="48" x2="76" y1="495" y2="495" className="unit-cell" />
          <text x="84" y="500">ordinary cell</text>
          <line x1="190" x2="218" y1="495" y2="495" className="magnetic-cell" />
          <text x="226" y="500">magnetic cell (q)</text>
        </g>
      </svg>
    </div>
  );
}
