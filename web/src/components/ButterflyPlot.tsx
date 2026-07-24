import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PlotAxes } from "./PlotAxes";
import { flattenButterfly, extent } from "../utils/arrays";
import { useResultCache } from "../state/resultCache";
import { useAppStore, type SelectedPoint } from "../state/store";

interface Transform {
  zoom: number;
  panX: number;
  panY: number;
}

interface PointData {
  x: Float64Array;
  y: Float64Array;
  energy: Float64Array;
  band: Int32Array;
  chern: Int32Array;
  gap?: Float64Array;
  topologyAvailable: boolean;
  yRange: [number, number];
}

const chernPalette = [
  "#2b3cff", "#3154ff", "#3770ff", "#3d8cff", "#43a8ff",
  "#49c4f2", "#50d8df", "#63ead3", "#83efcf", "#b2e9d5",
  "#d7e0db",
  "#eadcb8", "#f7d286", "#ffc257", "#ffa24f", "#ff8256",
  "#ff665f", "#f6537a", "#e8499d", "#d94ab8", "#be4bd3",
];

function chernColor(chern: number) {
  return new THREE.Color(chernPalette[Math.max(0, Math.min(20, chern + 10))]);
}

const resetTransform: Transform = { zoom: 1, panX: 0, panY: 0 };

function boundedTransform(transform: Transform): Transform {
  const zoom = Math.min(18, Math.max(1, transform.zoom));
  const panLimit = Math.max(0, 1 - 1 / zoom);
  return {
    zoom,
    panX: Math.max(-panLimit, Math.min(panLimit, transform.panX)),
    panY: Math.max(-panLimit, Math.min(panLimit, transform.panY)),
  };
}

function PointCloud({
  data,
  colorMode,
}: {
  data: PointData;
  colorMode: "spectral" | "chern";
}) {
  const geometry = useMemo(() => {
    const count = data.x.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const [yMin, yMax] = data.yRange;
    const energyRange = Math.max(1e-9, yMax - yMin);
    const cool = new THREE.Color("#5cf2ce");
    const warm = new THREE.Color("#ffd166");
    const mixed = new THREE.Color();
    const pointSizes = new Float32Array(count);
    const pointOpacities = new Float32Array(count);
    let gapMax = 1e-12;
    if (data.gap) {
      for (const gap of data.gap) gapMax = Math.max(gapMax, gap);
    }
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = data.x[index] * 2 - 1;
      positions[index * 3 + 1] =
        ((data.y[index] - yMin) / energyRange) * 2 - 1;
      const color =
        colorMode === "chern"
          ? chernColor(data.chern[index])
          : mixed.copy(cool).lerp(warm, (data.y[index] - yMin) / energyRange);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      const gapStrength = data.gap
        ? Math.sqrt(Math.max(0, data.gap[index]) / gapMax)
        : 0;
      pointSizes[index] = data.gap ? 1.8 + 6.2 * gapStrength : 2.5;
      pointOpacities[index] = data.gap ? 0.2 + 0.78 * gapStrength : 0.92;
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    next.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    next.setAttribute("pointSize", new THREE.BufferAttribute(pointSizes, 1));
    next.setAttribute("pointOpacity", new THREE.BufferAttribute(pointOpacities, 1));
    next.computeBoundingSphere();
    return next;
  }, [colorMode, data]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        vertexShader: `
          attribute float pointSize;
          attribute float pointOpacity;
          varying vec3 vColor;
          varying float vOpacity;
          void main() {
            vColor = color;
            vOpacity = pointOpacity;
            gl_PointSize = pointSize;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vOpacity;
          void main() {
            float radius = length(gl_PointCoord - vec2(0.5));
            if (radius > 0.5) discard;
            float edge = 1.0 - smoothstep(0.36, 0.5, radius);
            gl_FragColor = vec4(vColor, vOpacity * edge);
          }
        `,
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return <points geometry={geometry} material={material} />;
}

function CameraSync({ transform }: { transform: Transform }) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const size = useThree((state) => state.size);
  useLayoutEffect(() => {
    (camera as THREE.OrthographicCamera & { manual?: boolean }).manual = true;
    camera.left = transform.panX - 1 / transform.zoom;
    camera.right = transform.panX + 1 / transform.zoom;
    camera.top = transform.panY + 1 / transform.zoom;
    camera.bottom = transform.panY - 1 / transform.zoom;
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width, transform]);
  return null;
}

function PlotLegend({
  colorMode,
  energyRange,
  topologyAvailable,
  wannier,
}: {
  colorMode: "spectral" | "chern";
  energyRange: [number, number];
  topologyAvailable: boolean;
  wannier: boolean;
}) {
  const showChern = colorMode === "chern" && topologyAvailable;
  if (!topologyAvailable && wannier) {
    return (
      <div className="plot-legend unavailable" aria-label="Hall topology unavailable">
        Hall topology unavailable · dot area = gap width
      </div>
    );
  }
  return (
    <div
      className="plot-legend"
      aria-label={showChern ? "Chern number color scale" : "Energy color scale"}
    >
      <span>{showChern ? (wannier ? "Hall tᵣ" : "C") : "E / t₁"}</span>
      <i
        style={{
          background: showChern
            ? `linear-gradient(90deg, ${chernPalette.join(",")})`
            : "linear-gradient(90deg, #5cf2ce, #ffd166)",
        }}
      />
      <small>
        <b>{showChern ? "−10" : energyRange[0].toFixed(1)}</b>
        <b>{showChern ? "0" : ""}</b>
        <b>{showChern ? "+10" : energyRange[1].toFixed(1)}</b>
      </small>
      {wannier && <em>dot area = gap width</em>}
    </div>
  );
}

function buildSpatialIndex(data: PointData) {
  const grid = new Map<string, number[]>();
  const [yMin, yMax] = data.yRange;
  const ySpan = Math.max(1e-9, yMax - yMin);
  for (let index = 0; index < data.x.length; index += 1) {
    const x = Math.floor(data.x[index] * 72);
    const y = Math.floor(((data.y[index] - yMin) / ySpan) * 72);
    const key = `${x}:${y}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  }
  return grid;
}

export function ButterflyPlot({ wannier = false }: { wannier?: boolean }) {
  const { butterfly } = useResultCache();
  const colorMode = useAppStore((state) => state.colorMode);
  const currentFlux = useAppStore(
    (state) => state.parameters.p / state.parameters.q,
  );
  const setSelectedPoint = useAppStore((state) => state.setSelectedPoint);
  const [transform, setTransform] = useState<Transform>({
    ...resetTransform,
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const suppressInspectionUntil = useRef(0);
  const arrays = useMemo(() => flattenButterfly(butterfly), [butterfly]);
  const energyRange = useMemo(
    () => extent(arrays.energy, [-4, 4]),
    [arrays.energy],
  );
  const data = useMemo<PointData>(
    () =>
      wannier
        ? {
            x: arrays.gapFlux,
            y: arrays.dos,
            energy: arrays.gapEnergy,
            band: new Int32Array(arrays.dos.map((value) => Math.round(value * 1000))),
            chern: arrays.gapChern,
            gap: arrays.gap,
            topologyAvailable: arrays.topologyAvailable,
            yRange: [0, 1] as [number, number],
          }
        : {
            x: arrays.flux,
            y: arrays.energy,
            energy: arrays.energy,
            band: arrays.band,
            chern: arrays.chern,
            topologyAvailable: arrays.topologyAvailable,
            yRange: energyRange as [number, number],
          },
    [arrays, energyRange, wannier],
  );
  const spatialIndex = useMemo(() => buildSpatialIndex(data), [data]);
  const effectiveColorMode =
    (wannier || colorMode === "chern") && data.topologyAvailable
      ? "chern"
      : "spectral";

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const zoomWithWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      const delta = event.deltaY * (event.deltaMode === 1 ? 18 : 1);
      setTransform((current) => {
        const zoom = Math.min(18, Math.max(1, current.zoom * Math.exp(-delta * 0.0012)));
        const oldHalf = 1 / current.zoom;
        const newHalf = 1 / zoom;
        return boundedTransform({
          zoom,
          panX: current.panX + ndcX * (oldHalf - newHalf),
          panY: current.panY + ndcY * (oldHalf - newHalf),
        });
      });
    };
    stage.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => stage.removeEventListener("wheel", zoomWithWheel);
  }, []);

  const xDomain: [number, number] = [
    (transform.panX - 1 / transform.zoom + 1) / 2,
    (transform.panX + 1 / transform.zoom + 1) / 2,
  ];
  const yMid = (data.yRange[0] + data.yRange[1]) / 2;
  const yHalf = (data.yRange[1] - data.yRange[0]) / 2;
  const yDomain: [number, number] = [
    yMid + (transform.panY - 1 / transform.zoom) * yHalf,
    yMid + (transform.panY + 1 / transform.zoom) * yHalf,
  ];

  function inspectPoint(event: React.PointerEvent<HTMLDivElement>) {
    if (
      !data.x.length
      || drag.current
      || performance.now() < suppressInspectionUntil.current
    ) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const worldX = transform.panX + ndcX / transform.zoom;
    const worldY = transform.panY + ndcY / transform.zoom;
    const dataX = (worldX + 1) / 2;
    const dataY = yMid + worldY * yHalf;
    const bucketX = Math.floor(dataX * 72);
    const bucketY = Math.floor(
      ((dataY - data.yRange[0]) / Math.max(1e-9, data.yRange[1] - data.yRange[0])) *
        72,
    );
    let closest = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const candidates = spatialIndex.get(`${bucketX + dx}:${bucketY + dy}`) ?? [];
        candidates.forEach((index) => {
          const distance =
            ((data.x[index] - dataX) * rect.width) ** 2 +
            (((data.y[index] - dataY) /
              Math.max(1e-9, data.yRange[1] - data.yRange[0])) *
              rect.height) **
              2;
          if (distance < closestDistance) {
            closest = index;
            closestDistance = distance;
          }
        });
      }
    }
    if (closest >= 0 && closestDistance < 180) {
      const point: SelectedPoint = {
        flux: data.x[closest],
        energy: data.energy[closest],
        band: wannier
          ? Math.max(0, Math.round(data.y[closest] * 1000))
          : data.band[closest],
        chern: data.topologyAvailable ? data.chern[closest] : undefined,
        topologyAvailable: data.topologyAvailable,
        dos: wannier ? data.y[closest] : undefined,
        gap: wannier ? data.gap?.[closest] : undefined,
      };
      setSelectedPoint(point);
    }
  }

  return (
    <div className="plot-shell spectrum-shell" data-plot-export>
      <div
        ref={stageRef}
        className="plot-stage"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) {
            inspectPoint(event);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          drag.current = { x: event.clientX, y: event.clientY };
          suppressInspectionUntil.current = performance.now() + 120;
          setTransform((current) =>
            boundedTransform({
              ...current,
              panX: current.panX - (dx / rect.width) * (2 / current.zoom),
              panY: current.panY + (dy / rect.height) * (2 / current.zoom),
            }),
          );
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerLeave={() => {
          drag.current = undefined;
        }}
        onDoubleClick={() => setTransform({ ...resetTransform })}
        role="img"
        aria-label={
          wannier
            ? "Interactive Wannier diagram. Drag to pan and scroll to zoom."
            : "Interactive GPU-rendered Hofstadter butterfly. Drag to pan and scroll to zoom."
        }
      >
        <Canvas
          orthographic
          camera={{ position: [0, 0, 10], near: 0.1, far: 20 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          dpr={[1, 2]}
        >
          <color attach="background" args={["#08111d"]} />
          <CameraSync transform={transform} />
          <PointCloud data={data} colorMode={effectiveColorMode} />
        </Canvas>
      </div>
      <PlotAxes
        xDomain={xDomain}
        yDomain={yDomain}
        xLabel="magnetic flux  φ = p / q"
        yLabel={wannier ? "integrated density of states" : "energy  E / t₁"}
        yFormat={(value) => (wannier ? value.toFixed(2) : value.toFixed(1))}
        xMarker={currentFlux}
      />
      <button
        className="plot-reset"
        onClick={() => setTransform({ ...resetTransform })}
      >
        reset view
      </button>
      <PlotLegend
        colorMode={effectiveColorMode}
        energyRange={energyRange}
        topologyAvailable={data.topologyAvailable}
        wannier={wannier}
      />
      {!data.x.length && (
        <div className="plot-empty" role="status">
          <span className="loader-orbit" />
          Waiting for the first numerical batch…
        </div>
      )}
      <div className="interaction-hint">
        drag to pan · wheel / trackpad to zoom · double-click to reset
      </div>
    </div>
  );
}
