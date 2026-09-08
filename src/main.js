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
import { buildEquipmentScene, validateSkinDimensions } from "./equipmentScene.js";
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
const equipmentModeInput = document.querySelector("#equipment-mode");
const offhandModelInput = document.querySelector("#offhand-model-file");
const skinInput = document.querySelector("#skin-file");
const equipmentStatusNode = document.querySelector("#equipment-status");
const viewButtons = [...document.querySelectorAll("[data-view]")];

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
let currentParsed = null;
let offhandModelText = null;
let offhandFilename = null;
let offhandModelPath = null;
let offhandParsed = null;
let offhandSummary = null;
let skinTexture = null;
let skinDimensions = null;
let skinFilename = null;

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

equipmentModeInput.addEventListener("change", () => {
  renderActiveScene();
  resetReviewPanel();
});

offhandModelInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    offhandModelText = null;
    offhandFilename = null;
    offhandModelPath = null;
    offhandParsed = null;
    offhandSummary = null;
  } else {
    offhandModelText = await file.text();
    offhandFilename = file.name;
    offhandModelPath = file.webkitRelativePath || findModelPathForFilename(file.name, resourcePackIndex) || file.name;
    parseOffhandModel();
  }
  renderActiveScene();
  resetReviewPanel();
});

skinInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  skinTexture = null;
  skinDimensions = null;
  skinFilename = null;
  if (file) {
    try {
      const texture = await loadTextureFile(file);
      const validation = validateSkinDimensions(texture.image?.width, texture.image?.height);
      if (!validation.ok) {
        renderActiveScene();
        equipmentStatusNode.textContent = validation.error;
        resetReviewPanel();
        return;
      }
      skinTexture = texture;
      skinDimensions = { width: validation.width, height: validation.height };
      skinFilename = file.name;
    } catch (error) {
      renderActiveScene();
      equipmentStatusNode.textContent =
        `Could not decode "${file.name}" as a player skin PNG: ${error instanceof Error ? error.message : String(error)}`;
      resetReviewPanel();
      return;
    }
  }
  renderActiveScene();
  resetReviewPanel();
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    viewer.frameGroup(undefined, { view: button.dataset.view });
  });
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
  if (offhandModelText) {
    parseOffhandModel();
    renderActiveScene();
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
  currentParsed = parsed;

  renderActiveScene();
  renderSummary(summary);
  resetReviewPanel();

  const statusFeedback = createStatusFeedback(summary);
  statusNode.className = statusFeedback.className;
  statusNode.textContent = statusFeedback.message;
}

function parseOffhandModel() {
  offhandParsed = parseMinecraftModel(offhandModelText, offhandFilename, {
    modelPath: offhandModelPath,
    resourcePackIndex
  });
  offhandSummary = createPreviewSummary(offhandParsed, collectResolvedTextureReferences(offhandParsed));
}

function renderActiveScene() {
  if (!currentParsed) {
    return;
  }
  if (!equipmentModeInput.checked) {
    viewer.setModelGroup(buildModelGroup(currentParsed, { textureIndex: textureIndex() }));
    equipmentStatusNode.textContent = "Equipment view is off. Asset-only preview remains the default.";
    return;
  }

  const group = buildEquipmentScene({
    mainHand: { parsed: currentParsed, textureIndex: textureIndex() },
    offhand: offhandParsed ? { parsed: offhandParsed, textureIndex: textureIndex() } : null,
    skinTexture,
    skinDimensions
  });
  viewer.setModelGroup(group);
  viewer.frameGroup(group, { view: "three-quarter" });

  const transformIssues = group.userData.equipmentDiagnostics.flatMap((entry) =>
    entry.issues.map((issue) => `${entry.slot}: ${issue.message}`)
  );
  const offhandProblems = offhandSummary
    ? [
        `Offhand validation: ${offhandSummary.status}.`,
        ...offhandSummary.errors,
        ...offhandSummary.warnings,
        ...offhandSummary.unresolvedTextureReferences.map((item) => `Unresolved texture: ${item}`)
      ]
    : [];
  const notes = [
    skinFilename ? `Skin: ${skinFilename}.` : "Neutral mannequin shown; no skin selected.",
    offhandParsed ? `Offhand: ${offhandFilename}.` : "Offhand is empty.",
    ...transformIssues,
    ...offhandProblems
  ];
  equipmentStatusNode.textContent = notes.join(" ");
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
  reviewStatusNode.textContent = equipmentModeInput.checked
    ? `Reviewing equipment scene: main hand "${currentFilename ?? "unknown"}", offhand "${offhandFilename ?? "empty"}", skin "${skinFilename ?? "neutral mannequin"}". No decision recorded yet.`
    : `Reviewing asset "${currentFilename ?? "this model"}". No decision recorded yet.`;
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
    summary: currentSummary,
    context: equipmentModeInput.checked
      ? {
          mode: "equipment",
          primaryAsset: "main_hand",
          mainHand: { filename: currentFilename, modelPath: currentModelPath },
          offhand: {
            filename: offhandFilename,
            modelPath: offhandModelPath,
            validation: offhandSummary
              ? {
                  status: offhandSummary.status,
                  decision: offhandSummary.decision,
                  errors: offhandSummary.errors,
                  warnings: offhandSummary.warnings,
                  unresolvedTextureReferences: offhandSummary.unresolvedTextureReferences
                }
              : null
          },
          skin: { filename: skinFilename }
        }
      : { mode: "asset", primaryAsset: "model" }
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
