import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
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
  yRange: [number, number];
}

const chernPalette = [
  "#4b73ff",
  "#54bfff",
  "#63ead3",
  "#f0f0d8",
  "#ffc257",
  "#ff725c",
  "#d94ab8",
];

function chernColor(chern: number) {
  if (chern === 0) return new THREE.Color("#d7e0db");
  const index = Math.min(3, Math.abs(chern));
  return new THREE.Color(
    chern < 0 ? chernPalette[3 - index] : chernPalette[3 + index],
  );
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
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    next.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    next.computeBoundingSphere();
    return next;
  }, [colorMode, data]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        vertexColors
        size={2.25}
        sizeAttenuation={false}
        transparent
        opacity={0.92}
        depthWrite={false}
      />
    </points>
  );
}

function CameraSync({ transform }: { transform: Transform }) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  useEffect(() => {
    camera.left = transform.panX - 1 / transform.zoom;
    camera.right = transform.panX + 1 / transform.zoom;
    camera.top = transform.panY + 1 / transform.zoom;
    camera.bottom = transform.panY - 1 / transform.zoom;
    camera.updateProjectionMatrix();
  }, [camera, transform]);
  return null;
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
  const setSelectedPoint = useAppStore((state) => state.setSelectedPoint);
  const [transform, setTransform] = useState<Transform>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
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
            yRange: [0, 1] as [number, number],
          }
        : {
            x: arrays.flux,
            y: arrays.energy,
            energy: arrays.energy,
            band: arrays.band,
            chern: arrays.chern,
            yRange: energyRange as [number, number],
          },
    [arrays, energyRange, wannier],
  );
  const spatialIndex = useMemo(() => buildSpatialIndex(data), [data]);

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
    if (!data.x.length || drag.current) return;
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
        chern: data.chern[closest],
        dos: wannier ? data.y[closest] : undefined,
        gap: wannier ? data.gap?.[closest] : undefined,
      };
      setSelectedPoint(point);
    }
  }

  return (
    <div className="plot-shell spectrum-shell" data-plot-export>
      <div
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
          setTransform((current) => ({
            ...current,
            panX: current.panX - (dx / rect.width) * (2 / current.zoom),
            panY: current.panY + (dy / rect.height) * (2 / current.zoom),
          }));
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerLeave={() => {
          drag.current = undefined;
        }}
        onWheel={(event) => {
          event.preventDefault();
          setTransform((current) => ({
            ...current,
            zoom: Math.min(
              18,
              Math.max(1, current.zoom * Math.exp(-event.deltaY * 0.0012)),
            ),
          }));
        }}
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
          <PointCloud data={data} colorMode={wannier ? "chern" : colorMode} />
        </Canvas>
      </div>
      <PlotAxes
        xDomain={xDomain}
        yDomain={yDomain}
        xLabel="magnetic flux  φ = p / q"
        yLabel={wannier ? "integrated density of states" : "energy  E / t₁"}
        yFormat={(value) => (wannier ? value.toFixed(2) : value.toFixed(1))}
      />
      {!data.x.length && (
        <div className="plot-empty" role="status">
          <span className="loader-orbit" />
          Waiting for the first numerical batch…
        </div>
      )}
      <div className="interaction-hint">drag to pan · scroll to zoom · hover to inspect</div>
    </div>
  );
}
