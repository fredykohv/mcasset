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
import { buildModelGroup, createViewer, loadTextureFromUrl } from "./modelRenderer.js";
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

const viewer = createViewer(canvas);

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

  viewer.setModelGroup(buildModelGroup(parsed, { textureIndex: textureIndex() }));
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
  return loadTextureFromUrl(objectUrl);
}

function textureIndex() {
  return new Map([...folderTextures, ...manualTextures]);
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

