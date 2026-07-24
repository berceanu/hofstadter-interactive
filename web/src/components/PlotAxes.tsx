import { scaleLinear } from "d3-scale";

interface PlotAxesProps {
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel: string;
  yLabel: string;
  xFormat?: (value: number) => string;
  yFormat?: (value: number) => string;
}

const left = 80;
const right = 970;
const top = 24;
const bottom = 546;

export function PlotAxes({
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  xFormat = (value) => value.toFixed(2),
  yFormat = (value) => value.toFixed(1),
}: PlotAxesProps) {
  const x = scaleLinear().domain(xDomain).range([left, right]);
  const y = scaleLinear().domain(yDomain).range([bottom, top]);
  const xTicks = x.ticks(6);
  const yTicks = y.ticks(6);

  return (
    <svg
      className="plot-axes"
      viewBox="0 0 1000 600"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-export-layer
    >
      <g className="plot-grid">
        {xTicks.map((tick) => (
          <line key={`x-${tick}`} x1={x(tick)} x2={x(tick)} y1={top} y2={bottom} />
        ))}
        {yTicks.map((tick) => (
          <line key={`y-${tick}`} x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
        ))}
      </g>
      <g className="plot-axis-lines">
        <line x1={left} x2={right} y1={bottom} y2={bottom} />
        <line x1={left} x2={left} y1={top} y2={bottom} />
      </g>
      <g className="plot-ticks">
        {xTicks.map((tick) => (
          <text key={`xt-${tick}`} x={x(tick)} y={574} textAnchor="middle">
            {xFormat(tick)}
          </text>
        ))}
        {yTicks.map((tick) => (
          <text
            key={`yt-${tick}`}
            x={67}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {yFormat(tick)}
          </text>
        ))}
      </g>
      <text className="axis-label" x={525} y={598} textAnchor="middle">
        {xLabel}
      </text>
      <text
        className="axis-label"
        x={18}
        y={286}
        textAnchor="middle"
        transform="rotate(-90 18 286)"
      >
        {yLabel}
      </text>
    </svg>
  );
}
