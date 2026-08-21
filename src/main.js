import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./style.css";
import {
  createResourcePackIndex,
  createPreviewSummary,
  createStatusFeedback,
  findModelPathForFilename,
  normalizeTexturePath,
  parseMinecraftModel,
  resolveTextureReference,
  resolveUploadedTexture
} from "./modelCore.js";

const assetFolderInput = document.querySelector("#asset-folder");
const modelInput = document.querySelector("#model-file");
const textureInput = document.querySelector("#texture-files");
const statusNode = document.querySelector("#status");
const summaryNode = document.querySelector("#summary");
const canvas = document.querySelector("#viewer");

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

  if (currentModelText) {
    currentModelPath = findModelPathForFilename(currentFilename, resourcePackIndex) ?? currentModelPath;
    renderCurrentModel();
  } else {
    statusNode.className = "status status-ok";
    statusNode.textContent = `Loaded folder context: ${folderContextSummary}. Select a model JSON to preview.`;
  }
});

modelInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  currentModelText = await file.text();
  currentFilename = file.name;
  currentModelPath = file.webkitRelativePath || findModelPathForFilename(file.name, resourcePackIndex) || file.name;
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

function renderCurrentModel() {
  const parsed = parseMinecraftModel(currentModelText, currentFilename, {
    modelPath: currentModelPath,
    resourcePackIndex
  });
  const resolvedTextureReferences = collectResolvedTextureReferences(parsed);
  const summary = createPreviewSummary(parsed, resolvedTextureReferences);

  replaceModelGroup(buildModelGroup(parsed));
  renderSummary(summary);

  const statusFeedback = createStatusFeedback(summary);
  statusNode.className = statusFeedback.className;
  statusNode.textContent = statusFeedback.message;
}

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
