const DIRECTIONS = ["east", "west", "up", "down", "south", "north"];
const GENERATED_ITEM_PARENTS = new Set(["minecraft:item/generated", "item/generated", "minecraft:builtin/generated", "builtin/generated"]);

export function parseMinecraftModel(source, filename = "model.json", options = {}) {
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
      modelKind: "invalid",
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

  const parentResolution = resolveParentModel(model, {
    modelPath: options.modelPath ?? filename,
    modelIndex: options.resourcePackIndex?.models,
    warnings,
    errors
  });
  const effectiveModel = parentResolution.model;
  const textures = normalizeTextures(effectiveModel?.textures, warnings);
  const modelKind = determineModelKind(effectiveModel, textures);
  const elements = normalizeElements(effectiveModel?.elements, warnings, errors, { allowMissingElements: modelKind !== "cuboid" });

  if (modelKind === "generated_item") {
    warnings.push(
      "Generated item model uses a sprite preview from textures.layer0; pixel extrusion/thickness is not yet supported."
    );
  }

  if (modelKind === "particle_placeholder") {
    warnings.push(
      "Elementless model uses textures.particle only; rendering a placeholder because block-entity/special-renderer fidelity is not yet supported."
    );
  }

  const textureReferences = collectTextureReferences(elements, textures, modelKind);

  return {
    ok: errors.length === 0,
    filename,
    model: effectiveModel,
    sourceModel: model,
    parentChain: parentResolution.parentChain,
    modelKind,
    elements,
    textures,
    textureReferences,
    errors,
    warnings
  };
}

export function createPreviewSummary(parsed, resolvedTextureReferences = new Set()) {
  const unresolvedTextureReferences = [...parsed.textureReferences].filter((reference) => !resolvedTextureReferences.has(reference));
  const blockingUnresolvedTextureReferences =
    parsed.modelKind === "particle_placeholder" ? [] : unresolvedTextureReferences;
  const blockers = [
    ...parsed.errors.map((message) => ({ code: "validation-error", message })),
    ...blockingUnresolvedTextureReferences.map((reference) => ({
      code: "unresolved-texture-reference",
      message: `Texture reference could not be resolved: ${reference}`,
      reference
    }))
  ];
  const hasBlockers = blockers.length > 0;
  const reasons = hasBlockers
    ? blockers.map((item) => item.message)
    : parsed.warnings.length > 0
      ? ["Validation passed with warnings."]
      : ["Validation passed without issues."];
  const suggestedNextSteps = hasBlockers
    ? buildRevisionSteps(parsed, unresolvedTextureReferences)
    : buildApprovalSteps(parsed);

  return {
    ok: !hasBlockers,
    status: hasBlockers ? "fail" : parsed.warnings.length > 0 ? "pass_with_warnings" : "pass",
    decision: hasBlockers ? "revise_asset" : "request_user_approval",
    filename: parsed.filename,
    modelKind: parsed.modelKind,
    elementCount: parsed.elements.length,
    textureCount: Object.keys(parsed.textures).length,
    textureReferences: parsed.textureReferences,
    unresolvedTextureReferences,
    errors: parsed.errors,
    warnings: parsed.warnings,
    reasons,
    blockers,
    suggestedNextSteps,
    agentGuidance: {
      recommendedAction: hasBlockers ? "revise_asset" : "request_user_approval",
      confidence: "high",
      rationale: reasons
    },
    metadata: {
      hasElements: parsed.elements.length > 0,
      previewMode: parsed.modelKind,
      parentChain: parsed.parentChain ?? [],
      hasWarnings: parsed.warnings.length > 0,
      hasErrors: parsed.errors.length > 0,
      hasUnresolvedTextures: unresolvedTextureReferences.length > 0
    }
  };
}

export function createStatusFeedback(summary) {
  const hasValidationErrors = summary.errors.length > 0;
  const hasBlockingUnresolvedTextures = summary.blockers.some(
    (blocker) => blocker.code === "unresolved-texture-reference"
  );

  if (hasValidationErrors && hasBlockingUnresolvedTextures) {
    return {
      className: "status status-error",
      message:
        "Preview loaded with validation errors and missing texture files. Fix the listed model JSON errors and add the listed textures to see the asset correctly."
    };
  }

  if (hasValidationErrors) {
    return {
      className: "status status-error",
      message: "The model JSON has validation errors that need to be fixed before it can be previewed reliably."
    };
  }

  if (hasBlockingUnresolvedTextures) {
    return {
      className: "status status-error",
      message:
        "Preview loaded, but required texture files are missing or did not match the model references. Add the listed textures to see the asset correctly."
    };
  }

  if (summary.warnings.length > 0) {
    return {
      className: "status status-warning",
      message: "Preview loaded with warnings. Review the feedback before approving the asset."
    };
  }

  return {
    className: "status status-ok",
    message: "Preview loaded successfully."
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
  const namespace = noExt.includes(":") ? noExt.split(":")[0] : "minecraft";
  const noNamespace = noExt.includes(":") ? noExt.split(":").slice(1).join(":") : noExt;
  const withBlock = noNamespace.startsWith("block/") ? noNamespace : `block/${noNamespace}`;
  const variants = [
    `${noExt}.png`,
    `${noNamespace}.png`,
    `${withBlock}.png`,
    `textures/${noNamespace}.png`,
    `textures/${withBlock}.png`,
    `assets/${namespace}/textures/${noNamespace}.png`,
    `assets/${namespace}/textures/${withBlock}.png`,
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

  return normalizeResourcePath(texturePath);
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

export function resolveTextureReference(reference, textures) {
  if (!reference || typeof reference !== "string") {
    return reference;
  }

  let current = reference;
  const seen = new Set();

  while (current.startsWith("#")) {
    const key = current.replace(/^#/, "");
    if (seen.has(key) || typeof textures[key] !== "string") {
      return current;
    }
    seen.add(key);
    current = textures[key];
  }

  return current;
}

export function normalizeResourcePath(resourcePath) {
  if (!resourcePath || typeof resourcePath !== "string") {
    return "";
  }

  const rawParts = resourcePath
    .replace(/\\/g, "/")
    .replace(/^[./]+/, "")
    .split("/")
    .filter((part) => part && part !== ".");
  const parts = [];
  for (const part of rawParts) {
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const assetsIndex = parts.indexOf("assets");
  const normalizedParts = assetsIndex >= 0 ? parts.slice(assetsIndex) : parts;

  return `/${normalizedParts.join("/")}`;
}

export function createResourcePackIndex(entries = []) {
  const models = new Map();
  const textures = new Map();

  for (const entry of entries) {
    const path = normalizeResourcePath(entry.path ?? entry.webkitRelativePath ?? entry.name);
    if (!path) {
      continue;
    }

    if (isModelPath(path)) {
      models.set(path, entry.source ?? entry.model ?? entry.file ?? entry);
      continue;
    }

    if (isTexturePath(path)) {
      textures.set(path, entry.texture ?? entry.file ?? entry);
    }
  }

  return { models, textures };
}

export function modelReferenceCandidates(reference, currentModelPath = "", defaultNamespace = "minecraft") {
  if (!reference || typeof reference !== "string") {
    return [];
  }

  const cleanReference = reference.replace(/\\/g, "/").replace(/^\//, "").replace(/\.json$/, "");
  const namespaceFromPath = namespaceFromModelPath(currentModelPath) ?? defaultNamespace;
  const currentModelId = modelIdFromPath(currentModelPath);
  const candidates = [];

  if (cleanReference.includes(":")) {
    const [namespace, ...idParts] = cleanReference.split(":");
    const id = idParts.join(":");
    if (namespace && id) {
      candidates.push(modelIdToPath(namespace, id));
    }
  } else {
    if (cleanReference.startsWith("block/") || cleanReference.startsWith("item/") || cleanReference.startsWith("builtin/")) {
      candidates.push(modelIdToPath(namespaceFromPath, cleanReference));
      candidates.push(modelIdToPath(defaultNamespace, cleanReference));
    }

    if (currentModelId && !cleanReference.includes("/")) {
      const currentDir = currentModelId.split("/").slice(0, -1).join("/");
      if (currentDir) {
        candidates.push(modelIdToPath(namespaceFromPath, `${currentDir}/${cleanReference}`));
      }
    }

    candidates.push(modelIdToPath(namespaceFromPath, cleanReference));
    candidates.push(modelIdToPath(defaultNamespace, cleanReference));
  }

  return [...new Set(candidates.map((candidate) => normalizeResourcePath(candidate)))];
}

export function findModelPathForFilename(filename, resourcePackIndex) {
  if (!filename || !resourcePackIndex?.models) {
    return null;
  }

  const normalizedName = normalizeResourcePath(filename).split("/").pop();
  const matches = [...resourcePackIndex.models.keys()].filter((path) => path.endsWith(`/${normalizedName}`));

  return matches.length === 1 ? matches[0] : null;
}

function isModelPath(path) {
  return /^\/assets\/[^/]+\/models\/.+\.json$/i.test(path);
}

function isTexturePath(path) {
  return /^\/assets\/[^/]+\/textures\/.+\.png$/i.test(path);
}

function modelIdToPath(namespace, id) {
  return `/assets/${namespace}/models/${id}.json`;
}

function namespaceFromModelPath(modelPath) {
  const match = normalizeResourcePath(modelPath).match(/^\/assets\/([^/]+)\/models\//);
  return match?.[1] ?? null;
}

function modelIdFromPath(modelPath) {
  const match = normalizeResourcePath(modelPath).match(/^\/assets\/[^/]+\/models\/(.+)\.json$/);
  return match?.[1] ?? null;
}

function resolveParentModel(model, context) {
  if (!context.modelIndex || !model || typeof model !== "object" || Array.isArray(model)) {
    return { model, parentChain: [] };
  }

  return resolveParentModelRecursive(model, context.modelPath, context, []);
}

function resolveParentModelRecursive(model, modelPath, context, stack) {
  const parent = model?.parent;
  if (typeof parent !== "string") {
    return { model, parentChain: [] };
  }

  const parentPath = resolveParentPath(parent, modelPath, context.modelIndex);
  if (!parentPath) {
    context.warnings.push(`Parent model could not be resolved: ${parent}`);
    return { model, parentChain: [] };
  }

  if (stack.includes(parentPath)) {
    context.errors.push(`Parent model cycle detected: ${[...stack, parentPath].join(" -> ")}`);
    return { model, parentChain: [parentPath] };
  }

  const parentModel = readIndexedModel(parentPath, context.modelIndex, context.warnings);
  if (!parentModel) {
    context.warnings.push(`Parent model could not be read: ${parent}`);
    return { model, parentChain: [parentPath] };
  }

  const resolvedParent = resolveParentModelRecursive(parentModel, parentPath, context, [...stack, parentPath]);
  const parentChain = [parentPath, ...resolvedParent.parentChain];
  const merged = {
    ...resolvedParent.model,
    ...model,
    textures: {
      ...normalizeRawTextures(resolvedParent.model?.textures),
      ...normalizeRawTextures(model.textures)
    }
  };

  if (!Array.isArray(model.elements) && Array.isArray(resolvedParent.model?.elements)) {
    merged.elements = resolvedParent.model.elements;
  }

  return { model: merged, parentChain };
}

function resolveParentPath(parent, modelPath, modelIndex) {
  for (const candidate of modelReferenceCandidates(parent, modelPath)) {
    if (modelIndex.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readIndexedModel(path, modelIndex, warnings) {
  const entry = modelIndex.get(path);
  const source = typeof entry === "string" ? entry : entry?.source;

  if (source === undefined && entry && typeof entry === "object" && !("text" in entry)) {
    return entry;
  }

  if (typeof source !== "string") {
    warnings.push(`Indexed parent model has no JSON source: ${path}`);
    return null;
  }

  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push(`Indexed parent model root must be a JSON object: ${path}`);
      return null;
    }
    return parsed;
  } catch (error) {
    warnings.push(`Indexed parent model is invalid JSON: ${path}: ${error.message}`);
    return null;
  }
}

function normalizeRawTextures(textures) {
  if (!textures || typeof textures !== "object" || Array.isArray(textures)) {
    return {};
  }

  return Object.fromEntries(Object.entries(textures).filter(([, value]) => typeof value === "string"));
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

function normalizeElements(elements, warnings, errors, options = {}) {
  if (elements === undefined && options.allowMissingElements) {
    return [];
  }

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

function collectTextureReferences(elements, textures, modelKind) {
  const references = new Set();

  if (modelKind === "generated_item" && textures.layer0) {
    references.add(resolveTextureReference(textures.layer0, textures));
  }

  if (modelKind === "particle_placeholder" && textures.particle) {
    references.add(resolveTextureReference(textures.particle, textures));
  }

  for (const element of elements) {
    for (const face of Object.values(element.faces)) {
      if (!face.texture) {
        continue;
      }

      references.add(resolveTextureReference(face.texture, textures));
    }
  }

  return [...references].sort();
}

function determineModelKind(model, textures) {
  const hasElements = Array.isArray(model?.elements) && model.elements.length > 0;

  if (!hasElements && isGeneratedItemParent(model?.parent) && typeof textures.layer0 === "string") {
    return "generated_item";
  }

  if (!hasElements && typeof textures.particle === "string") {
    return "particle_placeholder";
  }

  return "cuboid";
}

function isGeneratedItemParent(parent) {
  return typeof parent === "string" && GENERATED_ITEM_PARENTS.has(parent);
}

function buildRevisionSteps(parsed, unresolvedTextureReferences) {
  const steps = [];
  if (parsed.errors.length > 0) {
    steps.push("Fix all validation errors in the model JSON before requesting approval.");
  }
  if (unresolvedTextureReferences.length > 0) {
    steps.push("Provide texture files for unresolved references or update model texture mappings.");
  }
  if (parsed.elements.length === 0) {
    steps.push("Add at least one valid element cuboid to the model.");
  }
  return steps;
}

function buildApprovalSteps(parsed) {
  const steps = ["Share preview.html with the user and ask whether the preview matches the requested asset."];
  if (parsed.warnings.length > 0) {
    steps.push("Include the warnings in your message so the user can decide whether they are acceptable.");
  }
  return steps;
}
