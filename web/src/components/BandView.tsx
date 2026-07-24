import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { bin, type Bin } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneY, line } from "d3-shape";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { extent } from "../utils/arrays";
import { useResultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";

function Surface({
  values,
  samples,
}: {
  values: Float64Array;
  samples: number;
}) {
  const geometry = useMemo(() => {
    const [min, max] = extent(values, [-1, 1]);
    const span = Math.max(1e-9, max - min);
    const positions = new Float32Array(samples * samples * 3);
    const colors = new Float32Array(samples * samples * 3);
    const low = new THREE.Color("#3b69ff");
    const mid = new THREE.Color("#62e7c8");
    const high = new THREE.Color("#ffd166");
    const color = new THREE.Color();
    for (let ix = 0; ix < samples; ix += 1) {
      for (let iy = 0; iy < samples; iy += 1) {
        const index = ix * samples + iy;
        const normalized = (values[index] - min) / span;
        positions[index * 3] = (ix / (samples - 1) - 0.5) * 3.4;
        positions[index * 3 + 1] = (normalized - 0.5) * 1.7;
        positions[index * 3 + 2] = (iy / (samples - 1) - 0.5) * 3.4;
        if (normalized < 0.5) color.copy(low).lerp(mid, normalized * 2);
        else color.copy(mid).lerp(high, (normalized - 0.5) * 2);
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
      }
    }
    const indices: number[] = [];
    for (let ix = 0; ix < samples - 1; ix += 1) {
      for (let iy = 0; iy < samples - 1; iy += 1) {
        const a = ix * samples + iy;
        const b = (ix + 1) * samples + iy;
        const c = (ix + 1) * samples + iy + 1;
        const d = ix * samples + iy + 1;
        indices.push(a, b, d, b, c, d);
      }
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    next.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    next.setIndex(indices);
    next.computeVertexNormals();
    return next;
  }, [samples, values]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        roughness={0.58}
        metalness={0.08}
      />
    </mesh>
  );
}

function BandCut() {
  const { bands } = useResultCache();
  const selectedBand = useAppStore((state) => state.selectedBand);
  const setSelectedBand = useAppStore((state) => state.setSelectedBand);
  if (!bands) return null;

  const energyRange = extent(bands.pathEnergy, [-4, 4]);
  const selectedGroupStart = bands.groupStart[selectedBand] ?? selectedBand;
  const selectedGroupSize = bands.groupSize[selectedBand] ?? 1;
  const xMax = bands.pathX[bands.pathX.length - 1] || 1;
  const x = scaleLinear().domain([0, xMax]).range([58, 713]);
  const y = scaleLinear().domain(energyRange).nice().range([454, 30]);
  const lineMaker = line<[number, number]>()
    .x((point) => x(point[0]))
    .y((point) => y(point[1]));
  const pointsPerBand = bands.pathX.length;
  const paths = Array.from({ length: bands.bands }, (_, band) => {
    const points: [number, number][] = [];
    for (let index = 0; index < pointsPerBand; index += 1) {
      points.push([
        bands.pathX[index],
        bands.pathEnergy[band * pointsPerBand + index],
      ]);
    }
    return lineMaker(points) ?? "";
  });

  const thresholds: Bin<number, number>[] = bin<number, number>()
    .domain(energyRange)
    .value((value) => value)
    .thresholds(30)(Array.from(bands.energy));
  const densityMax = Math.max(1, ...thresholds.map((bucket) => bucket.length));
  const densityX = scaleLinear().domain([0, densityMax]).range([0, 176]);
  const densityArea = area<Bin<number, number>>()
    .x0(0)
    .x1((bucket) => densityX(bucket.length))
    .y((bucket) => y((bucket.x0! + bucket.x1!) / 2))
    .curve(curveMonotoneY)(thresholds);

  return (
    <svg
      className="band-cut"
      viewBox="0 0 940 500"
      role="img"
      aria-label="Band energies along the high-symmetry path with density of states"
      data-export-layer
    >
      <rect x="0" y="0" width="940" height="500" className="panel-bg" />
      <g className="band-grid">
        {Array.from(bands.pathTicks).map((tick, index) => (
          <line key={index} x1={x(tick)} x2={x(tick)} y1="30" y2="454" />
        ))}
        {y.ticks(5).map((tick) => (
          <line key={tick} x1="58" x2="713" y1={y(tick)} y2={y(tick)} />
        ))}
      </g>
      <g className="band-lines">
        {paths.map((path, band) => (
          <path
            key={band}
            d={path}
            className={
              band >= selectedGroupStart
              && band < selectedGroupStart + selectedGroupSize
                ? "selected-band"
                : ""
            }
            onClick={() => setSelectedBand(band)}
          />
        ))}
      </g>
      <g className="path-labels">
        {Array.from(bands.pathTicks).map((tick, index) => (
          <text key={index} x={x(tick)} y="480" textAnchor="middle">
            {bands.pathLabels[index]}
          </text>
        ))}
        {y.ticks(5).map((tick) => (
          <text key={tick} x="48" y={y(tick)} textAnchor="end">
            {tick.toFixed(1)}
          </text>
        ))}
      </g>
      <text className="axis-label" x="18" y="242" transform="rotate(-90 18 242)">
        energy E / t₁
      </text>
      <g transform="translate(740 0)">
        <text x="0" y="22" className="panel-kicker">
          DENSITY OF STATES
        </text>
        <path d={densityArea ?? ""} className="dos-area" />
        <line x1="0" x2="0" y1="30" y2="454" className="dos-axis" />
      </g>
    </svg>
  );
}

export function BandView() {
  const { bands } = useResultCache();
  const selectedBand = useAppStore((state) => state.selectedBand);
  const metric = useAppStore((state) => state.surfaceMetric);
  if (!bands) {
    return <div className="view-loading">Diagonalizing the momentum grid…</div>;
  }
  const count = bands.samples * bands.samples;
  const offset = Math.min(selectedBand, bands.bands - 1) * count;
  const source = metric === "energy" ? bands.energy : bands.berry;
  const surface = source.slice(offset, offset + count);
  const groupStart = bands.groupStart[selectedBand] ?? selectedBand;
  const groupSize = bands.groupSize[selectedBand] ?? 1;
  const groupEnd = groupStart + groupSize;
  const grouped = groupSize > 1;

  return (
    <div className="bands-layout">
      <section className="band-panel band-cut-panel" data-plot-export>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SYMMETRY CUT</span>
            <h2>Linked band structure</h2>
          </div>
          <span className="chern-badge">
            {grouped
              ? `C${groupStart + 1}–${groupEnd} = ${bands.chern[selectedBand] ?? 0}`
              : `C = ${bands.chern[selectedBand] ?? 0}`}
          </span>
        </div>
        <BandCut />
      </section>
      <section className="band-panel surface-panel" data-plot-export>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ROTATABLE SURFACE</span>
            <h2>
              {metric === "berry" && grouped
                ? `Bands ${groupStart + 1}–${groupEnd}`
                : `Band ${selectedBand + 1}`}{" "}
              · {metric === "energy" ? "E(k)" : "Berry flux"}
            </h2>
          </div>
          <span className="surface-hint">drag to rotate</span>
        </div>
        <div className="surface-canvas">
          <Canvas
            camera={{ position: [3.6, 2.5, 4.2], fov: 42 }}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            dpr={[1, 2]}
          >
            <color attach="background" args={["#0b1624"]} />
            <ambientLight intensity={1.3} />
            <directionalLight position={[4, 5, 3]} intensity={2.8} />
            <directionalLight position={[-3, 1, -2]} intensity={0.8} color="#5cf2ce" />
            <Surface values={surface} samples={bands.samples} />
            <gridHelper args={[4.4, 10, "#33506a", "#172a3a"]} position={[0, -0.9, 0]} />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              minDistance={3}
              maxDistance={9}
            />
          </Canvas>
        </div>
        <div className="surface-axes">
          <span>k₁ / |b₁|</span>
          <span>{metric === "energy" ? "E / t₁" : "ℬ₁₂"}</span>
          <span>k₂ / |b₂|</span>
        </div>
      </section>
    </div>
  );
}
