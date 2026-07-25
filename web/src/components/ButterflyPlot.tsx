import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PlotAxes } from "./PlotAxes";
import { flattenButterfly, extent } from "../utils/arrays";
import { useResultCache } from "../state/resultCache";
import { useAppStore, type SelectedPoint } from "../state/store";
import type { ButterflyColorMode } from "../compute/contracts";

interface AxisTransform {
  zoom: number;
  pan: number;
}

interface PointData {
  x: Float64Array;
  y: Float64Array;
  energy: Float64Array;
  band?: Int32Array;
  chern: Int32Array;
  gap?: Float64Array;
  topologyAvailable: boolean;
  yRange: [number, number];
}

const topologicalPalette = [
  "#2b3cff", "#3154ff", "#3770ff", "#3d8cff", "#43a8ff",
  "#49c4f2", "#50d8df", "#63ead3", "#83efcf", "#b2e9d5",
  "#d7e0db",
  "#eadcb8", "#f7d286", "#ffc257", "#ffa24f", "#ff8256",
  "#ff665f", "#f6537a", "#e8499d", "#d94ab8", "#be4bd3",
];

function chernColor(chern: number) {
  return new THREE.Color(
    topologicalPalette[Math.max(0, Math.min(20, chern + 10))],
  );
}

const resetAxis: AxisTransform = { zoom: 1, pan: 0 };

function boundedAxis(transform: AxisTransform): AxisTransform {
  const zoom = Math.min(18, Math.max(1, transform.zoom));
  const panLimit = Math.max(0, 1 - 1 / zoom);
  return {
    zoom,
    pan: Math.max(-panLimit, Math.min(panLimit, transform.pan)),
  };
}

function greatestCommonDivisor(first: number, second: number) {
  let a = Math.abs(Math.trunc(first));
  let b = Math.abs(Math.trunc(second));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function nearestCoprimeNumerator(flux: number, q: number) {
  const target = Math.max(1, Math.min(q - 1, Math.round(flux * q)));
  if (greatestCommonDivisor(target, q) === 1) return target;
  for (let distance = 1; distance < q; distance += 1) {
    const lower = target - distance;
    const upper = target + distance;
    if (lower >= 1 && greatestCommonDivisor(lower, q) === 1) return lower;
    if (upper < q && greatestCommonDivisor(upper, q) === 1) return upper;
  }
  return 1;
}

function PointCloud({
  data,
  colorMode,
  opacityMultiplier = 1,
}: {
  data: PointData;
  colorMode: "spectral" | "chern";
  opacityMultiplier?: number;
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
      pointOpacities[index] = (
        data.gap ? 0.2 + 0.78 * gapStrength : 0.92
      ) * opacityMultiplier;
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    next.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    next.setAttribute("pointSize", new THREE.BufferAttribute(pointSizes, 1));
    next.setAttribute("pointOpacity", new THREE.BufferAttribute(pointOpacities, 1));
    next.computeBoundingSphere();
    return next;
  }, [colorMode, data, opacityMultiplier]);

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

function GapSegments({
  flux,
  energy,
  gap,
  chern,
  yRange,
  yZoom,
  onVisibleCount,
}: {
  flux: Float64Array;
  energy: Float64Array;
  gap: Float64Array;
  chern: Int32Array;
  yRange: [number, number];
  yZoom: number;
  onVisibleCount: (count: number) => void;
}) {
  const size = useThree((state) => state.size);
  const segmentGeometry = useMemo(() => {
    const [yMin, yMax] = yRange;
    const span = Math.max(1e-9, yMax - yMin);
    let visible = 0;
    for (let index = 0; index < gap.length; index += 1) {
      const pixelHeight =
        (Math.abs(gap[index]) / span) * size.height * yZoom;
      if (pixelHeight >= 0.75) visible += 1;
    }

    const positions = new Float32Array(visible * 6);
    const colors = new Float32Array(visible * 6);
    let cursor = 0;
    for (let index = 0; index < gap.length; index += 1) {
      const width = Math.abs(gap[index]);
      const pixelHeight = (width / span) * size.height * yZoom;
      if (pixelHeight < 0.75) continue;
      const x = flux[index] * 2 - 1;
      const lower = ((energy[index] - width / 2 - yMin) / span) * 2 - 1;
      const upper = ((energy[index] + width / 2 - yMin) / span) * 2 - 1;
      const color = chernColor(chern[index]);
      const offset = cursor * 6;
      positions.set([x, lower, 0, x, upper, 0], offset);
      colors.set(
        [color.r, color.g, color.b, color.r, color.g, color.b],
        offset,
      );
      cursor += 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return { geometry, visible };
  }, [chern, energy, flux, gap, size.height, yRange, yZoom]);

  useEffect(() => {
    onVisibleCount(segmentGeometry.visible);
  }, [onVisibleCount, segmentGeometry.visible]);
  useEffect(
    () => () => segmentGeometry.geometry.dispose(),
    [segmentGeometry.geometry],
  );

  return (
    <lineSegments geometry={segmentGeometry.geometry}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function CameraSync({
  xTransform,
  yTransform,
}: {
  xTransform: AxisTransform;
  yTransform: AxisTransform;
}) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const size = useThree((state) => state.size);
  useLayoutEffect(() => {
    (camera as THREE.OrthographicCamera & { manual?: boolean }).manual = true;
    camera.left = xTransform.pan - 1 / xTransform.zoom;
    camera.right = xTransform.pan + 1 / xTransform.zoom;
    camera.top = yTransform.pan + 1 / yTransform.zoom;
    camera.bottom = yTransform.pan - 1 / yTransform.zoom;
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width, xTransform, yTransform]);
  return null;
}

function PlotLegend({
  colorMode,
  energyRange,
  topologyAvailable,
  wannier,
}: {
  colorMode: ButterflyColorMode;
  energyRange: [number, number];
  topologyAvailable: boolean;
  wannier: boolean;
}) {
  const showChern = colorMode !== "spectral" && topologyAvailable;
  const hallScale = wannier || colorMode === "gaps";
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
      aria-label={
        showChern
          ? hallScale
            ? "Hall conductivity color scale"
            : "Chern number color scale"
          : "Energy color scale"
      }
    >
      <span>{showChern ? (hallScale ? "Hall tᵣ" : "C") : "E"}</span>
      <i
        style={{
          background: showChern
            ? `linear-gradient(90deg, ${topologicalPalette.join(",")})`
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

export function ButterflyPlot({
  wannier = false,
  compact = false,
}: {
  wannier?: boolean;
  compact?: boolean;
}) {
  const { butterfly, butterflyStale } = useResultCache();
  const colorMode = useAppStore((state) => state.colorMode);
  const parameters = useAppStore((state) => state.parameters);
  const currentFlux = parameters.p / parameters.q;
  const setParameter = useAppStore((state) => state.setParameter);
  const setSelectedBand = useAppStore((state) => state.setSelectedBand);
  const setSelectedPoint = useAppStore((state) => state.setSelectedPoint);
  const xTransform = useAppStore((state) => state.fluxTransform);
  const setXTransform = useAppStore((state) => state.setFluxTransform);
  const [yTransform, setYTransform] = useState<AxisTransform>({
    ...resetAxis,
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | {
        mode: "pan" | "cursor";
        startX: number;
        startY: number;
        lastX: number;
        lastY: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const suppressInspectionUntil = useRef(0);
  const [draggingNumerator, setDraggingNumerator] = useState<
    number | undefined
  >(undefined);
  const [showGapStates, setShowGapStates] = useState(true);
  const [visibleGapSegments, setVisibleGapSegments] = useState(0);
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
  const gapData = useMemo<PointData>(
    () => ({
      x: arrays.gapFlux,
      y: arrays.gapEnergy,
      energy: arrays.gapEnergy,
      chern: arrays.gapChern,
      gap: arrays.gap,
      topologyAvailable: arrays.topologyAvailable,
      yRange: energyRange,
    }),
    [arrays, energyRange],
  );
  const effectiveColorMode: ButterflyColorMode = wannier
    ? data.topologyAvailable
      ? "chern"
      : "spectral"
    : colorMode !== "spectral" && !data.topologyAvailable
      ? "spectral"
      : colorMode;
  const gapMode = !wannier && effectiveColorMode === "gaps";
  const inspectionData = gapMode ? gapData : data;
  const spatialIndex = useMemo(
    () => buildSpatialIndex(inspectionData),
    [inspectionData],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const zoomWithWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      const delta = event.deltaY * (event.deltaMode === 1 ? 18 : 1);
      const scale = Math.exp(-delta * 0.0012);
      const currentX = useAppStore.getState().fluxTransform;
      const xZoom = Math.min(18, Math.max(1, currentX.zoom * scale));
      const oldXHalf = 1 / currentX.zoom;
      const newXHalf = 1 / xZoom;
      useAppStore.getState().setFluxTransform(
        boundedAxis({
          zoom: xZoom,
          pan: currentX.pan + ndcX * (oldXHalf - newXHalf),
        }),
      );
      setYTransform((current) => {
        const zoom = Math.min(18, Math.max(1, current.zoom * Math.exp(-delta * 0.0012)));
        const oldHalf = 1 / current.zoom;
        const newHalf = 1 / zoom;
        return boundedAxis({
          zoom,
          pan: current.pan + ndcY * (oldHalf - newHalf),
        });
      });
    };
    stage.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => stage.removeEventListener("wheel", zoomWithWheel);
  }, []);

  const xDomain: [number, number] = [
    (xTransform.pan - 1 / xTransform.zoom + 1) / 2,
    (xTransform.pan + 1 / xTransform.zoom + 1) / 2,
  ];
  const yMid = (data.yRange[0] + data.yRange[1]) / 2;
  const yHalf = (data.yRange[1] - data.yRange[0]) / 2;
  const yDomain: [number, number] = [
    yMid + (yTransform.pan - 1 / yTransform.zoom) * yHalf,
    yMid + (yTransform.pan + 1 / yTransform.zoom) * yHalf,
  ];

  function inspectPoint(event: React.PointerEvent<HTMLDivElement>) {
    if (
      !inspectionData.x.length
      || drag.current
      || performance.now() < suppressInspectionUntil.current
    ) return undefined;
    const rect = event.currentTarget.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const worldX = xTransform.pan + ndcX / xTransform.zoom;
    const worldY = yTransform.pan + ndcY / yTransform.zoom;
    const dataX = (worldX + 1) / 2;
    const inspectionYMid =
      (inspectionData.yRange[0] + inspectionData.yRange[1]) / 2;
    const inspectionYHalf =
      (inspectionData.yRange[1] - inspectionData.yRange[0]) / 2;
    const dataY = inspectionYMid + worldY * inspectionYHalf;
    const bucketX = Math.floor(dataX * 72);
    const bucketY = Math.floor(
      ((dataY - inspectionData.yRange[0])
        / Math.max(
          1e-9,
          inspectionData.yRange[1] - inspectionData.yRange[0],
        )) *
        72,
    );
    let closest = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const candidates = spatialIndex.get(`${bucketX + dx}:${bucketY + dy}`) ?? [];
        candidates.forEach((index) => {
          const distance =
            ((inspectionData.x[index] - dataX)
              * rect.width
              * xTransform.zoom) ** 2 +
            (((inspectionData.y[index] - dataY) /
              Math.max(
                1e-9,
                inspectionData.yRange[1] - inspectionData.yRange[0],
              )) *
              rect.height *
              yTransform.zoom) **
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
        flux: inspectionData.x[closest],
        energy: inspectionData.energy[closest],
        source: wannier ? "wannier" : gapMode ? "gap" : "butterfly",
        ...(wannier || gapMode
          ? { gapIndex: closest }
          : { band: inspectionData.band?.[closest] ?? 0 }),
        chern: inspectionData.topologyAvailable
          ? inspectionData.chern[closest]
          : undefined,
        topologyAvailable: inspectionData.topologyAvailable,
        dos: wannier ? inspectionData.y[closest] : undefined,
        gap:
          wannier || gapMode ? inspectionData.gap?.[closest] : undefined,
        ...(gapMode
          ? {
              gapEnergyMin:
                inspectionData.energy[closest]
                - (inspectionData.gap?.[closest] ?? 0) / 2,
              gapEnergyMax:
                inspectionData.energy[closest]
                + (inspectionData.gap?.[closest] ?? 0) / 2,
            }
          : {}),
      };
      setSelectedPoint(point);
      return point;
    }
    return undefined;
  }

  function moveCursor(clientX: number, rect: DOMRect) {
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const currentX = useAppStore.getState().fluxTransform;
    const worldX = currentX.pan + ndcX / currentX.zoom;
    const flux = Math.max(0, Math.min(1, (worldX + 1) / 2));
    const numerator = nearestCoprimeNumerator(flux, parameters.q);
    setDraggingNumerator(numerator);
    if (numerator !== useAppStore.getState().parameters.p) {
      setParameter("p", numerator);
    }
  }

  return (
    <div
      className={[
        "plot-shell",
        "spectrum-shell",
        compact ? "compact" : "",
        butterflyStale ? "is-stale" : "",
      ].filter(Boolean).join(" ")}
      data-flux-plot={wannier ? "wannier" : "butterfly"}
      data-recomputing={butterflyStale}
      data-current-numerator={parameters.p}
      data-energy-min={energyRange[0]}
      data-energy-max={energyRange[1]}
      data-point-count={data.x.length}
      data-gap-segments={gapMode ? visibleGapSegments : 0}
    >
      <div
        ref={stageRef}
        className="plot-stage"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const markerNdc =
            (currentFlux * 2 - 1 - xTransform.pan) * xTransform.zoom;
          const markerX =
            rect.left + ((markerNdc + 1) / 2) * rect.width;
          const mode =
            Math.abs(event.clientX - markerX) <= 18 ? "cursor" : "pan";
          drag.current = {
            mode,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            moved: false,
          };
          if (mode === "cursor") {
            setDraggingNumerator(parameters.p);
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) {
            inspectPoint(event);
            return;
          }
          const currentDrag = drag.current;
          const rect = event.currentTarget.getBoundingClientRect();
          const dx = event.clientX - currentDrag.lastX;
          const dy = event.clientY - currentDrag.lastY;
          currentDrag.moved =
            currentDrag.moved
            || Math.hypot(
              event.clientX - currentDrag.startX,
              event.clientY - currentDrag.startY,
            ) > 3;
          currentDrag.lastX = event.clientX;
          currentDrag.lastY = event.clientY;
          suppressInspectionUntil.current = performance.now() + 120;
          if (currentDrag.mode === "cursor") {
            moveCursor(event.clientX, rect);
          } else {
            const currentX = useAppStore.getState().fluxTransform;
            setXTransform(
              boundedAxis({
                ...currentX,
                pan:
                  currentX.pan
                  - (dx / rect.width) * (2 / currentX.zoom),
              }),
            );
            setYTransform((current) =>
              boundedAxis({
                ...current,
                pan:
                  current.pan
                  + (dy / rect.height) * (2 / current.zoom),
              }),
            );
          }
        }}
        onPointerUp={(event) => {
          const completedDrag = drag.current;
          drag.current = undefined;
          setDraggingNumerator(undefined);
          if (completedDrag?.mode === "pan" && !completedDrag.moved) {
            suppressInspectionUntil.current = 0;
            const point = inspectPoint(event);
            if (point) {
              const numerator = nearestCoprimeNumerator(
                point.flux,
                parameters.q,
              );
              if (numerator !== parameters.p) setParameter("p", numerator);
              if (point.band !== undefined) setSelectedBand(point.band);
              setSelectedPoint(point);
            }
          }
        }}
        onPointerLeave={() => {
          drag.current = undefined;
          setDraggingNumerator(undefined);
        }}
        onPointerCancel={() => {
          drag.current = undefined;
          setDraggingNumerator(undefined);
        }}
        onDoubleClick={() => {
          setXTransform({ ...resetAxis });
          setYTransform({ ...resetAxis });
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
          <CameraSync
            xTransform={xTransform}
            yTransform={yTransform}
          />
          {gapMode ? (
            <>
              <GapSegments
                flux={arrays.gapFlux}
                energy={arrays.gapEnergy}
                gap={arrays.gap}
                chern={arrays.gapChern}
                yRange={energyRange}
                yZoom={yTransform.zoom}
                onVisibleCount={setVisibleGapSegments}
              />
              {showGapStates && (
                <PointCloud
                  data={data}
                  colorMode="spectral"
                  opacityMultiplier={0.18}
                />
              )}
            </>
          ) : (
            <PointCloud
              data={data}
              colorMode={effectiveColorMode === "chern" ? "chern" : "spectral"}
            />
          )}
        </Canvas>
      </div>
      <PlotAxes
        xDomain={xDomain}
        yDomain={yDomain}
        xLabel="magnetic flux  φ = p / q"
        yLabel={wannier ? "integrated density of states" : "energy  E"}
        yFormat={(value) => (wannier ? value.toFixed(2) : value.toFixed(1))}
        xMarker={currentFlux}
      />
      <button
        className="plot-reset"
        onClick={() => {
          setXTransform({ ...resetAxis });
          setYTransform({ ...resetAxis });
        }}
      >
        reset view
      </button>
      <PlotLegend
        colorMode={effectiveColorMode}
        energyRange={energyRange}
        topologyAvailable={data.topologyAvailable}
        wannier={wannier}
      />
      {gapMode && (
        <button
          className="gap-overlay-toggle"
          aria-pressed={showGapStates}
          onClick={() => setShowGapStates((current) => !current)}
        >
          states overlay {showGapStates ? "on" : "off"}
        </button>
      )}
      {!data.x.length && (
        <div className="plot-empty" role="status">
          <span className="loader-orbit" />
          Waiting for the first numerical batch…
        </div>
      )}
      {butterflyStale && (
        <div className="recompute-chip" role="status">
          recomputing
        </div>
      )}
      {draggingNumerator !== undefined && (
        <div className="flux-drag-chip" role="status">
          φ = {draggingNumerator}/{parameters.q}
        </div>
      )}
      <div className="interaction-hint">
        drag gold cursor to choose φ · drag plot to pan · wheel to zoom
      </div>
    </div>
  );
}
