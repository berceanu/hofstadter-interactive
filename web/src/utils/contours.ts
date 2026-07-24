export interface ContourVertex {
  x: number;
  y: number;
  height: number;
}

export interface ContourSegment {
  start: ContourVertex;
  end: ContourVertex;
  normalizedLevel: number;
}

interface Corner extends ContourVertex {
  value: number;
}

function interpolateEdge(
  first: Corner,
  second: Corner,
  level: number,
): ContourVertex {
  const span = second.value - first.value;
  const fraction = Math.abs(span) < 1e-12
    ? 0.5
    : Math.max(0, Math.min(1, (level - first.value) / span));
  return {
    x: first.x + (second.x - first.x) * fraction,
    y: first.y + (second.y - first.y) * fraction,
    height: first.height + (second.height - first.height) * fraction,
  };
}

export function extractContourSegments(
  values: ArrayLike<number>,
  normalizedHeights: ArrayLike<number>,
  samples: number,
  levelCount = 7,
): ContourSegment[] {
  const expectedLength = samples * samples;
  if (
    samples < 2
    || levelCount < 1
    || values.length < expectedLength
    || normalizedHeights.length < expectedLength
  ) {
    return [];
  }

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < expectedLength; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const span = maximum - minimum;
  if (!Number.isFinite(span) || span < 1e-12) return [];

  const segments: ContourSegment[] = [];
  for (let levelIndex = 1; levelIndex <= levelCount; levelIndex += 1) {
    const normalizedLevel = levelIndex / (levelCount + 1);
    const level = minimum + normalizedLevel * span;
    for (let x = 0; x < samples - 1; x += 1) {
      for (let y = 0; y < samples - 1; y += 1) {
        const index00 = x * samples + y;
        const index10 = (x + 1) * samples + y;
        const index11 = (x + 1) * samples + y + 1;
        const index01 = x * samples + y + 1;
        const corners: [Corner, Corner, Corner, Corner] = [
          {
            x,
            y,
            value: values[index00],
            height: normalizedHeights[index00],
          },
          {
            x: x + 1,
            y,
            value: values[index10],
            height: normalizedHeights[index10],
          },
          {
            x: x + 1,
            y: y + 1,
            value: values[index11],
            height: normalizedHeights[index11],
          },
          {
            x,
            y: y + 1,
            value: values[index01],
            height: normalizedHeights[index01],
          },
        ];
        if (
          corners.some(
            (corner) =>
              !Number.isFinite(corner.value)
              || !Number.isFinite(corner.height),
          )
        ) {
          continue;
        }

        const mask =
          (corners[0].value >= level ? 1 : 0)
          | (corners[1].value >= level ? 2 : 0)
          | (corners[2].value >= level ? 4 : 0)
          | (corners[3].value >= level ? 8 : 0);
        if (mask === 0 || mask === 15) continue;

        const edgeVertex = (edge: number) => {
          switch (edge) {
            case 0:
              return interpolateEdge(corners[0], corners[1], level);
            case 1:
              return interpolateEdge(corners[1], corners[2], level);
            case 2:
              return interpolateEdge(corners[2], corners[3], level);
            default:
              return interpolateEdge(corners[3], corners[0], level);
          }
        };
        const addSegment = (firstEdge: number, secondEdge: number) => {
          segments.push({
            start: edgeVertex(firstEdge),
            end: edgeVertex(secondEdge),
            normalizedLevel,
          });
        };

        switch (mask) {
          case 1:
            addSegment(3, 0);
            break;
          case 2:
            addSegment(0, 1);
            break;
          case 3:
            addSegment(3, 1);
            break;
          case 4:
            addSegment(1, 2);
            break;
          case 5: {
            const center =
              (corners[0].value
                + corners[1].value
                + corners[2].value
                + corners[3].value)
              / 4;
            if (center >= level) {
              addSegment(0, 1);
              addSegment(2, 3);
            } else {
              addSegment(3, 0);
              addSegment(1, 2);
            }
            break;
          }
          case 6:
            addSegment(0, 2);
            break;
          case 7:
            addSegment(3, 2);
            break;
          case 8:
            addSegment(2, 3);
            break;
          case 9:
            addSegment(0, 2);
            break;
          case 10: {
            const center =
              (corners[0].value
                + corners[1].value
                + corners[2].value
                + corners[3].value)
              / 4;
            if (center >= level) {
              addSegment(3, 0);
              addSegment(1, 2);
            } else {
              addSegment(0, 1);
              addSegment(2, 3);
            }
            break;
          }
          case 11:
            addSegment(1, 2);
            break;
          case 12:
            addSegment(1, 3);
            break;
          case 13:
            addSegment(0, 1);
            break;
          case 14:
            addSegment(3, 0);
            break;
        }
      }
    }
  }
  return segments;
}
