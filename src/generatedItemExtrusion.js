export function alphaMaskFromImageData(imageData, alphaThreshold = 0.1) {
  if (!imageData || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height) || !imageData.data) {
    return [];
  }

  const width = imageData.width;
  const height = imageData.height;
  const pixels = imageData.data;
  const threshold = Math.max(0, Math.min(1, alphaThreshold)) * 255;
  const mask = new Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      mask[y * width + x] = pixels[offset + 3] > threshold;
    }
  }

  return mask;
}

export function buildGeneratedItemExtrusion(mask, width, height, depth = 1) {
  if (!Array.isArray(mask) || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { frontBackRects: [], sideRects: [] };
  }

  const frontBackRects = mergeOpaqueRects(mask, width, height);
  const sideRects = {
    north: mergeEdgeSegments(mask, width, height, "north"),
    south: mergeEdgeSegments(mask, width, height, "south"),
    east: mergeEdgeSegments(mask, width, height, "east"),
    west: mergeEdgeSegments(mask, width, height, "west")
  };

  return {
    frontBackRects,
    sideRects,
    depth
  };
}

function mergeOpaqueRects(mask, width, height) {
  const claimed = new Array(mask.length).fill(false);
  const rects = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!mask[start] || claimed[start]) {
        continue;
      }

      let runWidth = 1;
      while (x + runWidth < width) {
        const next = y * width + (x + runWidth);
        if (!mask[next] || claimed[next]) {
          break;
        }
        runWidth += 1;
      }

      let runHeight = 1;
      while (y + runHeight < height) {
        let rowFits = true;
        for (let dx = 0; dx < runWidth; dx += 1) {
          const next = (y + runHeight) * width + (x + dx);
          if (!mask[next] || claimed[next]) {
            rowFits = false;
            break;
          }
        }
        if (!rowFits) {
          break;
        }
        runHeight += 1;
      }

      for (let dy = 0; dy < runHeight; dy += 1) {
        for (let dx = 0; dx < runWidth; dx += 1) {
          claimed[(y + dy) * width + (x + dx)] = true;
        }
      }

      rects.push({ x, y, width: runWidth, height: runHeight });
    }
  }

  return rects;
}

function mergeEdgeSegments(mask, width, height, direction) {
  const segments = [];

  if (direction === "north" || direction === "south") {
    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        if (!hasEdge(mask, width, height, x, y, direction)) {
          x += 1;
          continue;
        }
        const startX = x;
        while (x < width && hasEdge(mask, width, height, x, y, direction)) {
          x += 1;
        }
        segments.push({ x: startX, y, length: x - startX });
      }
    }
    return segments;
  }

  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      if (!hasEdge(mask, width, height, x, y, direction)) {
        y += 1;
        continue;
      }
      const startY = y;
      while (y < height && hasEdge(mask, width, height, x, y, direction)) {
        y += 1;
      }
      segments.push({ x, y: startY, length: y - startY });
    }
  }

  return segments;
}

function hasEdge(mask, width, height, x, y, direction) {
  if (!mask[y * width + x]) {
    return false;
  }

  if (direction === "north") {
    return y === 0 || !mask[(y - 1) * width + x];
  }
  if (direction === "south") {
    return y === height - 1 || !mask[(y + 1) * width + x];
  }
  if (direction === "west") {
    return x === 0 || !mask[y * width + (x - 1)];
  }
  return x === width - 1 || !mask[y * width + (x + 1)];
}
