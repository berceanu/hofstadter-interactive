import { Billboard, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { bin, type Bin } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneY, line } from "d3-shape";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { extent } from "../utils/arrays";
import { extractContourSegments } from "../utils/contours";
import { useResultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";
import type {
  BandResult,
  DispersionResult,
  TopologyResult,
} from "../compute/contracts";
import {
  activeTopologyComputationKey,
  baseTopologyGridSufficient,
  bandComputationKey,
  dispersionComputationKey,
  dispersionRefinementGrid,
  topologyRefinementPlan,
} from "../compute/computeKeys";
import { HelpTooltip } from "./HelpTooltip";
import { bandResultHelp } from "./physicsHelp";

const TORUS_MAJOR_RADIUS = 1.18;
const TORUS_REFERENCE_RADIUS = 0.48;
const TORUS_DISPERSION_RELIEF = 0.56;
const CONTOUR_LEVEL_COUNT = 7;
const CONTOUR_FLOOR_Y = -0.875;
const CONTOUR_PROJECTION_Y = CONTOUR_FLOOR_Y - 0.014;
const CONTOUR_SURFACE_OFFSET = 0.018;
const CONTOUR_MINOR_HALF_WIDTH = 0.01;
const CONTOUR_MAJOR_HALF_WIDTH = 0.017;
const BAND_CUT_MAX_ZOOM = 32;

// Per-band surface views must keep a stable identity across renders:
// Surface's geometry memo is keyed on array identity, so a fresh `.slice()`
// every render would rebuild the full mesh on each pointer event.  Result
// arrays are immutable once published, making this cache safe; entries die
// with their source array.
const surfaceSliceCache = new WeakMap<
  Float64Array,
  Map<string, Float64Array>
>();

function surfaceSlice(source: Float64Array, offset: number, count: number) {
  let spans = surfaceSliceCache.get(source);
  if (!spans) {
    spans = new Map();
    surfaceSliceCache.set(source, spans);
  }
  const key = `${offset}:${count}`;
  let view = spans.get(key);
  if (!view) {
    view = source.slice(offset, offset + count);
    while (spans.size >= 64) {
      const oldest = spans.keys().next().value;
      if (oldest === undefined) break;
      spans.delete(oldest);
    }
    spans.set(key, view);
  }
  return view;
}

interface BandCutViewport {
  zoom: number;
  panX: number;
  panY: number;
}

interface BandPathData {
  bands: number;
  pathX: Float64Array;
  pathK1: Float64Array;
  pathK2: Float64Array;
  pathEnergy: Float64Array;
  pathTicks: Float64Array;
  pathLabels: string[];
}

function topologyCoversBand(
  topology: TopologyResult | undefined,
  band: number,
) {
  if (!topology) return false;
  return (
    topology.completeBundle
    || (
      topology.computedGroupStart >= 0
      && band >= topology.computedGroupStart
      && band
        < topology.computedGroupStart + topology.computedGroupSize
    )
  );
}

function topologyForBand(
  bands: BandResult,
  topology: TopologyResult | undefined,
  band: number,
  allowBaseTopology = true,
) {
  const usesAdaptive = topologyCoversBand(topology, band);
  const source = usesAdaptive ? topology! : bands;
  return {
    source,
    resolved:
      source.topologyGroupingConsistent
      && Boolean(source.topologyGroupResolved[band])
      && (usesAdaptive || allowBaseTopology),
    chern: source.chern[band] ?? 0,
    winding: source.wilsonWinding[band] ?? 0,
  };
}

const resetBandCutViewport: BandCutViewport = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

function boundedBandCutViewport(
  viewport: BandCutViewport,
): BandCutViewport {
  const zoom = Math.min(BAND_CUT_MAX_ZOOM, Math.max(1, viewport.zoom));
  const panLimit = Math.max(0, 1 - 1 / zoom);
  return {
    zoom,
    panX: Math.max(-panLimit, Math.min(panLimit, viewport.panX)),
    panY: Math.max(-panLimit, Math.min(panLimit, viewport.panY)),
  };
}

function centeredFraction(value: number) {
  const wrapped = ((value % 1) + 1) % 1;
  return wrapped > 0.5 ? wrapped - 1 : wrapped;
}

function samplePeriodicGrid(
  values: Float64Array,
  samples: number,
  k1: number,
  k2: number,
) {
  if (samples < 2 || values.length < samples * samples) return 0;
  const period = samples - 1;
  const wrappedK1 = ((k1 % 1) + 1) % 1;
  const wrappedK2 = ((k2 % 1) + 1) % 1;
  const gridX = wrappedK1 * period;
  const gridY = wrappedK2 * period;
  const x0 = Math.floor(gridX) % period;
  const y0 = Math.floor(gridY) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const tx = gridX - Math.floor(gridX);
  const ty = gridY - Math.floor(gridY);
  const first =
    values[x0 * samples + y0] * (1 - tx)
    + values[x1 * samples + y0] * tx;
  const second =
    values[x0 * samples + y1] * (1 - tx)
    + values[x1 * samples + y1] * tx;
  return first * (1 - ty) + second * ty;
}

function SceneSegments({
  points,
  color,
  opacity = 1,
}: {
  points: [number, number, number][];
  color: string;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(points.length * 3);
    points.forEach((point, index) => positions.set(point, index * 3));
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return next;
  }, [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function LabelBillboard({
  label,
  position,
  opacity,
}: {
  label: string;
  position: [number, number, number];
  opacity: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = "600 44px monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#fff3b0";
      context.shadowColor = "#08111d";
      context.shadowBlur = 8;
      context.fillText(label, canvas.width / 2, canvas.height / 2);
    }
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    next.needsUpdate = true;
    return next;
  }, [label]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <Billboard position={position}>
      <mesh scale={[0.42, 0.21, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={opacity}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

function outlineSegments(
  outline: Float64Array,
  reciprocal: Float64Array,
  y: number,
) {
  if (reciprocal.length < 4) return [];
  const [b1x, b1y, b2x, b2y] = reciprocal;
  const determinant = b1x * b2y - b1y * b2x;
  if (Math.abs(determinant) < 1e-12) return [];
  const vertices: [number, number, number][] = [];
  for (let index = 0; index < outline.length; index += 2) {
    const x = outline[index];
    const z = outline[index + 1];
    const k1 = (x * b2y - z * b2x) / determinant;
    const k2 = (-x * b1y + z * b1x) / determinant;
    vertices.push([k1 * 3.4, y, k2 * 3.4]);
  }
  const segments: [number, number, number][] = [];
  for (let index = 0; index < vertices.length - 1; index += 1) {
    segments.push(vertices[index], vertices[index + 1]);
  }
  return segments;
}

function ReciprocalOverlays({
  bands,
  pathData,
  energyValues,
  surfaceSamples,
  showPath,
  showLiftedPath,
  labelOpacity,
}: {
  bands: BandResult;
  pathData: BandPathData;
  energyValues: Float64Array;
  surfaceSamples: number;
  showPath: boolean;
  showLiftedPath: boolean;
  labelOpacity: number;
}) {
  const magneticOutline = useMemo(
    () => outlineSegments(bands.bz, bands.reciprocal, -0.89),
    [bands.bz, bands.reciprocal],
  );
  const ordinaryOutline = useMemo(
    () => outlineSegments(bands.ordinaryBz, bands.reciprocal, -0.94),
    [bands.ordinaryBz, bands.reciprocal],
  );
  const [energyMin, energyMax] = extent(energyValues, [-1, 1]);
  const energySpan = Math.max(1e-9, energyMax - energyMin);
  const basePath: [number, number, number][] = [];
  const liftedPath: [number, number, number][] = [];
  for (let index = 0; index < pathData.pathX.length - 1; index += 1) {
    const firstK1 = centeredFraction(pathData.pathK1[index]);
    const firstK2 = centeredFraction(pathData.pathK2[index]);
    const secondK1 = centeredFraction(pathData.pathK1[index + 1]);
    const secondK2 = centeredFraction(pathData.pathK2[index + 1]);
    if (
      Math.abs(secondK1 - firstK1) > 0.55
      || Math.abs(secondK2 - firstK2) > 0.55
    ) {
      continue;
    }
    if (showPath) {
      basePath.push(
        [firstK1 * 3.4, -0.86, firstK2 * 3.4],
        [secondK1 * 3.4, -0.86, secondK2 * 3.4],
      );
    }
    if (showLiftedPath) {
      const firstEnergy = samplePeriodicGrid(
        energyValues,
        surfaceSamples,
        pathData.pathK1[index],
        pathData.pathK2[index],
      );
      const secondEnergy = samplePeriodicGrid(
        energyValues,
        surfaceSamples,
        pathData.pathK1[index + 1],
        pathData.pathK2[index + 1],
      );
      liftedPath.push(
        [
          firstK1 * 3.4,
          ((firstEnergy - energyMin) / energySpan - 0.5) * 1.7 + 0.018,
          firstK2 * 3.4,
        ],
        [
          secondK1 * 3.4,
          ((secondEnergy - energyMin) / energySpan - 0.5) * 1.7 + 0.018,
          secondK2 * 3.4,
        ],
      );
    }
  }

  return (
    <>
      <SceneSegments points={ordinaryOutline} color="#60788b" opacity={0.24} />
      <SceneSegments points={magneticOutline} color="#5cf2ce" opacity={0.9} />
      {showPath && (
        <SceneSegments points={basePath} color="#ffd166" opacity={0.58} />
      )}
      {showLiftedPath && (
        <SceneSegments points={liftedPath} color="#fff3b0" opacity={1} />
      )}
      {bands.symPoints.map((point) => (
        <LabelBillboard
          key={point.label}
          label={point.label}
          position={[
            centeredFraction(point.k1) * 3.4,
            -0.77,
            centeredFraction(point.k2) * 3.4,
          ]}
          opacity={labelOpacity}
        />
      ))}
    </>
  );
}

function Surface({
  heightValues,
  colorValues,
  samples,
  marker,
  torus,
  contours,
  onContourCount,
}: {
  heightValues: Float64Array;
  colorValues: Float64Array;
  samples: number;
  marker?: { k1: number; k2: number };
  torus: boolean;
  contours: boolean;
  onContourCount?: (count: number) => void;
}) {
  const morph = useRef(torus ? 1 : 0);
  const markerRef = useRef<THREE.Group>(null);
  const surfaceData = useMemo(() => {
    const [heightMin, heightMax] = extent(heightValues, [-1, 1]);
    const heightSpan = Math.max(1e-9, heightMax - heightMin);
    const [colorMin, colorMax] = extent(colorValues, [-1, 1]);
    const colorSpan = Math.max(1e-9, colorMax - colorMin);
    const sheetPositions = new Float32Array(samples * samples * 3);
    const torusPositions = new Float32Array(samples * samples * 3);
    const positions = new Float32Array(samples * samples * 3);
    const colors = new Float32Array(samples * samples * 3);
    const projectionPositions = new Float32Array(samples * samples * 3);
    const projectionColors = new Float32Array(samples * samples * 3);
    const contourValues = new Float64Array(samples * samples);
    const contourHeights = new Float64Array(samples * samples);
    const low = new THREE.Color("#3b69ff");
    const mid = new THREE.Color("#62e7c8");
    const high = new THREE.Color("#ffd166");
    const color = new THREE.Color();
    const period = Math.max(1, samples - 1);
    const shift = Math.floor(period / 2);
    for (let ix = 0; ix < samples; ix += 1) {
      for (let iy = 0; iy < samples; iy += 1) {
        const index = ix * samples + iy;
        const sourceX = (ix + shift) % period;
        const sourceY = (iy + shift) % period;
        const sourceIndex = sourceX * samples + sourceY;
        const normalizedHeight =
          (heightValues[sourceIndex] - heightMin) / heightSpan;
        const normalizedColor =
          (colorValues[sourceIndex] - colorMin) / colorSpan;
        contourValues[index] = colorValues[sourceIndex];
        contourHeights[index] = normalizedHeight;
        const offset = index * 3;
        sheetPositions[offset] = (ix / (samples - 1) - 0.5) * 3.4;
        sheetPositions[offset + 1] = (normalizedHeight - 0.5) * 1.7;
        sheetPositions[offset + 2] = (iy / (samples - 1) - 0.5) * 3.4;
        projectionPositions[offset] = sheetPositions[offset];
        projectionPositions[offset + 1] = CONTOUR_PROJECTION_Y;
        projectionPositions[offset + 2] = sheetPositions[offset + 2];

        const u = (ix / Math.max(1, samples - 1)) * Math.PI * 2;
        const v = (iy / Math.max(1, samples - 1)) * Math.PI * 2;
        const tubeRadius =
          TORUS_REFERENCE_RADIUS +
          (normalizedHeight - 0.5) * TORUS_DISPERSION_RELIEF;
        const radial = TORUS_MAJOR_RADIUS + tubeRadius * Math.cos(v);
        torusPositions[offset] = radial * Math.cos(u);
        torusPositions[offset + 1] = tubeRadius * Math.sin(v);
        torusPositions[offset + 2] = radial * Math.sin(u);

        positions[offset] = THREE.MathUtils.lerp(
          sheetPositions[offset],
          torusPositions[offset],
          morph.current,
        );
        positions[offset + 1] = THREE.MathUtils.lerp(
          sheetPositions[offset + 1],
          torusPositions[offset + 1],
          morph.current,
        );
        positions[offset + 2] = THREE.MathUtils.lerp(
          sheetPositions[offset + 2],
          torusPositions[offset + 2],
          morph.current,
        );
        if (normalizedColor < 0.5) {
          color.copy(low).lerp(mid, normalizedColor * 2);
        } else {
          color.copy(mid).lerp(high, (normalizedColor - 0.5) * 2);
        }
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
        projectionColors[index * 3] = color.r;
        projectionColors[index * 3 + 1] = color.g;
        projectionColors[index * 3 + 2] = color.b;
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
    const projectionGeometry = new THREE.BufferGeometry();
    projectionGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(projectionPositions, 3),
    );
    projectionGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(projectionColors, 3),
    );
    projectionGeometry.setIndex(indices);

    const extractedContours = extractContourSegments(
      contourValues,
      contourHeights,
      samples,
      CONTOUR_LEVEL_COUNT,
    );
    const contourLength = extractedContours.length * 2 * 3;
    const contourSheetPositions = new Float32Array(contourLength);
    const contourTorusPositions = new Float32Array(contourLength);
    const contourPositions = new Float32Array(contourLength);
    const contourSheetColors = new Float32Array(contourLength);
    const contourTorusColors = new Float32Array(contourLength);
    const contourColors = new Float32Array(contourLength);
    const ribbonPositions = new Float32Array(
      extractedContours.length * 6 * 3,
    );
    const ribbonColors = new Float32Array(extractedContours.length * 6 * 3);
    const contourHighlight = new THREE.Color("#effff9");
    const contourDark = new THREE.Color("#06111e");
    const contourLight = new THREE.Color("#fff3b0");
    const setContourVertex = (
      vertex: { x: number; y: number; height: number },
      normalizedLevel: number,
      offset: number,
    ) => {
      const xFraction = vertex.x / period;
      const yFraction = vertex.y / period;
      contourSheetPositions[offset] = (xFraction - 0.5) * 3.4;
      contourSheetPositions[offset + 1] = CONTOUR_FLOOR_Y;
      contourSheetPositions[offset + 2] = (yFraction - 0.5) * 3.4;

      const u = xFraction * Math.PI * 2;
      const v = yFraction * Math.PI * 2;
      const tubeRadius =
        TORUS_REFERENCE_RADIUS
        + (vertex.height - 0.5) * TORUS_DISPERSION_RELIEF
        + CONTOUR_SURFACE_OFFSET;
      const radial = TORUS_MAJOR_RADIUS + tubeRadius * Math.cos(v);
      contourTorusPositions[offset] = radial * Math.cos(u);
      contourTorusPositions[offset + 1] = tubeRadius * Math.sin(v);
      contourTorusPositions[offset + 2] = radial * Math.sin(u);

      for (let axis = 0; axis < 3; axis += 1) {
        contourPositions[offset + axis] = THREE.MathUtils.lerp(
          contourSheetPositions[offset + axis],
          contourTorusPositions[offset + axis],
          morph.current,
        );
      }
      if (normalizedLevel < 0.5) {
        color.copy(low).lerp(mid, normalizedLevel * 2);
      } else {
        color.copy(mid).lerp(high, (normalizedLevel - 0.5) * 2);
      }
      color.lerp(contourHighlight, 0.28);
      const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
      const torusColor = luminance > 0.55 ? contourDark : contourLight;
      const sheetChannels = [color.r, color.g, color.b];
      const torusChannels = [torusColor.r, torusColor.g, torusColor.b];
      for (let channel = 0; channel < 3; channel += 1) {
        contourSheetColors[offset + channel] = sheetChannels[channel];
        contourTorusColors[offset + channel] = torusChannels[channel];
        contourColors[offset + channel] = THREE.MathUtils.lerp(
          sheetChannels[channel],
          torusChannels[channel],
          morph.current,
        );
      }
    };
    extractedContours.forEach((segment, index) => {
      const offset = index * 6;
      setContourVertex(segment.start, segment.normalizedLevel, offset);
      setContourVertex(segment.end, segment.normalizedLevel, offset + 3);

      const startX = contourSheetPositions[offset];
      const startZ = contourSheetPositions[offset + 2];
      const endX = contourSheetPositions[offset + 3];
      const endZ = contourSheetPositions[offset + 5];
      const deltaX = endX - startX;
      const deltaZ = endZ - startZ;
      const length = Math.hypot(deltaX, deltaZ);
      const halfWidth =
        Math.abs(segment.normalizedLevel - 0.5) < 1e-8
          ? CONTOUR_MAJOR_HALF_WIDTH
          : CONTOUR_MINOR_HALF_WIDTH;
      const perpendicularX = length > 1e-9
        ? (-deltaZ / length) * halfWidth
        : 0;
      const perpendicularZ = length > 1e-9
        ? (deltaX / length) * halfWidth
        : 0;
      const y = CONTOUR_FLOOR_Y + 0.006;
      const vertices = [
        startX + perpendicularX, y, startZ + perpendicularZ,
        startX - perpendicularX, y, startZ - perpendicularZ,
        endX + perpendicularX, y, endZ + perpendicularZ,
        startX - perpendicularX, y, startZ - perpendicularZ,
        endX - perpendicularX, y, endZ - perpendicularZ,
        endX + perpendicularX, y, endZ + perpendicularZ,
      ];
      const ribbonOffset = index * 18;
      ribbonPositions.set(vertices, ribbonOffset);
      for (let vertex = 0; vertex < 6; vertex += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          ribbonColors[ribbonOffset + vertex * 3 + channel] =
            contourTorusColors[offset + channel];
        }
      }
    });
    const contourGeometry = new THREE.BufferGeometry();
    contourGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(contourPositions, 3),
    );
    contourGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(contourColors, 3),
    );
    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(ribbonPositions, 3),
    );
    ribbonGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(ribbonColors, 3),
    );

    return {
      geometry: next,
      projectionGeometry,
      sheetPositions,
      torusPositions,
      contourGeometry,
      ribbonGeometry,
      contourSheetPositions,
      contourTorusPositions,
      contourSheetColors,
      contourTorusColors,
      contourCount: extractedContours.length,
    };
  }, [colorValues, heightValues, samples]);

  useEffect(() => {
    onContourCount?.(surfaceData.contourCount);
  }, [onContourCount, surfaceData.contourCount]);

  useEffect(() => () => {
    surfaceData.geometry.dispose();
    surfaceData.projectionGeometry.dispose();
    surfaceData.contourGeometry.dispose();
    surfaceData.ribbonGeometry.dispose();
  }, [surfaceData]);

  const markerPositions = useMemo(() => {
    if (!marker) return undefined;
    const [min, max] = extent(heightValues, [-1, 1]);
    const span = Math.max(1e-9, max - min);
    const ix = Math.max(
      0,
      Math.min(samples - 1, Math.round(marker.k1 * (samples - 1))),
    );
    const iy = Math.max(
      0,
      Math.min(samples - 1, Math.round(marker.k2 * (samples - 1))),
    );
    const normalized = (heightValues[ix * samples + iy] - min) / span;
    const sheet = new THREE.Vector3(
      centeredFraction(marker.k1) * 3.4,
      (normalized - 0.5) * 1.7,
      centeredFraction(marker.k2) * 3.4,
    );
    const u = (((marker.k1 % 1) + 1) % 1) * Math.PI * 2;
    const v = (((marker.k2 % 1) + 1) % 1) * Math.PI * 2;
    const tubeRadius =
      TORUS_REFERENCE_RADIUS +
      (normalized - 0.5) * TORUS_DISPERSION_RELIEF;
    const radial = TORUS_MAJOR_RADIUS + tubeRadius * Math.cos(v);
    const torusPosition = new THREE.Vector3(
      radial * Math.cos(u),
      tubeRadius * Math.sin(v),
      radial * Math.sin(u),
    );
    return { sheet, torus: torusPosition };
  }, [heightValues, marker, samples]);

  useFrame((_, delta) => {
    const target = torus ? 1 : 0;
    const nextMorph = THREE.MathUtils.damp(morph.current, target, 5.2, delta);
    const morphChanged = Math.abs(nextMorph - morph.current) >= 1e-5;
    morph.current = nextMorph;
    if (morphChanged) {
      const position = surfaceData.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const output = position.array as Float32Array;
      for (let index = 0; index < output.length; index += 1) {
        output[index] = THREE.MathUtils.lerp(
          surfaceData.sheetPositions[index],
          surfaceData.torusPositions[index],
          nextMorph,
        );
      }
      position.needsUpdate = true;
      surfaceData.geometry.computeVertexNormals();
      const contourPosition = surfaceData.contourGeometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const contourOutput = contourPosition.array as Float32Array;
      for (let index = 0; index < contourOutput.length; index += 1) {
        contourOutput[index] = THREE.MathUtils.lerp(
          surfaceData.contourSheetPositions[index],
          surfaceData.contourTorusPositions[index],
          nextMorph,
        );
      }
      contourPosition.needsUpdate = true;
      const contourColor = surfaceData.contourGeometry.getAttribute(
        "color",
      ) as THREE.BufferAttribute;
      const contourColorOutput = contourColor.array as Float32Array;
      for (let index = 0; index < contourColorOutput.length; index += 1) {
        contourColorOutput[index] = THREE.MathUtils.lerp(
          surfaceData.contourSheetColors[index],
          surfaceData.contourTorusColors[index],
          nextMorph,
        );
      }
      contourColor.needsUpdate = true;
    }
    if (markerRef.current && markerPositions) {
      markerRef.current.position.copy(markerPositions.sheet).lerp(
        markerPositions.torus,
        nextMorph,
      );
    }
  });

  const initialMarkerPosition = markerPositions
    ? markerPositions.sheet.clone().lerp(markerPositions.torus, morph.current)
    : undefined;

  return (
    <>
      <mesh geometry={surfaceData.geometry}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          roughness={0.58}
          metalness={0.08}
        />
      </mesh>
      {contours && !torus && (
        <mesh geometry={surfaceData.projectionGeometry} renderOrder={-2}>
          <meshBasicMaterial
            vertexColors
            side={THREE.DoubleSide}
            transparent
            opacity={0.38}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      {contours && !torus && surfaceData.contourCount > 0 && (
        <mesh geometry={surfaceData.ribbonGeometry} renderOrder={4}>
          <meshBasicMaterial
            vertexColors
            side={THREE.DoubleSide}
            transparent
            opacity={0.94}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      {contours && surfaceData.contourCount > 0 && (
        <lineSegments geometry={surfaceData.contourGeometry} renderOrder={3}>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={torus ? 0.9 : 0.42}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      )}
      {torus && (
        <>
          <mesh geometry={surfaceData.geometry}>
            <meshBasicMaterial
              color="#dffcf4"
              wireframe
              transparent
              opacity={0.13}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry
              args={[TORUS_MAJOR_RADIUS, TORUS_REFERENCE_RADIUS, 20, 64]}
            />
            <meshBasicMaterial
              color="#8aa5b5"
              wireframe
              transparent
              opacity={0.1}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
      {initialMarkerPosition && (
        <group ref={markerRef} position={initialMarkerPosition}>
          <mesh renderOrder={100} frustumCulled={false}>
            <sphereGeometry args={[torus ? 0.115 : 0.1, 24, 24]} />
            <meshBasicMaterial
              color="#06111e"
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh renderOrder={101} frustumCulled={false}>
            <sphereGeometry args={[torus ? 0.078 : 0.07, 24, 24]} />
            <meshBasicMaterial
              color="#fff3b0"
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          {torus ? (
            <Billboard>
              <mesh renderOrder={102} frustumCulled={false}>
                <ringGeometry args={[0.135, 0.17, 40]} />
                <meshBasicMaterial
                  color="#5cf2ce"
                  side={THREE.DoubleSide}
                  transparent
                  opacity={0.94}
                  depthTest={false}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
              <lineSegments renderOrder={103} frustumCulled={false}>
                <bufferGeometry>
                  <bufferAttribute
                    attach="attributes-position"
                    args={[
                      new Float32Array([
                        -0.235, 0, 0, -0.175, 0, 0,
                        0.175, 0, 0, 0.235, 0, 0,
                        0, -0.235, 0, 0, -0.175, 0,
                        0, 0.175, 0, 0, 0.235, 0,
                      ]),
                      3,
                    ]}
                  />
                </bufferGeometry>
                <lineBasicMaterial
                  color="#5cf2ce"
                  transparent
                  opacity={0.94}
                  depthTest={false}
                  depthWrite={false}
                  toneMapped={false}
                />
              </lineSegments>
            </Billboard>
          ) : (
            <lineSegments renderOrder={99}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([0, 0, 0, 0, -2.1, 0]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color="#ffd166"
                transparent
                opacity={0.65}
                depthWrite={false}
              />
            </lineSegments>
          )}
        </group>
      )}
    </>
  );
}

function BandCut({
  pathData,
  dispersionSource,
  pathSamplesPerSegment,
  selectedPathIndex,
  onSelectPath,
  highlightBand,
  viewport,
  setViewport,
}: {
  pathData: BandPathData;
  dispersionSource: "base" | "refined";
  pathSamplesPerSegment: number;
  selectedPathIndex: number;
  onSelectPath: (index: number) => void;
  highlightBand?: number;
  viewport: BandCutViewport;
  setViewport: React.Dispatch<React.SetStateAction<BandCutViewport>>;
}) {
  const { bands } = useResultCache();
  const selectedBand = useAppStore((state) => state.selectedBand);
  const setSelectedBand = useAppStore((state) => state.setSelectedBand);
  const [hoveredCutBand, setHoveredCutBand] = useState<number | undefined>();
  const [scrubbing, setScrubbing] = useState(false);
  const [panning, setPanning] = useState(false);
  const interactionRef = useRef<SVGRectElement>(null);
  const dragPointer = useRef<{
    id: number;
    mode: "scrub" | "pan";
    lastX: number;
    lastY: number;
  } | undefined>(undefined);
  const clipId = `band-cut-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const zoomAtPointer = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = interaction.getBoundingClientRect();
      const ndcX =
        ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      const ndcY =
        -(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1);
      const delta = event.deltaY * (event.deltaMode === 1 ? 18 : 1);
      const scale = Math.exp(-delta * 0.0015);
      setViewport((current) => {
        const zoom = Math.min(
          BAND_CUT_MAX_ZOOM,
          Math.max(1, current.zoom * scale),
        );
        const oldHalf = 1 / current.zoom;
        const newHalf = 1 / zoom;
        return boundedBandCutViewport({
          zoom,
          panX: current.panX + ndcX * (oldHalf - newHalf),
          panY: current.panY + ndcY * (oldHalf - newHalf),
        });
      });
    };
    interaction.addEventListener("wheel", zoomAtPointer, { passive: false });
    return () => interaction.removeEventListener("wheel", zoomAtPointer);
  }, [setViewport]);
  if (!bands) return null;
  const bandData = bands;

  const fullEnergyRange = extent(pathData.pathEnergy, [-4, 4]);
  const highlighted = highlightBand ?? selectedBand;
  const selectedGroupStart = bands.groupStart[highlighted] ?? highlighted;
  const selectedGroupSize = bands.groupSize[highlighted] ?? 1;
  const xMax =
    pathData.pathTicks[pathData.pathTicks.length - 1]
    || pathData.pathX[pathData.pathX.length - 1]
    || 1;
  const xDomain: [number, number] = [
    ((viewport.panX - 1 / viewport.zoom + 1) / 2) * xMax,
    ((viewport.panX + 1 / viewport.zoom + 1) / 2) * xMax,
  ];
  const energyMid = (fullEnergyRange[0] + fullEnergyRange[1]) / 2;
  const energyHalf = Math.max(
    1e-9,
    (fullEnergyRange[1] - fullEnergyRange[0]) / 2,
  );
  const yDomain: [number, number] = [
    energyMid + (viewport.panY - 1 / viewport.zoom) * energyHalf,
    energyMid + (viewport.panY + 1 / viewport.zoom) * energyHalf,
  ];
  const x = scaleLinear().domain(xDomain).range([58, 713]);
  const y = scaleLinear().domain(yDomain).range([454, 30]);
  const yTickDecimals =
    yDomain[1] - yDomain[0] < 0.02
      ? 4
      : yDomain[1] - yDomain[0] < 0.2
        ? 3
        : yDomain[1] - yDomain[0] < 2
          ? 2
          : 1;
  const lineMaker = line<[number, number]>()
    .x((point) => x(point[0]))
    .y((point) => y(point[1]));
  const pointsPerBand = pathData.pathX.length;
  const paths = Array.from({ length: bands.bands }, (_, band) => {
    const points: [number, number][] = [];
    for (let index = 0; index < pointsPerBand; index += 1) {
      points.push([
        pathData.pathX[index],
        pathData.pathEnergy[band * pointsPerBand + index],
      ]);
    }
    return lineMaker(points) ?? "";
  });

  const thresholds: Bin<number, number>[] = bin<number, number>()
    .domain(yDomain)
    .value((value) => value)
    .thresholds(30)(Array.from(bands.energy));
  const densityMax = Math.max(1, ...thresholds.map((bucket) => bucket.length));
  const densityX = scaleLinear().domain([0, densityMax]).range([0, 176]);
  const densityArea = area<Bin<number, number>>()
    .x0(0)
    .x1((bucket) => densityX(bucket.length))
    .y((bucket) => y((bucket.x0! + bucket.x1!) / 2))
    .curve(curveMonotoneY)(thresholds);
  const markerIndex = Math.max(
    0,
    Math.min(pointsPerBand - 1, selectedPathIndex),
  );
  const markerX = x(pathData.pathX[markerIndex]);
  const markerY = y(
    pathData.pathEnergy[selectedBand * pointsPerBand + markerIndex],
  );

  function closestPathIndex(svgX: number) {
    const pathCoordinate = x.invert(Math.max(58, Math.min(713, svgX)));
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < pointsPerBand; index += 1) {
      const distance = Math.abs(pathData.pathX[index] - pathCoordinate);
      if (distance < closestDistance) {
        closest = index;
        closestDistance = distance;
      }
    }
    return closest;
  }

  function pointerPosition(event: React.PointerEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return undefined;
    const bounds = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 940,
      y: ((event.clientY - bounds.top) / bounds.height) * 500,
    };
  }

  function closestBand(pathIndex: number, svgY: number) {
    let nearestBand: number | undefined;
    let nearestDistance = 18;
    for (let band = 0; band < bandData.bands; band += 1) {
      const energy = pathData.pathEnergy[band * pointsPerBand + pathIndex];
      const distance = Math.abs(y(energy) - svgY);
      if (distance <= nearestDistance) {
        nearestBand = band;
        nearestDistance = distance;
      }
    }
    return nearestBand;
  }

  function beginInteraction(event: React.PointerEvent<SVGRectElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const point = pointerPosition(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const mode =
      event.button === 1 || event.shiftKey ? "pan" : "scrub";
    dragPointer.current = {
      id: event.pointerId,
      mode,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    if (mode === "pan") {
      setPanning(true);
      return;
    }
    setScrubbing(true);
    const pathIndex = closestPathIndex(point.x);
    const band = closestBand(pathIndex, point.y);
    if (band !== undefined) {
      setSelectedBand(band);
      setHoveredCutBand(band);
    }
    onSelectPath(pathIndex);
  }

  function moveInteraction(event: React.PointerEvent<SVGRectElement>) {
    const activeDrag = dragPointer.current;
    if (activeDrag?.id === event.pointerId && activeDrag.mode === "pan") {
      const bounds = event.currentTarget.getBoundingClientRect();
      const dx = event.clientX - activeDrag.lastX;
      const dy = event.clientY - activeDrag.lastY;
      activeDrag.lastX = event.clientX;
      activeDrag.lastY = event.clientY;
      setViewport((current) =>
        boundedBandCutViewport({
          ...current,
          panX:
            current.panX
            - (dx / Math.max(1, bounds.width)) * (2 / current.zoom),
          panY:
            current.panY
            + (dy / Math.max(1, bounds.height)) * (2 / current.zoom),
        }),
      );
      return;
    }
    const point = pointerPosition(event);
    if (!point) return;
    const pathIndex = closestPathIndex(point.x);
    if (activeDrag?.id === event.pointerId) {
      onSelectPath(pathIndex);
      return;
    }
    setHoveredCutBand(closestBand(pathIndex, point.y));
  }

  function endInteraction(event: React.PointerEvent<SVGRectElement>) {
    const activeDrag = dragPointer.current;
    if (activeDrag?.id !== event.pointerId) return;
    dragPointer.current = undefined;
    setScrubbing(false);
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (activeDrag.mode === "pan") return;
    const point = pointerPosition(event);
    if (point) {
      setHoveredCutBand(
        closestBand(closestPathIndex(point.x), point.y),
      );
    }
  }

  function moveSelectionByKeyboard(
    event: React.KeyboardEvent<SVGRectElement>,
  ) {
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      const factor = event.key === "-" ? 1 / 1.6 : 1.6;
      setViewport((current) =>
        boundedBandCutViewport({
          ...current,
          zoom: current.zoom * factor,
        }),
      );
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      setViewport(resetBandCutViewport);
      return;
    }
    let nextPathIndex = markerIndex;
    let nextBand = selectedBand;
    if (event.key === "ArrowLeft") nextPathIndex -= 1;
    else if (event.key === "ArrowRight") nextPathIndex += 1;
    else if (event.key === "Home") nextPathIndex = 0;
    else if (event.key === "End") nextPathIndex = pointsPerBand - 1;
    else if (event.key === "ArrowUp") nextBand += 1;
    else if (event.key === "ArrowDown") nextBand -= 1;
    else return;
    event.preventDefault();
    setSelectedBand(Math.max(0, Math.min(bandData.bands - 1, nextBand)));
    onSelectPath(Math.max(0, Math.min(pointsPerBand - 1, nextPathIndex)));
  }

  return (
    <svg
      className="band-cut"
      viewBox="0 0 940 500"
      role="img"
      aria-label="Band energies along the high-symmetry path with density of states"
      data-band-hit-radius="18"
      data-selected-path-index={markerIndex}
      data-scrubbing={scrubbing}
      data-panning={panning}
      data-band-zoom={viewport.zoom.toFixed(3)}
      data-band-pan-x={viewport.panX.toFixed(3)}
      data-band-pan-y={viewport.panY.toFixed(3)}
      data-zoom-mode="cursor-centered-2d"
      data-dispersion-source={dispersionSource}
      data-path-points={pathData.pathX.length}
      data-path-samples-per-segment={pathSamplesPerSegment}
    >
      <rect x="0" y="0" width="940" height="500" className="panel-bg" />
      <defs>
        <clipPath id={clipId}>
          <rect x="58" y="30" width="655" height="424" />
        </clipPath>
      </defs>
      <g className="band-grid" clipPath={`url(#${clipId})`}>
        {Array.from(pathData.pathTicks).map((tick, index) => (
          <line key={index} x1={x(tick)} x2={x(tick)} y1="30" y2="454" />
        ))}
        {y.ticks(5).map((tick) => (
          <line key={tick} x1="58" x2="713" y1={y(tick)} y2={y(tick)} />
        ))}
      </g>
      <g className="band-lines" clipPath={`url(#${clipId})`}>
        {paths.map((path, band) => (
          <path
            key={band}
            d={path}
            className={
              [
                band >= selectedGroupStart
                && band < selectedGroupStart + selectedGroupSize
                  ? "selected-band"
                  : "",
                hoveredCutBand === band ? "hovered-band" : "",
              ].filter(Boolean).join(" ")
            }
            data-band-index={band}
          />
        ))}
      </g>
      <g
        className="momentum-marker"
        aria-label="Selected momentum"
        clipPath={`url(#${clipId})`}
      >
        <line x1={markerX} x2={markerX} y1="30" y2="454" />
        <circle
          className="marker-halo"
          cx={markerX}
          cy={markerY}
          r="12"
        />
        <circle
          className="marker-point"
          cx={markerX}
          cy={markerY}
          r="6"
        />
      </g>
      <rect
        ref={interactionRef}
        className="band-interaction-layer"
        x="58"
        y="30"
        width="655"
        height="424"
        role="slider"
        tabIndex={0}
        aria-label="Selected momentum along band"
        aria-valuemin={0}
        aria-valuemax={pointsPerBand - 1}
        aria-valuenow={markerIndex}
        aria-valuetext={`Path point ${markerIndex + 1} of ${pointsPerBand}, band ${selectedBand}`}
        onPointerDown={beginInteraction}
        onPointerMove={moveInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onDoubleClick={(event) => {
          event.preventDefault();
          setViewport(resetBandCutViewport);
        }}
        onLostPointerCapture={() => {
          dragPointer.current = undefined;
          setScrubbing(false);
          setPanning(false);
        }}
        onPointerLeave={() => {
          if (!dragPointer.current) setHoveredCutBand(undefined);
        }}
        onKeyDown={moveSelectionByKeyboard}
      />
      <g className="path-labels">
        {Array.from(pathData.pathTicks).map((tick, index) => (
          x(tick) >= 58 && x(tick) <= 713 ? (
            <text key={index} x={x(tick)} y="480" textAnchor="middle">
              {pathData.pathLabels[index]}
            </text>
          ) : null
        ))}
        {y.ticks(5).map((tick) => (
          <text key={tick} x="48" y={y(tick)} textAnchor="end">
            {tick.toFixed(yTickDecimals)}
          </text>
        ))}
      </g>
      <text className="axis-label" x="18" y="242" transform="rotate(-90 18 242)">
        energy E
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

function formatProperty(value: number | null) {
  if (value === null || Number.isNaN(value)) return "N/A";
  if (!Number.isFinite(value)) return value < 0 ? "−∞" : "∞";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  return magnitude >= 1e3 || magnitude < 1e-3
    ? value.toExponential(3)
    : value.toPrecision(5);
}

function PropertyTable({
  hoveredBand,
  onHover,
  onSelect,
  topology,
}: {
  hoveredBand?: number;
  onHover: (band?: number) => void;
  onSelect: (band: number) => void;
  topology?: TopologyResult;
}) {
  const { bands, geometry } = useResultCache();
  const parameters = useAppStore((state) => state.parameters);
  const selectedBand = useAppStore((state) => state.selectedBand);
  const geometryColumnsExpanded = useAppStore(
    (state) => state.geometryColumnsExpanded,
  );
  const setGeometryColumnsExpanded = useAppStore(
    (state) => state.setGeometryColumnsExpanded,
  );
  if (!bands) return null;
  const geometryMatches =
    geometry?.samples === bands.samples && geometry.bands === bands.bands;
  const geometryByBand = new Map(
    geometryMatches
      ? geometry.rows.map((row) => [row.band, row] as const)
      : [],
  );

  return (
    <section className="band-panel property-table-panel">
      <div className="panel-heading property-heading">
        <div>
          <span className="eyebrow">UPSTREAM BAND PROPERTIES</span>
          <div className="result-heading-title">
            <h2>Group-resolved topology table</h2>
            <HelpTooltip copy={bandResultHelp.properties} />
          </div>
        </div>
        <div className="property-heading-tools">
          <span className="surface-hint">bgt = {bands.bgt.toPrecision(3)}</span>
          <button
            className="geometry-toggle"
            aria-pressed={geometryColumnsExpanded}
            onClick={() =>
              setGeometryColumnsExpanded(!geometryColumnsExpanded)
            }
          >
            quantum geometry
          </button>
        </div>
      </div>
      {geometryColumnsExpanded && (
        <p className="geometry-cost-hint">
          runs 2 extra grid diagonalizations
          {!geometryMatches ? " · computing locally…" : ""}
        </p>
      )}
      <div className="property-table-scroll">
        <table aria-label="Band property table">
          <thead>
            <tr>
              <th>band index</th>
              <th>group index</th>
              <th>isolated</th>
              <th>width</th>
              <th>gap</th>
              <th>gap/width</th>
              <th>std_B</th>
              <th>C</th>
              {geometryColumnsExpanded && (
                <>
                  <th>std_g</th>
                  <th>av_gxx</th>
                  <th>std_gxx</th>
                  <th>av_gxy</th>
                  <th>std_gxy</th>
                  <th>⟨T⟩</th>
                  <th>⟨D⟩</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {[...bands.groupRows].reverse().map((row) => {
              const selected =
                bands.groupStart[selectedBand] === row.band
                || selectedBand === row.band;
              const hovered = hoveredBand === row.band;
              const bandLabel = row.bandEnd > row.band
                ? `${row.band}–${row.bandEnd}`
                : String(row.band);
              const select = () => onSelect(row.band);
              const geometryRow = geometryByBand.get(row.band);
              const topologyState = topologyForBand(
                bands,
                topology,
                row.band,
                baseTopologyGridSufficient(parameters, bands.samples),
              );
              return (
                <tr
                  key={row.group}
                  className={[
                    selected ? "selected" : "",
                    hovered ? "hovered" : "",
                  ].filter(Boolean).join(" ")}
                  tabIndex={0}
                  onMouseEnter={() => onHover(row.band)}
                  onMouseLeave={() => onHover(undefined)}
                  onFocus={() => onHover(row.band)}
                  onBlur={() => onHover(undefined)}
                  onClick={select}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select();
                    }
                  }}
                >
                  <td>{bandLabel}</td>
                  <td>{row.group}</td>
                  <td>{row.isolated ? "True" : "False"}</td>
                  <td>{formatProperty(row.width)}</td>
                  <td>{formatProperty(row.gap)}</td>
                  <td>{formatProperty(row.gapWidth)}</td>
                  <td>{formatProperty(row.stdB)}</td>
                  <td
                    className={
                      topologyState.resolved
                        ? ""
                        : "topology-pending-value"
                    }
                    title={
                      topologyState.resolved
                        ? "Berry/Wilson Chern invariant verified"
                        : "Select this group to resolve its topology automatically"
                    }
                  >
                    {topologyState.resolved ? topologyState.chern : "…"}
                  </td>
                  {geometryColumnsExpanded && (
                    <>
                      <td>{geometryRow ? formatProperty(geometryRow.stdG) : "…"}</td>
                      <td>{geometryRow ? formatProperty(geometryRow.averageGxx) : "…"}</td>
                      <td>{geometryRow ? formatProperty(geometryRow.stdGxx) : "…"}</td>
                      <td>{geometryRow ? formatProperty(geometryRow.averageGxy) : "…"}</td>
                      <td>{geometryRow ? formatProperty(geometryRow.stdGxy) : "…"}</td>
                      <td>{geometryRow ? formatProperty(geometryRow.averageT) : "…"}</td>
                      <td>{geometryRow ? formatProperty(geometryRow.averageD) : "…"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function principalPhase(value: number) {
  const wrapped = ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI)
    % (2 * Math.PI) - Math.PI;
  return wrapped <= -Math.PI ? Math.PI : wrapped;
}

function WilsonPlot({
  selectedIndex,
  onSelect,
  topology,
  resolving,
}: {
  selectedIndex?: number;
  onSelect: (index: number) => void;
  topology?: TopologyResult;
  resolving: boolean;
}) {
  const { bands } = useResultCache();
  const selectedBand = useAppStore((state) => state.selectedBand);
  const parameters = useAppStore((state) => state.parameters);
  if (!bands) return null;

  const topologyState = topologyForBand(
    bands,
    topology,
    selectedBand,
    baseTopologyGridSufficient(parameters, bands.samples),
  );
  const topologyData = topologyState.source;
  const samples =
    topologyCoversBand(topology, selectedBand)
      ? topology!.samplesY
      : bands.samples;
  const offset = Math.min(selectedBand, bands.bands - 1) * samples;
  const phases = Array.from(
    { length: samples },
    (_, index) => principalPhase(topologyData.wilson[offset + index]),
  );
  const topologyTrusted = topologyState.resolved;
  const chern = topologyData.chern[selectedBand] ?? 0;
  const winding = topologyData.wilsonWinding[selectedBand] ?? 0;
  const x = scaleLinear().domain([0, 1]).range([62, 906]);
  const y = scaleLinear().domain([-Math.PI, Math.PI]).range([216, 28]);
  const lineMaker = line<[number, number]>()
    .x((point) => x(point[0]))
    .y((point) => y(point[1]));
  const segments: [number, number][][] = [];
  let segment: [number, number][] = [];
  phases.forEach((phase, index) => {
    const k2 = index / Math.max(1, samples - 1);
    if (
      segment.length
      && Math.abs(phase - segment[segment.length - 1][1]) > Math.PI
    ) {
      segments.push(segment);
      segment = [];
    }
    segment.push([k2, phase]);
  });
  if (segment.length) segments.push(segment);

  function chooseRow(event: React.MouseEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * 940;
    const fraction = Math.max(0, Math.min(1, x.invert(svgX)));
    onSelect(Math.round(fraction * (samples - 1)));
  }

  function chooseRowByKeyboard(
    event: React.KeyboardEvent<SVGRectElement>,
  ) {
    const current = selectedIndex ?? 0;
    let next = current;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = samples - 1;
    else if (event.key === "PageDown") next -= Math.max(1, Math.round(samples / 10));
    else if (event.key === "PageUp") next += Math.max(1, Math.round(samples / 10));
    else return;
    event.preventDefault();
    onSelect(Math.max(0, Math.min(samples - 1, next)));
  }

  const markerX = selectedIndex === undefined
    ? undefined
    : x(selectedIndex / Math.max(1, samples - 1));
  return (
    <div className="wilson-plot-shell">
      <div className="wilson-help-trigger">
        <HelpTooltip copy={bandResultHelp.wilson} />
      </div>
      <svg
      className="wilson-plot"
      viewBox="0 0 940 252"
      role="group"
      aria-label="Wilson eigenphase versus normalized k2"
      data-wilson-points={samples}
      data-topology-status={
        topologyTrusted ? "resolved" : resolving ? "resolving" : "unavailable"
      }
      data-topology-source={
        topologyCoversBand(topology, selectedBand) ? "adaptive" : "base"
      }
      data-berry-chern={chern}
      data-wilson-winding={winding}
      >
        <rect x="0" y="0" width="940" height="252" className="panel-bg" />
        <text x="24" y="22" className="panel-kicker">
          WILSON LOOP · SELECTED BAND GROUP
        </text>
      <text
        x="916"
        y="22"
        textAnchor="end"
        className={`wilson-winding ${
          topologyTrusted ? "" : "resolving"
        }`}
      >
        {topologyTrusted
          ? `winding = C = ${chern}`
          : resolving
            ? "resolving automatically…"
            : "not certified at this parameter scale"}
      </text>
      <g className="wilson-grid">
        {[-Math.PI, 0, Math.PI].map((phase) => (
          <line
            key={phase}
            x1={62}
            x2={906}
            y1={y(phase)}
            y2={y(phase)}
          />
        ))}
      </g>
      {topologyTrusted ? (
        <>
          <g className="wilson-lines">
            {segments.map((points, index) => (
              <path key={index} d={lineMaker(points) ?? ""} />
            ))}
          </g>
          <g className="wilson-points">
            {phases.map((phase, index) => (
              <circle
                key={index}
                cx={x(index / Math.max(1, samples - 1))}
                cy={y(phase)}
                r="2.8"
              />
            ))}
          </g>
        </>
      ) : (
        <text
          className="wilson-resolving"
          x="484"
          y="126"
          textAnchor="middle"
        >
          {resolving
            ? "checking Berry/Wilson convergence…"
            : "no certified Wilson loop available"}
        </text>
      )}
      {markerX !== undefined && (
        <line
          className="wilson-marker"
          x1={markerX}
          x2={markerX}
          y1="28"
          y2="216"
        />
      )}
      {topologyTrusted && (
        <rect
          className="wilson-interaction"
          x="62"
          y="28"
          width="844"
          height="188"
          role="slider"
          tabIndex={0}
          aria-label="Selected Wilson-loop momentum row"
          aria-valuemin={0}
          aria-valuemax={samples - 1}
          aria-valuenow={selectedIndex ?? 0}
          aria-valuetext={`k2 row ${(selectedIndex ?? 0) + 1} of ${samples}`}
          onClick={chooseRow}
          onKeyDown={chooseRowByKeyboard}
        />
      )}
      <g className="wilson-labels">
        <text x="52" y={y(Math.PI)} textAnchor="end">π</text>
        <text x="52" y={y(0)} textAnchor="end">0</text>
        <text x="52" y={y(-Math.PI)} textAnchor="end">−π</text>
        <text x="62" y="239" textAnchor="middle">0</text>
        <text x="484" y="239" textAnchor="middle">0.5</text>
        <text x="906" y="239" textAnchor="middle">1</text>
        <text x="484" y="249" textAnchor="middle">k₂ / |b₂|</text>
      </g>
      </svg>
    </div>
  );
}

export function BandView({ compact = false }: { compact?: boolean }) {
  const {
    bands,
    bandsKey,
    bandsStale,
    geometry,
    geometryStale,
    topology,
    topologyKey,
    dispersion,
    dispersionKey,
  } = useResultCache();
  const selectedBand = useAppStore((state) => state.selectedBand);
  const setSelectedBand = useAppStore((state) => state.setSelectedBand);
  const metric = useAppStore((state) => state.surfaceMetric);
  const parameters = useAppStore((state) => state.parameters);
  const storedBandCutZoom = useAppStore((state) => state.bandCutZoom);
  const setBandCutZoom = useAppStore((state) => state.setBandCutZoom);
  const selectedMomentumState = useAppStore(
    (state) => state.selectedMomentum,
  );
  const setSelectedMomentum = useAppStore(
    (state) => state.setSelectedMomentum,
  );
  const [hoveredBand, setHoveredBand] = useState<number | undefined>(undefined);
  const [bandCutViewport, setBandCutViewport] = useState(
    { ...resetBandCutViewport, zoom: storedBandCutZoom },
  );
  const [torusEnabled, setTorusEnabled] = useState(false);
  const [contoursEnabled, setContoursEnabled] = useState(true);
  const [symmetryPathEnabled, setSymmetryPathEnabled] = useState(true);
  const [contourSegmentCount, setContourSegmentCount] = useState(0);
  useEffect(() => {
    if (metric === "gxx" || metric === "gxy") setTorusEnabled(false);
  }, [metric]);
  useEffect(() => {
    setBandCutViewport((current) => ({
      ...resetBandCutViewport,
      zoom: current.zoom,
    }));
  }, [bands?.requestId]);
  useEffect(() => {
    setBandCutZoom(bandCutViewport.zoom);
  }, [bandCutViewport.zoom, setBandCutZoom]);
  if (!bands) {
    return <div className="view-loading">Diagonalizing the momentum grid…</div>;
  }
  const bandKey = bandComputationKey(parameters);
  const topologyPlan = topologyRefinementPlan(parameters);
  const expectedTopologyKey = activeTopologyComputationKey(
    parameters,
    selectedBand,
    bands,
    bandsKey,
    topologyPlan,
  );
  const refinedTopology =
    topologyKey === expectedTopologyKey
      && topology?.baseSamples === bands.samples
      && topology.bands === bands.bands
      && topologyCoversBand(topology, selectedBand)
      ? topology
      : undefined;
  const baseSelectedTopology = topologyForBand(
    bands,
    undefined,
    selectedBand,
    baseTopologyGridSufficient(parameters, bands.samples),
  );
  const refinedSelectedTopology = topologyForBand(
    bands,
    refinedTopology,
    selectedBand,
    baseTopologyGridSufficient(parameters, bands.samples),
  );
  const topologyRefinementPending =
    !baseSelectedTopology.resolved
    && topologyPlan.levels.length > 0
    && !refinedTopology;
  const topologyUnavailable =
    !refinedSelectedTopology.resolved
    && !topologyRefinementPending;
  const dispersionGrid = dispersionRefinementGrid(
    parameters,
    bandCutViewport.zoom,
  );
  const expectedDispersionKey = dispersionComputationKey(
    parameters,
    dispersionGrid,
  );
  const compatibleDispersion =
    dispersionKey?.startsWith(`${bandKey}|dispersion:`)
      && dispersion?.baseSamples === bands.samples
      && dispersion.bands === bands.bands
      ? dispersion
      : undefined;
  const exactDispersion =
    dispersionKey === expectedDispersionKey
      && dispersion?.baseSamples === bands.samples
      && dispersion.bands === bands.bands
      ? dispersion
      : undefined;
  const refinedDispersion = exactDispersion ?? compatibleDispersion;
  const basePathSamplesPerSegment = Math.max(
    1,
    Math.round(
      bands.pathX.length / Math.max(1, bands.pathLabels.length - 1),
    ),
  );
  const dispersionCanRefine =
    dispersionGrid.surfaceSamples > bands.samples
    || dispersionGrid.pathSamplesPerSegment > basePathSamplesPerSegment;
  const dispersionRefinementPending =
    dispersionCanRefine && !exactDispersion;
  const pathData: BandPathData = refinedDispersion ?? bands;
  const selectedPathIndex = Math.round(
    selectedMomentumState.fraction
      * Math.max(0, pathData.pathX.length - 1),
  );
  const pathSamplesPerSegment =
    refinedDispersion?.pathSamplesPerSegment ?? basePathSamplesPerSegment;
  const wilsonSamples = refinedTopology?.samplesY ?? bands.samples;
  const selectedWilsonIndex =
    selectedMomentumState.source === "wilson"
      ? Math.round(
          selectedMomentumState.fraction * Math.max(0, wilsonSamples - 1),
        )
      : undefined;
  const markerSource = selectedMomentumState.source;
  const baseCount = bands.samples * bands.samples;
  const displayBand = Math.min(
    hoveredBand ?? selectedBand,
    bands.bands - 1,
  );
  const baseOffset = displayBand * baseCount;
  const baseEnergySurface = surfaceSlice(bands.energy, baseOffset, baseCount);
  const refinedCount =
    (refinedDispersion?.surfaceSamples ?? 0)
    * (refinedDispersion?.surfaceSamples ?? 0);
  const refinedOffset = displayBand * refinedCount;
  const energySurface = refinedDispersion
    ? surfaceSlice(refinedDispersion.energy, refinedOffset, refinedCount)
    : baseEnergySurface;
  const energySurfaceSamples =
    refinedDispersion?.surfaceSamples ?? bands.samples;
  const wantsGeometry = metric === "gxx" || metric === "gxy";
  const geometryMatches =
    geometry?.samples === bands.samples && geometry.bands === bands.bands;
  const geometrySurface = wantsGeometry && geometryMatches
    ? surfaceSlice(
        metric === "gxx" ? geometry.gxx : geometry.gxy,
        baseOffset,
        baseCount,
      )
    : undefined;
  const geometryPending = wantsGeometry && !geometryMatches;
  const surface = metric === "energy"
    ? energySurface
    : metric === "berry"
      ? surfaceSlice(bands.berry, baseOffset, baseCount)
      : geometrySurface ?? energySurface;
  const surfaceSamples =
    metric === "energy" || geometryPending
      ? energySurfaceSamples
      : bands.samples;
  const groupStart = bands.groupStart[displayBand] ?? displayBand;
  const groupSize = bands.groupSize[displayBand] ?? 1;
  const groupLast = groupStart + groupSize - 1;
  const grouped = groupSize > 1;
  const pathIndex = Math.max(
    0,
    Math.min(pathData.pathX.length - 1, selectedPathIndex),
  );
  const selectedMomentum = markerSource === "wilson"
    ? {
        k1: 0,
        k2:
          (selectedWilsonIndex ?? 0) / Math.max(1, wilsonSamples - 1),
      }
    : {
        k1: pathData.pathK1[pathIndex] ?? 0,
        k2: pathData.pathK2[pathIndex] ?? 0,
      };
  const surfaceRange = extent(surface, [-1, 1]);
  const labelOpacity = Math.max(0.12, Math.min(1, 10 / parameters.q));
  const metricLabel =
    metric === "energy"
      ? "E(k)"
      : metric === "berry"
        ? "Berry flux"
        : metric === "gxx"
          ? "gₓₓ(k)"
          : "gₓᵧ(k)";
  const torusActive = torusEnabled && !wantsGeometry;
  const torusEnergySurface =
    metric === "berry" ? baseEnergySurface : energySurface;
  const torusSamples =
    metric === "berry" ? bands.samples : energySurfaceSamples;
  const torusColorValues = metric === "berry" ? surface : energySurface;
  const displayTopology = topologyForBand(
    bands,
    refinedTopology,
    displayBand,
    baseTopologyGridSufficient(parameters, bands.samples),
  );
  const selectedTopologyTrusted = displayTopology.resolved;
  const selectedChern = displayTopology.chern;
  const zoomBandCut = (factor: number) => {
    setBandCutViewport((current) =>
      boundedBandCutViewport({
        ...current,
        zoom: current.zoom * factor,
      }),
    );
  };

  return (
    <div
      className={[
        "bands-layout",
        compact ? "compact" : "",
        bandsStale ? "is-stale" : "",
        geometryStale ? "geometry-stale" : "",
      ].filter(Boolean).join(" ")}
      data-recomputing={bandsStale}
    >
      {bandsStale && (
        <div className="recompute-chip" role="status">
          recomputing
        </div>
      )}
      {geometryPending && (
        <div className="quantum-geometry-chip" role="status">
          quantum geometry · 2 offset grids
        </div>
      )}
      <section className="band-panel band-cut-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SYMMETRY CUT</span>
            <div className="result-heading-title">
              <h2>Linked band structure</h2>
              <HelpTooltip copy={bandResultHelp.cut} />
            </div>
          </div>
          <div className="band-cut-heading-tools">
            <div
              className="adaptive-resolution-row"
              role="status"
              data-dispersion-resolution={
                dispersionRefinementPending
                  ? "refining"
                  : refinedDispersion
                    ? "optimized"
                    : "base-optimal"
              }
              data-topology-resolution={
                refinedSelectedTopology.resolved
                  ? "resolved"
                  : topologyRefinementPending
                    ? "resolving"
                    : "unavailable"
              }
            >
              {(dispersionRefinementPending || topologyRefinementPending) && (
                <span className="adaptive-resolution-chip">
                  <i />
                  optimizing{" "}
                  {dispersionRefinementPending && topologyRefinementPending
                    ? "dispersion + topology"
                    : dispersionRefinementPending
                      ? "dispersion detail"
                      : "selected topology"}
                  …
                </span>
              )}
            </div>
            <div className="band-cut-heading-row">
              <span
                className={`chern-badge ${
                  selectedTopologyTrusted ? "" : "resolving"
                }`}
                title={
                  selectedTopologyTrusted
                    ? "Berry and Wilson invariants verified"
                    : topologyUnavailable
                      ? "No certified invariant is available within the interactive compute budget"
                      : "The selected invariant is being resolved automatically"
                }
              >
                {grouped
                  ? `C${groupStart}–${groupLast} = ${
                      selectedTopologyTrusted ? selectedChern : "…"
                    }`
                  : `C = ${
                      selectedTopologyTrusted ? selectedChern : "…"
                    }`}
              </span>
              <div
                className="band-cut-zoom-controls"
                role="group"
                aria-label="Linked band structure zoom"
              >
                <button
                  type="button"
                  aria-label="Zoom out linked band structure"
                  title="Zoom out"
                  disabled={bandCutViewport.zoom <= 1.001}
                  onClick={() => zoomBandCut(1 / 1.6)}
                >
                  −
                </button>
                <button
                  type="button"
                  className="band-cut-zoom-reset"
                  aria-label="Reset linked band structure zoom"
                  title="Reset zoom and pan"
                  onClick={() => setBandCutViewport(resetBandCutViewport)}
                >
                  {bandCutViewport.zoom < 10
                    ? bandCutViewport.zoom.toFixed(1)
                    : bandCutViewport.zoom.toFixed(0)}
                  ×
                </button>
                <button
                  type="button"
                  aria-label="Zoom in linked band structure"
                  title="Zoom in"
                  disabled={
                    bandCutViewport.zoom >= BAND_CUT_MAX_ZOOM - 0.001
                  }
                  onClick={() => zoomBandCut(1.6)}
                >
                  +
                </button>
              </div>
            </div>
            <span className="band-cut-hint">
              drag point · wheel zoom · shift-drag pan
            </span>
          </div>
        </div>
        <BandCut
          pathData={pathData}
          dispersionSource={refinedDispersion ? "refined" : "base"}
          pathSamplesPerSegment={pathSamplesPerSegment}
          selectedPathIndex={selectedPathIndex}
          highlightBand={displayBand}
          viewport={bandCutViewport}
          setViewport={setBandCutViewport}
          onSelectPath={(index) => {
            setSelectedMomentum({
              source: "path",
              fraction:
                index / Math.max(1, pathData.pathX.length - 1),
            });
          }}
        />
        <WilsonPlot
          selectedIndex={
            markerSource === "wilson" ? selectedWilsonIndex : undefined
          }
          onSelect={(index) => {
            setSelectedMomentum({
              source: "wilson",
              fraction: index / Math.max(1, wilsonSamples - 1),
            });
          }}
          topology={refinedTopology}
          resolving={topologyRefinementPending}
        />
      </section>
      <section className="band-panel surface-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ROTATABLE SURFACE</span>
            <div className="result-heading-title">
              <h2>
                {metric === "berry" && grouped
                  ? `Bands ${groupStart}–${groupLast}`
                  : `Band ${displayBand}`}{" "}
                · {metricLabel}
              </h2>
              <HelpTooltip copy={bandResultHelp.surface} />
            </div>
          </div>
          <div className="surface-heading-tools">
            <div className="surface-toggle-row">
              <button
                className="surface-toggle symmetry-path-toggle"
                aria-pressed={symmetryPathEnabled && !torusActive}
                disabled={torusActive}
                title={
                  torusActive
                    ? "The Γ-path overlay is shown on the rectangular magnetic BZ"
                    : "Show Γ–X/K–M–Y/K′–Γ on the base plane and selected energy surface"
                }
                onClick={() =>
                  setSymmetryPathEnabled((enabled) => !enabled)
                }
              >
                Γ path
              </button>
              <button
                className="surface-toggle contour-toggle"
                aria-pressed={contoursEnabled}
                title={
                  torusActive
                    ? `Wrap ${CONTOUR_LEVEL_COUNT} iso-contours around the surface`
                    : `Project ${CONTOUR_LEVEL_COUNT} iso-contours and the metric field onto the base plane`
                }
                onClick={() => setContoursEnabled((enabled) => !enabled)}
              >
                Contours
              </button>
              <button
                className="surface-toggle torus-toggle"
                aria-pressed={torusActive}
                disabled={wantsGeometry}
                title={
                  wantsGeometry
                    ? "The educational torus is available for energy and Berry coloring"
                    : "Morph the periodic magnetic Brillouin zone into a torus"
                }
                onClick={() => setTorusEnabled((enabled) => !enabled)}
              >
                BZ torus
              </button>
            </div>
            <span className="surface-hint">
              k = ({selectedMomentum.k1.toFixed(3)}, {selectedMomentum.k2.toFixed(3)})
            </span>
          </div>
        </div>
        <div
          className="surface-canvas"
          data-symmetry-points={bands.symPoints.length}
          data-mbz-vertices={bands.bz.length / 2}
          data-ordinary-bz-vertices={bands.ordinaryBz.length / 2}
          data-path-points={pathData.pathX.length}
          data-path-samples-per-segment={pathSamplesPerSegment}
          data-surface-samples={
            torusActive ? torusSamples : surfaceSamples
          }
          data-dispersion-source={
            refinedDispersion && (metric === "energy" || geometryPending)
              ? "refined"
              : "base"
          }
          data-symmetry-path={
            symmetryPathEnabled && !torusActive ? "visible" : "hidden"
          }
          data-lifted-path-energy-source={
            symmetryPathEnabled
              && !torusActive
              && (metric === "energy" || geometryPending)
              ? "display-surface"
              : "hidden"
          }
          data-surface-topology={torusActive ? "torus" : "sheet"}
          data-dispersion-relief={torusActive ? "0.56" : "0"}
          data-reference-torus={torusActive ? "visible" : "hidden"}
          data-marker-visibility="always"
          data-marker-tracking={torusActive ? "halo-reticle" : "halo-leader"}
          data-contours={
            contoursEnabled ? (torusActive ? "wrapped" : "projected") : "hidden"
          }
          data-contour-levels={contoursEnabled ? CONTOUR_LEVEL_COUNT : 0}
          data-contour-segments={
            contoursEnabled ? contourSegmentCount : 0
          }
          data-contour-projection={
            contoursEnabled && !torusActive ? "heatmap" : "hidden"
          }
          data-contour-stroke={
            contoursEnabled && !torusActive ? "ribbon" : "line"
          }
        >
          <Canvas
            camera={{ position: [3.6, 2.5, 4.2], fov: 42 }}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            dpr={[1, 2]}
          >
            <color attach="background" args={["#0b1624"]} />
            <ambientLight intensity={1.3} />
            <directionalLight position={[4, 5, 3]} intensity={2.8} />
            <directionalLight position={[-3, 1, -2]} intensity={0.8} color="#5cf2ce" />
            <Surface
              heightValues={torusActive ? torusEnergySurface : surface}
              colorValues={torusActive ? torusColorValues : surface}
              samples={torusActive ? torusSamples : surfaceSamples}
              marker={selectedMomentum}
              torus={torusActive}
              contours={contoursEnabled}
              onContourCount={setContourSegmentCount}
            />
            {!torusActive && (
              <ReciprocalOverlays
                bands={bands}
                pathData={pathData}
                energyValues={energySurface}
                surfaceSamples={energySurfaceSamples}
                showPath={symmetryPathEnabled}
                showLiftedPath={
                  symmetryPathEnabled
                  && (metric === "energy" || geometryPending)
                }
                labelOpacity={labelOpacity}
              />
            )}
            {!torusActive && !contoursEnabled && (
              <gridHelper
                args={[4.4, 10, "#33506a", "#172a3a"]}
                position={[0, -0.9, 0]}
              />
            )}
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
          <span>
            {metric === "energy"
              ? "E"
              : metric === "berry"
                ? "ℬ₁₂"
                : metric === "gxx"
                  ? "gₓₓ"
                  : "gₓᵧ"}
          </span>
          <span>k₂ / |b₂|</span>
        </div>
        <div className="surface-legend" aria-label={`${metric} color scale`}>
          <span>{surfaceRange[0].toFixed(3)}</span>
          <i />
          <span>{surfaceRange[1].toFixed(3)}</span>
        </div>
        <p className="surface-note">
          {torusActive ? (
            metric === "berry"
              ? contoursEnabled
                ? "BZ torus · radial relief = E(k) · color + contours = Berry flux · reticle = selected k"
                : "BZ torus · radial relief = E(k), color = Berry flux · reticle = selected k"
              : contoursEnabled
                ? "BZ torus · radial relief + contours = normalized E(k) · reticle = selected k"
                : "BZ torus · radial relief exaggerates normalized E(k) · reticle = selected k"
          ) : geometryPending ? (
            contoursEnabled
              ? "computing the lazy quantum metric locally · E(k) field + high-contrast contours projected below"
              : "computing the lazy quantum metric locally · energy remains visible"
          ) : wantsGeometry ? (
            contoursEnabled
              ? "group-resolved Fubini–Study metric · field + high-contrast contours projected below"
              : "group-resolved Fubini–Study metric · finite-difference projector derivatives"
          ) : metric === "berry" && !selectedTopologyTrusted ? (
            topologyRefinementPending
              ? "Berry field · verifying the selected invariant automatically"
              : "Berry field · no certified integral is available at this parameter scale"
          ) : metric === "berry" && grouped ? (
            <>
            Non-Abelian Berry flux for bands {groupStart}–{groupLast}
            {groupSize === bands.bands
              ? " · complete bundle integrates to C = 0"
              : ""}
            {contoursEnabled
              ? " · field + high-contrast contours projected below"
              : ""}
            </>
          ) : (
            contoursEnabled
              ? "sphere = symmetry-cut k · adaptive energy detail · Γ path follows the displayed surface · field + contours projected below"
              : "sphere = symmetry-cut k · adaptive energy detail · Γ path follows the displayed surface · drag to orbit"
          )}
        </p>
      </section>
      <PropertyTable
        hoveredBand={hoveredBand}
        onHover={setHoveredBand}
        onSelect={(band) => {
          setSelectedBand(band);
          setHoveredBand(undefined);
        }}
        topology={refinedTopology}
      />
    </div>
  );
}
