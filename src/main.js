import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./style.css";
import {
  createResourcePackIndex,
  createPreviewSummary,
  createStatusFeedback,
  filterModelPaths,
  findAmbiguousModelBaseNames,
  findModelPathForFilename,
  listIndexedModelPaths,
  modelBaseName,
  modelCategory,
  modelDisplayName,
  normalizeTexturePath,
  parseMinecraftModel,
  resolveTextureReference,
  resolveUploadedTexture
} from "./modelCore.js";
import {
  alphaMaskFromImageData,
  buildGeneratedItemExtrusion,
  horizontalEdgeUv,
  rectUv,
  verticalEdgeUv
} from "./generatedItemExtrusion.js";
import { createReviewPayload, serializeReviewPayload, validateReviewInput } from "./reviewFeedback.js";

const assetFolderInput = document.querySelector("#asset-folder");
const modelInput = document.querySelector("#model-file");
const textureInput = document.querySelector("#texture-files");
const statusNode = document.querySelector("#status");
const summaryNode = document.querySelector("#summary");
const canvas = document.querySelector("#viewer");
const modelBrowser = document.querySelector("#model-browser");
const modelSearchInput = document.querySelector("#model-search");
const modelListNode = document.querySelector("#model-list");
const modelListNoteNode = document.querySelector("#model-list-note");
const reviewPanel = document.querySelector("#review-panel");
const reviewStatusNode = document.querySelector("#review-status");
const reviewFeedbackInput = document.querySelector("#review-feedback");
const reviewAcceptButton = document.querySelector("#review-accept");
const reviewRequestChangesButton = document.querySelector("#review-request-changes");
const reviewErrorNode = document.querySelector("#review-error");
const reviewResultNode = document.querySelector("#review-result");
const reviewResultLabelNode = document.querySelector("#review-result-label");
const reviewResultJsonNode = document.querySelector("#review-result-json");
const reviewCopyButton = document.querySelector("#review-copy");
const reviewDownloadButton = document.querySelector("#review-download");

const MODEL_LIST_LIMIT = 200;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(22, 20, 28);

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 4, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2);
keyLight.position.set(15, 20, 10);
scene.add(keyLight);

const grid = new THREE.GridHelper(32, 32, 0x8aa0b2, 0x263746);
grid.position.y = -8;
scene.add(grid);
scene.add(new THREE.AxesHelper(10));

let modelGroup = new THREE.Group();
scene.add(modelGroup);

const textureLoader = new THREE.TextureLoader();
const folderTextures = new Map();
const manualTextures = new Map();
let resourcePackIndex = createResourcePackIndex();
let folderContextSummary = "No folder loaded";
let currentModelText = null;
let currentFilename = null;
let currentModelPath = null;
let indexedModelPaths = [];
let selectedModelPath = null;
let ambiguousModelBaseNames = new Set();
let currentSummary = null;
let lastReviewPayload = null;

assetFolderInput.addEventListener("change", async (event) => {
  const files = [...(event.target.files ?? [])];
  const entries = [];
  folderTextures.clear();

  for (const file of files) {
    const path = file.webkitRelativePath || file.name;

    if (/\.json$/i.test(file.name) && normalizeTexturePath(path).includes("/models/")) {
      entries.push({ path, source: await file.text() });
      continue;
    }

    if (/\.png$/i.test(file.name) && normalizeTexturePath(path).includes("/textures/")) {
      const texture = await loadTextureFile(file);
      folderTextures.set(normalizeTexturePath(path), texture);
      entries.push({ path, texture });
    }
  }

  resourcePackIndex = createResourcePackIndex(entries);
  folderContextSummary = `${resourcePackIndex.models.size} models, ${resourcePackIndex.textures.size} textures`;
  indexedModelPaths = listIndexedModelPaths(resourcePackIndex);
  ambiguousModelBaseNames = findAmbiguousModelBaseNames(indexedModelPaths);
  modelSearchInput.value = "";
  renderModelList("");

  if (indexedModelPaths.length > 0) {
    modelBrowser.hidden = false;
  }

  if (currentModelText) {
    currentModelPath = findModelPathForFilename(currentFilename, resourcePackIndex) ?? currentModelPath;
    renderCurrentModel();
  } else {
    statusNode.className = "status status-ok";
    statusNode.textContent =
      indexedModelPaths.length > 0
        ? `Loaded folder context: ${folderContextSummary}. Search or click a model below to preview it.`
        : `Loaded folder context: ${folderContextSummary}. No model JSON files were found in this folder.`;
  }
});

modelSearchInput.addEventListener("input", (event) => {
  renderModelList(event.target.value);
});

modelListNode.addEventListener("click", (event) => {
  const item = event.target.closest("[data-model-path]");
  if (!item) {
    return;
  }

  selectIndexedModel(item.dataset.modelPath);
});

modelInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  currentModelText = await file.text();
  currentFilename = file.name;
  currentModelPath = file.webkitRelativePath || findModelPathForFilename(file.name, resourcePackIndex) || file.name;
  selectedModelPath = null;
  renderModelList(modelSearchInput.value);
  renderCurrentModel();
});

textureInput.addEventListener("change", async (event) => {
  manualTextures.clear();

  for (const file of event.target.files ?? []) {
    manualTextures.set(normalizeTexturePath(file.webkitRelativePath || file.name), await loadTextureFile(file));
  }

  if (currentModelText) {
    renderCurrentModel();
  }
});

async function selectIndexedModel(modelPath) {
  const source = resourcePackIndex.models.get(modelPath);
  if (typeof source !== "string") {
    return;
  }

  currentModelText = source;
  currentFilename = modelDisplayName(modelPath);
  currentModelPath = modelPath;
  selectedModelPath = modelPath;
  modelInput.value = "";
  renderModelList(modelSearchInput.value);
  renderCurrentModel();
}

function renderModelList(query) {
  const { matches, totalMatchCount, truncated } = filterModelPaths(indexedModelPaths, query, {
    limit: MODEL_LIST_LIMIT
  });

  if (indexedModelPaths.length === 0) {
    modelListNode.replaceChildren();
    modelListNoteNode.textContent = "Load an assets/resource-pack folder to browse indexed models here.";
    return;
  }

  if (matches.length === 0) {
    modelListNode.replaceChildren();
    modelListNoteNode.textContent = `No models match "${query}".`;
    return;
  }

  modelListNode.replaceChildren(
    ...matches.map((path) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-list-item";
      button.dataset.modelPath = path;
      button.setAttribute("role", "option");
      if (path === selectedModelPath) {
        button.classList.add("model-list-item-selected");
        button.setAttribute("aria-selected", "true");
      }

      const category = modelCategory(path);
      const baseName = modelBaseName(path);
      const isAmbiguous = ambiguousModelBaseNames.has(baseName);

      const title = document.createElement("span");
      title.className = "model-list-item-title";
      title.textContent = category ? `${category} / ${baseName}` : modelDisplayName(path);
      button.appendChild(title);

      const pathLine = document.createElement("span");
      pathLine.className = "model-list-item-path";
      pathLine.textContent = path;
      button.appendChild(pathLine);

      if (isAmbiguous) {
        const hint = document.createElement("span");
        hint.className = "model-list-item-hint";
        hint.textContent =
          category === "item"
            ? "Also exists under models/block: item models are for inventory/icon previews."
            : category === "block"
              ? "Also exists under models/item: block models may need special block-entity rendering."
              : "This name exists in multiple model categories.";
        button.appendChild(hint);
      }

      return button;
    })
  );

  modelListNoteNode.textContent = truncated
    ? `Showing ${matches.length} of ${totalMatchCount} matching models. Refine your search to narrow this down.`
    : `${totalMatchCount} model${totalMatchCount === 1 ? "" : "s"} found.`;
}

function renderCurrentModel() {
  const parsed = parseMinecraftModel(currentModelText, currentFilename, {
    modelPath: currentModelPath,
    resourcePackIndex
  });
  const resolvedTextureReferences = collectResolvedTextureReferences(parsed);
  const summary = createPreviewSummary(parsed, resolvedTextureReferences);
  currentSummary = summary;

  replaceModelGroup(buildModelGroup(parsed));
  renderSummary(summary);
  resetReviewPanel();

  const statusFeedback = createStatusFeedback(summary);
  statusNode.className = statusFeedback.className;
  statusNode.textContent = statusFeedback.message;
}

/**
 * Clears any prior human review decision/feedback. Called whenever a
 * different model is loaded so a stale approval can never be mistaken for
 * approval of the newly loaded model.
 */
function resetReviewPanel() {
  lastReviewPayload = null;
  reviewFeedbackInput.value = "";
  reviewErrorNode.hidden = true;
  reviewErrorNode.textContent = "";
  reviewResultNode.hidden = true;
  reviewResultJsonNode.textContent = "";
  reviewPanel.hidden = false;
  reviewStatusNode.textContent = `Reviewing "${currentFilename ?? "this model"}". No decision recorded yet.`;
}

function handleReviewDecision(action) {
  reviewErrorNode.hidden = true;
  reviewErrorNode.textContent = "";

  const feedback = reviewFeedbackInput.value;
  const { ok, errors } = validateReviewInput({ action, feedback });
  if (!ok) {
    reviewErrorNode.hidden = false;
    reviewErrorNode.textContent = errors.join(" ");
    return;
  }

  const payload = createReviewPayload({
    action,
    feedback,
    filename: currentFilename,
    modelPath: currentModelPath,
    summary: currentSummary
  });

  lastReviewPayload = payload;
  reviewStatusNode.textContent =
    action === "approved"
      ? `Recorded: asset approved at ${payload.timestamp}.`
      : `Recorded: changes requested at ${payload.timestamp}.`;

  reviewResultLabelNode.textContent =
    action === "approved" ? "Approval payload (for the agent)" : "Revision request payload (for the agent)";
  reviewResultJsonNode.textContent = serializeReviewPayload(payload);
  reviewResultNode.hidden = false;
}

reviewAcceptButton.addEventListener("click", () => handleReviewDecision("approved"));
reviewRequestChangesButton.addEventListener("click", () => handleReviewDecision("changes_requested"));

reviewCopyButton.addEventListener("click", async () => {
  if (!lastReviewPayload) {
    return;
  }
  try {
    await navigator.clipboard.writeText(serializeReviewPayload(lastReviewPayload));
    reviewCopyButton.textContent = "Copied!";
    setTimeout(() => {
      reviewCopyButton.textContent = "Copy JSON";
    }, 1500);
  } catch {
    reviewErrorNode.hidden = false;
    reviewErrorNode.textContent = "Could not copy to clipboard. Select the JSON text and copy it manually.";
  }
});

reviewDownloadButton.addEventListener("click", () => {
  if (!lastReviewPayload) {
    return;
  }
  const blob = new Blob([serializeReviewPayload(lastReviewPayload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName = (currentFilename ?? "model").replace(/\.json$/i, "");
  link.href = url;
  link.download = `${baseName}-review-${lastReviewPayload.action}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

function buildModelGroup(parsed) {
  const group = new THREE.Group();

  if (parsed.modelKind === "generated_item") {
    return buildGeneratedItemGroup(parsed);
  }

  if (parsed.modelKind === "particle_placeholder") {
    return buildParticlePlaceholderGroup(parsed);
  }

  parsed.elements.forEach((element, index) => {
    const size = [
      Math.max(element.to[0] - element.from[0], 0.01),
      Math.max(element.to[1] - element.from[1], 0.01),
      Math.max(element.to[2] - element.from[2], 0.01)
    ];
    const center = [
      (element.from[0] + element.to[0]) / 2 - 8,
      (element.from[1] + element.to[1]) / 2 - 8,
      (element.from[2] + element.to[2]) / 2 - 8
    ];

    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const materials = createFaceMaterials(element, parsed.textures, index);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(center[0], center[1], center[2]);
    mesh.name = element.name;
    group.add(mesh);

    const outline = new THREE.BoxHelper(mesh, 0x111827);
    group.add(outline);
  });

  return group;
}

function buildGeneratedItemGroup(parsed) {
  const group = new THREE.Group();
  const texture = resolveUploadedTexture(resolveTextureReference(parsed.textures.layer0, parsed.textures), textureIndex());
  if (!texture || !texture.image) {
    const material = createSpriteMaterial(texture, 0x9ca3af, texture ? 1 : 0.28);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), material);
    mesh.name = "Generated item sprite";
    group.add(mesh);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(16, 16)),
      new THREE.LineBasicMaterial({ color: 0x111827 })
    );
    group.add(outline);
    return group;
  }

  const imageData = readTextureImageData(texture.image);
  if (!imageData) {
    return group;
  }

  const alphaMask = alphaMaskFromImageData(imageData, 0.1);
  const extrusion = buildGeneratedItemExtrusion(alphaMask, imageData.width, imageData.height, 1);
  const pixelWidth = 16 / imageData.width;
  const pixelHeight = 16 / imageData.height;
  const halfDepth = extrusion.depth / 2;
  const frontBackMaterial = createSpriteMaterial(texture, 0x9ca3af, 1);
  const sideMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.1
  });

  for (const rect of extrusion.frontBackRects) {
    const width = rect.width * pixelWidth;
    const height = rect.height * pixelHeight;
    const centerX = (rect.x + rect.width / 2) * pixelWidth - 8;
    const centerY = 8 - (rect.y + rect.height / 2) * pixelHeight;

    const frontGeometry = new THREE.PlaneGeometry(width, height);
    setPlaneUv(frontGeometry, rectUv(rect, imageData.width, imageData.height));
    const front = new THREE.Mesh(frontGeometry, frontBackMaterial);
    front.position.set(centerX, centerY, halfDepth);
    group.add(front);

    const backGeometry = new THREE.PlaneGeometry(width, height);
    setPlaneUv(backGeometry, rectUv(rect, imageData.width, imageData.height));
    const back = new THREE.Mesh(backGeometry, frontBackMaterial);
    back.position.set(centerX, centerY, -halfDepth);
    back.rotation.y = Math.PI;
    group.add(back);
  }

  for (const edge of extrusion.sideRects.north) {
    addHorizontalSide(group, edge, pixelWidth, pixelHeight, halfDepth, imageData.width, imageData.height, -1, sideMaterial);
  }
  for (const edge of extrusion.sideRects.south) {
    addHorizontalSide(group, edge, pixelWidth, pixelHeight, halfDepth, imageData.width, imageData.height, 1, sideMaterial);
  }
  for (const edge of extrusion.sideRects.west) {
    addVerticalSide(group, edge, pixelWidth, pixelHeight, halfDepth, imageData.width, imageData.height, -1, sideMaterial);
  }
  for (const edge of extrusion.sideRects.east) {
    addVerticalSide(group, edge, pixelWidth, pixelHeight, halfDepth, imageData.width, imageData.height, 1, sideMaterial);
  }

  return group;
}

function addHorizontalSide(group, edge, pixelWidth, pixelHeight, halfDepth, imageWidth, imageHeight, direction, material) {
  const width = edge.length * pixelWidth;
  const centerX = (edge.x + edge.length / 2) * pixelWidth - 8;
  const y = 8 - edge.y * pixelHeight;
  const z = direction < 0 ? -halfDepth : halfDepth;
  const geometry = new THREE.PlaneGeometry(width, halfDepth * 2);
  const sampledY = direction < 0 ? edge.y : edge.y + 1;
  setPlaneUv(geometry, horizontalEdgeUv(edge, imageWidth, imageHeight, sampledY));
  const side = new THREE.Mesh(geometry, material);
  side.position.set(centerX, y, z);
  side.rotation.x = direction < 0 ? Math.PI / 2 : -Math.PI / 2;
  group.add(side);
}

function addVerticalSide(group, edge, pixelWidth, pixelHeight, halfDepth, imageWidth, imageHeight, direction, material) {
  const height = edge.length * pixelHeight;
  const x = edge.x * pixelWidth - 8;
  const centerY = 8 - (edge.y + edge.length / 2) * pixelHeight;
  const z = direction < 0 ? -halfDepth : halfDepth;
  const geometry = new THREE.PlaneGeometry(halfDepth * 2, height);
  const sampledX = direction < 0 ? edge.x : edge.x + 1;
  setPlaneUv(geometry, verticalEdgeUv(edge, imageWidth, imageHeight, sampledX));
  const side = new THREE.Mesh(geometry, material);
  side.position.set(x, centerY, z);
  side.rotation.y = direction < 0 ? Math.PI / 2 : -Math.PI / 2;
  group.add(side);
}

function setPlaneUv(geometry, [u0, v0, u1, v1]) {
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    u0, v1,
    u1, v1,
    u0, v0,
    u1, v0
  ], 2));
}

function readTextureImageData(image) {
  if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
    return null;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = image.width;
  offscreen.height = image.height;
  const context = offscreen.getContext("2d");
  if (!context) {
    return null;
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

function buildParticlePlaceholderGroup(parsed) {
  const group = new THREE.Group();
  const texture = resolveUploadedTexture(resolveTextureReference(parsed.textures.particle, parsed.textures), textureIndex());
  const geometry = new THREE.PlaneGeometry(12, 12);
  const mesh = new THREE.Mesh(geometry, createSpriteMaterial(texture, 0xf59e0b, texture ? 0.85 : 0.32));
  mesh.name = "Particle texture placeholder";
  group.add(mesh);

  const wireframe = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0xfbbf24 })
  );
  group.add(wireframe);

  return group;
}

function createSpriteMaterial(texture, fallbackColor, fallbackOpacity) {
  if (texture) {
    return new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.1
    });
  }

  return new THREE.MeshBasicMaterial({
    color: fallbackColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: fallbackOpacity,
    wireframe: false
  });
}

function createFaceMaterials(element, textures, index) {
  return ["east", "west", "up", "down", "south", "north"].map((direction) => {
    const texture = resolveFaceTexture(element.faces[direction], textures);

    if (texture) {
      return new THREE.MeshStandardMaterial({ map: texture });
    }

    return new THREE.MeshStandardMaterial({
      color: fallbackColor(index, direction),
      roughness: 0.8,
      metalness: 0
    });
  });
}

function resolveFaceTexture(face, textures) {
  if (!face?.texture) {
    return null;
  }

  const texturePath = resolveTextureReference(face.texture, textures);
  return resolveUploadedTexture(texturePath, textureIndex());
}

function collectResolvedTextureReferences(parsed) {
  const resolved = new Set();

  for (const texturePath of parsed.textureReferences) {
    if (resolveUploadedTexture(texturePath, textureIndex())) {
      resolved.add(texturePath);
    }
  }

  for (const element of parsed.elements) {
    for (const face of Object.values(element.faces)) {
      if (!face?.texture) {
        continue;
      }

      const texturePath = resolveTextureReference(face.texture, parsed.textures);
      if (resolveUploadedTexture(texturePath, textureIndex())) {
        resolved.add(texturePath);
      }
    }
  }

  return resolved;
}

async function loadTextureFile(file) {
  const objectUrl = URL.createObjectURL(file);
  const texture = await textureLoader.loadAsync(objectUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

function textureIndex() {
  return new Map([...folderTextures, ...manualTextures]);
}

function fallbackColor(index, direction) {
  const directionOffset = ["east", "west", "up", "down", "south", "north"].indexOf(direction) * 19;
  return new THREE.Color().setHSL(((index * 47 + directionOffset) % 360) / 360, 0.55, 0.58);
}

function replaceModelGroup(nextGroup) {
  scene.remove(modelGroup);
  disposeGroup(modelGroup);
  modelGroup = nextGroup;
  scene.add(modelGroup);
}

function disposeGroup(group) {
  group.traverse((object) => {
    if (object.geometry) {
      object.geometry.dispose();
    }

    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function renderSummary(summary) {
  const rows = [
    ["File", summary.filename],
    ["Selected model path", selectedModelPath ?? "None (manual upload)"],
    ["Preview mode", summary.modelKind],
    ["Elements", String(summary.elementCount)],
    ["Textures", String(summary.textureCount)],
    ["Folder context", folderContextSummary],
    ["Parent chain", summary.metadata.parentChain.join(" -> ") || "None"],
    ["Texture references", summary.textureReferences.join(", ") || "None"],
    ["Unresolved textures", summary.unresolvedTextureReferences.join(", ") || "None"],
    ["Errors", summary.errors.join(" | ") || "None"],
    ["Warnings", summary.warnings.join(" | ") || "None"]
  ];

  summaryNode.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      return [term, description];
    })
  );
}

function resize() {
  const { clientWidth, clientHeight } = canvas.parentElement;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function animate() {
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
