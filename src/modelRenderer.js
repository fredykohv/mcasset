// Shared Three.js scene-building logic for Minecraft model previews.
//
// This is the single source of truth for turning an already-parsed model
// (`parseMinecraftModel` from ./modelCore.js) into renderable Three.js
// geometry. Both the browser previewer (src/main.js) and the
// mcasset-preview canvas extension's iframe
// (.github/extensions/mcasset-preview/viewerClient.js) import this module,
// so the two surfaces render identical geometry instead of maintaining two
// renderers. Parsing/validation stays solely in modelCore.js/assetReport.js;
// this module only consumes already-parsed model data and never re-derives
// diagnostics from it.
//
// Runs unmodified in two different environments:
//   - Bundled by Vite for the website (import specifiers resolve through
//     node_modules as usual).
//   - Loaded directly as a static ES module by the canvas iframe's loopback
//     server, which serves this file plus "three" and OrbitControls.js
//     verbatim and maps the bare "three" import specifiers via an
//     <script type="importmap"> (see .github/extensions/mcasset-preview).
// Because both environments resolve the same import specifiers, this file
// never needs environment-specific branches.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { resolveTextureReference, resolveUploadedTexture } from "./modelCore.js";
import {
  alphaMaskFromImageData,
  buildGeneratedItemExtrusion,
  horizontalEdgeUv,
  rectUv,
  verticalEdgeUv
} from "./generatedItemExtrusion.js";

const FACE_DIRECTIONS = ["east", "west", "up", "down", "south", "north"];

const textureLoader = new THREE.TextureLoader();

/**
 * Loads an image URL (a `blob:` object URL for locally uploaded files, or an
 * `http:`/`https:` URL for server-fetched textures) as a THREE texture
 * configured for crisp, non-mipmapped Minecraft pixel-art sprites.
 */
export async function loadTextureFromUrl(url) {
  const texture = await textureLoader.loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

/**
 * Sets up a self-contained Three.js viewer bound to `canvas`: scene, camera,
 * lighting, grid, orbit controls, and a resize+render loop. Returns
 * `setModelGroup(group)` to swap in newly built model geometry (disposing
 * the previous group's geometries/materials first) so both the browser
 * previewer and the canvas iframe share identical viewer setup/teardown
 * behavior.
 */
export function createViewer(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(22, 20, 28);

  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, preserveDrawingBuffer: true });
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

  function setModelGroup(nextGroup) {
    scene.remove(modelGroup);
    disposeGroup(modelGroup);
    modelGroup = nextGroup;
    scene.add(modelGroup);
  }

  function frameGroup(group = modelGroup, { view = "front", padding = 1.35 } = {}) {
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    if (bounds.isEmpty()) {
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * padding;
    controls.target.copy(center);
    const direction = view === "back"
      ? new THREE.Vector3(0, 0, -1)
      : view === "side"
        ? new THREE.Vector3(1, 0, 0)
        : view === "three-quarter"
          ? new THREE.Vector3(1, 0, 1).normalize()
          : new THREE.Vector3(0, 0, 1);
    camera.position.copy(center).add(direction.multiplyScalar(Math.max(radius, 12)));
    camera.position.y += size.y * 0.08;
    camera.lookAt(center);
    controls.update();
  }

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }
    const { clientWidth, clientHeight } = parent;
    if (clientWidth === 0 || clientHeight === 0) {
      return;
    }
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }

  let animating = true;
  function animate() {
    if (!animating) {
      return;
    }
    resize();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  function stop() {
    animating = false;
  }

  return { scene, camera, renderer, controls, setModelGroup, frameGroup, resize, stop };
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

/**
 * Builds a THREE.Group for an already-parsed Minecraft model
 * (`parseMinecraftModel` output). Dispatches on `parsed.modelKind`, mirroring
 * the browser previewer's preview modes: cuboid `elements`, elementless
 * generated-item sprites, and elementless particle-only placeholders.
 * `textureIndex` is a `Map<normalizedTexturePath, THREE.Texture>` (see
 * `resolveUploadedTexture` in ./modelCore.js); entries with no matching
 * texture fall back to a flat color/translucent placeholder.
 */
export function buildModelGroup(parsed, { textureIndex = new Map() } = {}) {
  if (parsed.modelKind === "generated_item") {
    return buildGeneratedItemGroup(parsed, textureIndex);
  }

  if (parsed.modelKind === "particle_placeholder") {
    return buildParticlePlaceholderGroup(parsed, textureIndex);
  }

  const group = new THREE.Group();

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
    const materials = createFaceMaterials(element, parsed.textures, index, textureIndex);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(center[0], center[1], center[2]);
    mesh.name = element.name;
    group.add(mesh);

    const outline = new THREE.BoxHelper(mesh, 0x111827);
    group.add(outline);
  });

  return group;
}

function buildGeneratedItemGroup(parsed, textureIndex) {
  const group = new THREE.Group();
  const texture = resolveUploadedTexture(resolveTextureReference(parsed.textures.layer0, parsed.textures), textureIndex);
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
    const [u0, v0, u1, v1] = rectUv(rect, imageData.width, imageData.height);
    setPlaneUv(backGeometry, [u1, v0, u0, v1]);
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
  const y = 8 - (edge.y + (direction > 0 ? 1 : 0)) * pixelHeight;
  const geometry = new THREE.PlaneGeometry(width, halfDepth * 2);
  setPlaneUv(geometry, horizontalEdgeUv(edge, imageWidth, imageHeight, edge.y));
  const side = new THREE.Mesh(geometry, material);
  side.position.set(centerX, y, 0);
  side.rotation.x = direction < 0 ? Math.PI / 2 : -Math.PI / 2;
  group.add(side);
}

function addVerticalSide(group, edge, pixelWidth, pixelHeight, halfDepth, imageWidth, imageHeight, direction, material) {
  const height = edge.length * pixelHeight;
  const x = (edge.x + (direction > 0 ? 1 : 0)) * pixelWidth - 8;
  const centerY = 8 - (edge.y + edge.length / 2) * pixelHeight;
  const geometry = new THREE.PlaneGeometry(halfDepth * 2, height);
  setPlaneUv(geometry, verticalEdgeUv(edge, imageWidth, imageHeight, edge.x));
  const side = new THREE.Mesh(geometry, material);
  side.position.set(x, centerY, 0);
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

function buildParticlePlaceholderGroup(parsed, textureIndex) {
  const group = new THREE.Group();
  const texture = resolveUploadedTexture(resolveTextureReference(parsed.textures.particle, parsed.textures), textureIndex);
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

function createFaceMaterials(element, textures, index, textureIndex) {
  return FACE_DIRECTIONS.map((direction) => {
    const texture = resolveFaceTexture(element.faces[direction], textures, textureIndex);

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

function resolveFaceTexture(face, textures, textureIndex) {
  if (!face?.texture) {
    return null;
  }

  const texturePath = resolveTextureReference(face.texture, textures);
  return resolveUploadedTexture(texturePath, textureIndex);
}

function fallbackColor(index, direction) {
  const directionOffset = FACE_DIRECTIONS.indexOf(direction) * 19;
  return new THREE.Color().setHSL(((index * 47 + directionOffset) % 360) / 360, 0.55, 0.58);
}
