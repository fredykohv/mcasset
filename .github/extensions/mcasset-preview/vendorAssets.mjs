// Static asset serving for the mcasset-preview canvas's 3D viewer.
//
// The canvas iframe has no bundler, so its 3D viewer runs as plain ES
// modules loaded directly by the browser via an <script type="importmap">
// (see render.mjs). This module defines the fixed, explicit set of files
// extension.mjs serves under /vendor/* and /app.js:
//   - three.js's own ESM browser build and its OrbitControls addon, read
//     directly from node_modules (no CDN, no re-bundling).
//   - This repo's own pure/browser rendering modules (src/modelCore.js,
//     src/generatedItemExtrusion.js, src/modelRenderer.js), served
//     unmodified so the iframe renders with the exact same code the browser
//     previewer (src/main.js) uses -- not a duplicate implementation.
//   - viewerClient.js, this extension's own small bootstrap script that
//     wires the above into a THREE scene from the canvas's /api/state.
//
// Every path below is a fixed path resolved relative to this extension's
// own directory or the repo root; none of it accepts a caller-supplied path
// or scans a directory.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(EXTENSION_DIR, "../../..");

const JS_CONTENT_TYPE = "text/javascript; charset=utf-8";

const VENDOR_ASSETS = {
  "/vendor/three.module.js": {
    file: path.join(REPO_ROOT, "node_modules/three/build/three.module.js"),
    contentType: JS_CONTENT_TYPE
  },
  "/vendor/OrbitControls.js": {
    file: path.join(REPO_ROOT, "node_modules/three/examples/jsm/controls/OrbitControls.js"),
    contentType: JS_CONTENT_TYPE
  },
  "/vendor/modelCore.js": {
    file: path.join(REPO_ROOT, "src/modelCore.js"),
    contentType: JS_CONTENT_TYPE
  },
  "/vendor/generatedItemExtrusion.js": {
    file: path.join(REPO_ROOT, "src/generatedItemExtrusion.js"),
    contentType: JS_CONTENT_TYPE
  },
  "/vendor/modelRenderer.js": {
    file: path.join(REPO_ROOT, "src/modelRenderer.js"),
    contentType: JS_CONTENT_TYPE
  },
  "/vendor/equipmentScene.js": {
    file: path.join(REPO_ROOT, "src/equipmentScene.js"),
    contentType: JS_CONTENT_TYPE
  },
  "/vendor/playerSkin.js": {
    file: path.join(REPO_ROOT, "src/playerSkin.js"),
    contentType: JS_CONTENT_TYPE
  },
  "/app.js": {
    file: path.join(EXTENSION_DIR, "viewerClient.js"),
    contentType: JS_CONTENT_TYPE
  }
};

/** Whether `pathname` is one of the fixed static assets this extension serves. */
export function isVendorRoute(pathname) {
  return Object.prototype.hasOwnProperty.call(VENDOR_ASSETS, pathname);
}

/**
 * Reads and returns one of the fixed static assets above, or `null` if
 * `pathname` isn't one of them. Never reads any path other than the ones
 * declared in `VENDOR_ASSETS`.
 */
export async function serveVendorAsset(pathname) {
  const asset = VENDOR_ASSETS[pathname];
  if (!asset) {
    return null;
  }
  const body = await readFile(asset.file, "utf8");
  return { body, contentType: asset.contentType };
}
