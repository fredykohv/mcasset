#!/usr/bin/env node
import process from "node:process";
import { generateAssetReport } from "../src/assetReport.js";

const args = process.argv.slice(2);
const inputPath = args[0];
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? args[outIndex + 1] : "preview-output";
const assetsIndex = args.indexOf("--assets");
const assetsRoot = assetsIndex >= 0 ? args[assetsIndex + 1] : undefined;

if (!inputPath) {
  console.error("Usage: npm run asset:preview -- <model.json> [--assets <assets-root>] --out <output-dir>");
  process.exit(2);
}

try {
  const { summary } = await generateAssetReport({ modelPath: inputPath, assetsRoot, outDir });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
