const DIRECTIONS = ["east", "west", "up", "down", "south", "north"];

export function parseMinecraftModel(source, filename = "model.json") {
  const errors = [];
  const warnings = [];
  let model;

  try {
    model = JSON.parse(source);
  } catch (error) {
    return {
      ok: false,
      filename,
      model: null,
      elements: [],
      textures: {},
      textureReferences: [],
      errors: [`Invalid JSON: ${error.message}`],
      warnings
    };
  }

  if (!model || typeof model !== "object" || Array.isArray(model)) {
    errors.push("Model root must be a JSON object.");
  }

  const textures = normalizeTextures(model?.textures, warnings);
  const elements = normalizeElements(model?.elements, warnings, errors);
  const textureReferences = collectTextureReferences(elements, textures);

  return {
    ok: errors.length === 0,
    filename,
    model,
    elements,
    textures,
    textureReferences,
    errors,
    warnings
  };
}

export function createPreviewSummary(parsed, resolvedTextureReferences = new Set()) {
  const unresolvedTextureReferences = [...parsed.textureReferences].filter((reference) => !resolvedTextureReferences.has(reference));

  return {
    ok: parsed.ok,
    filename: parsed.filename,
    elementCount: parsed.elements.length,
    textureCount: Object.keys(parsed.textures).length,
    textureReferences: parsed.textureReferences,
    unresolvedTextureReferences,
    errors: parsed.errors,
    warnings: parsed.warnings
  };
}

export function textureBasename(texturePath) {
  if (!texturePath || typeof texturePath !== "string") {
    return "";
  }

  return texturePath.replace(/^#/, "").split("/").pop().replace(/\.[^.]+$/, "");
}

export function textureCandidates(texturePath) {
  if (!texturePath || typeof texturePath !== "string") {
    return [];
  }

  const raw = texturePath.replace(/^#/, "").replace(/\\/g, "/").replace(/^\//, "");
  const noExt = raw.replace(/\.[^.]+$/, "");
  const noNamespace = noExt.includes(":") ? noExt.split(":").slice(1).join(":") : noExt;
  const withBlock = noNamespace.startsWith("block/") ? noNamespace : `block/${noNamespace}`;
  const variants = [
    `${noExt}.png`,
    `${noNamespace}.png`,
    `${withBlock}.png`,
    `textures/${noNamespace}.png`,
    `textures/${withBlock}.png`,
    `assets/minecraft/textures/${noNamespace}.png`,
    `assets/minecraft/textures/${withBlock}.png`,
    `${textureBasename(noExt)}.png`
  ];

  return [...new Set(variants.map((variant) => normalizeTexturePath(variant)))];
}

export function normalizeTexturePath(texturePath) {
  if (!texturePath || typeof texturePath !== "string") {
    return "";
  }

  return `/${texturePath.replace(/\\/g, "/").replace(/^\//, "")}`;
}

export function resolveUploadedTexture(texturePath, uploadedTextureIndex) {
  const candidates = textureCandidates(texturePath);

  for (const candidate of candidates) {
    const texture = uploadedTextureIndex.get(candidate);
    if (texture) {
      return texture;
    }
  }

  return null;
}

function normalizeTextures(textures, warnings) {
  if (textures === undefined) {
    return {};
  }

  if (!textures || typeof textures !== "object" || Array.isArray(textures)) {
    warnings.push("`textures` should be an object.");
    return {};
  }

  return Object.fromEntries(
    Object.entries(textures)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value])
  );
}

function normalizeElements(elements, warnings, errors) {
  if (!Array.isArray(elements)) {
    errors.push("Model must include an `elements` array.");
    return [];
  }

  return elements.flatMap((element, index) => {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      warnings.push(`Element ${index} is not an object and was skipped.`);
      return [];
    }

    const from = normalizeVector(element.from, `elements[${index}].from`, warnings);
    const to = normalizeVector(element.to, `elements[${index}].to`, warnings);

    if (!from || !to) {
      warnings.push(`Element ${index} is missing valid from/to coordinates and was skipped.`);
      return [];
    }

    for (let axis = 0; axis < 3; axis += 1) {
      if (to[axis] <= from[axis]) {
        warnings.push(`Element ${index} has non-positive size on axis ${axis}.`);
      }

      if (from[axis] < 0 || to[axis] > 16) {
        warnings.push(`Element ${index} extends outside the standard 0..16 Minecraft model bounds.`);
      }
    }

    return [
      {
        name: element.name ?? `Element ${index + 1}`,
        from,
        to,
        faces: normalizeFaces(element.faces, index, warnings)
      }
    ];
  });
}

function normalizeVector(value, label, warnings) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => Number.isFinite(item))) {
    warnings.push(`${label} must be an array of three finite numbers.`);
    return null;
  }

  return value;
}

function normalizeFaces(faces, elementIndex, warnings) {
  if (faces === undefined) {
    warnings.push(`Element ${elementIndex} has no faces.`);
    return {};
  }

  if (!faces || typeof faces !== "object" || Array.isArray(faces)) {
    warnings.push(`Element ${elementIndex} faces should be an object.`);
    return {};
  }

  const normalized = {};

  for (const direction of DIRECTIONS) {
    const face = faces[direction];
    if (!face || typeof face !== "object" || Array.isArray(face)) {
      continue;
    }

    normalized[direction] = {
      texture: typeof face.texture === "string" ? face.texture : null,
      uv: normalizeFaceUv(face.uv, elementIndex, direction, warnings)
    };
  }

  return normalized;
}

function normalizeFaceUv(uv, elementIndex, direction, warnings) {
  if (uv === undefined) {
    return null;
  }

  if (!Array.isArray(uv) || uv.length !== 4 || !uv.every((value) => Number.isFinite(value))) {
    warnings.push(`elements[${elementIndex}].faces.${direction}.uv must be an array of four finite numbers.`);
    return null;
  }

  return uv;
}

function collectTextureReferences(elements, textures) {
  const references = new Set();

  for (const element of elements) {
    for (const face of Object.values(element.faces)) {
      if (!face.texture) {
        continue;
      }

      const textureKey = face.texture.replace(/^#/, "");
      references.add(textures[textureKey] ?? face.texture);
    }
  }

  return [...references].sort();
}
