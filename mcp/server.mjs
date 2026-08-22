#!/usr/bin/env node
/**
 * Local MCP (Model Context Protocol) server exposing mcasset's Minecraft
 * asset validation/preview logic to MCP-capable agent clients (e.g. GitHub
 * Copilot Desktop) over stdio.
 *
 * This server does not scan arbitrary filesystem locations. Every tool
 * requires the caller to pass an explicit model path (and, optionally, an
 * explicit assets/resource-pack root and output directory). It never shells
 * out and never executes model file contents.
 *
 * Run directly with:
 *   npm run mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import process from "node:process";
import { z } from "zod";
import { generateAssetReport, validateAssetFile } from "../src/assetReport.js";

const modelPathSchema = z
  .string()
  .min(1, "modelPath is required.")
  .describe(
    "Absolute or relative filesystem path to a Minecraft Java Edition model JSON file " +
      "(a block or item model, e.g. assets/minecraft/models/item/example_sword.json). " +
      "The caller must provide this path explicitly; the server does not search for models on its own."
  );

const assetsRootSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Optional absolute or relative path to a Minecraft assets folder or resource-pack root " +
      "(a folder that contains, or is itself, an `assets/<namespace>/...` tree). When provided, " +
      "the server indexes its models/textures on disk to resolve `parent` model references and " +
      "texture files, the same way the browser previewer resolves a loaded assets folder. " +
      "Only this folder (and its subfolders) is read; no other filesystem locations are scanned."
  );

const outDirSchema = z
  .string()
  .min(1)
  .describe(
    "Absolute or relative path to a directory where report artifacts (summary.json and " +
      "preview.html) should be written. The directory is created if it does not exist."
  );

function toToolError(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ok: false,
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          },
          null,
          2
        )
      }
    ]
  };
}

function toToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function createMcAssetServer() {
  const server = new McpServer({
    name: "mcasset",
    version: "0.1.0"
  });

  server.registerTool(
    "validate_minecraft_asset",
    {
      title: "Validate a Minecraft asset model",
      description:
        "Validates a Minecraft Java Edition block/item model JSON file and returns a structured, " +
        "machine-readable diagnostic summary: status (pass/pass_with_warnings/fail), decision " +
        "(request_user_approval/revise_asset), errors, warnings, blockers, unresolved texture " +
        "references, and suggested next steps. Does not write any files. Optionally resolves " +
        "`parent` model references and textures against an explicit assets/resource-pack root.",
      inputSchema: {
        modelPath: modelPathSchema,
        assetsRoot: assetsRootSchema
      }
    },
    async ({ modelPath, assetsRoot }) => {
      try {
        const { summary } = await validateAssetFile({ modelPath, assetsRoot });
        return toToolResult(summary);
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    "preview_minecraft_asset",
    {
      title: "Preview a Minecraft asset model",
      description:
        "Validates a Minecraft Java Edition block/item model JSON file and writes report " +
        "artifacts (summary.json and preview.html) to an explicit output directory, mirroring " +
        "`npm run asset:preview`. Returns the same structured diagnostic summary as " +
        "validate_minecraft_asset plus the absolute paths of the written artifacts, so an agent " +
        "can present preview.html to the user for approval. Optionally resolves `parent` model " +
        "references and textures against an explicit assets/resource-pack root.",
      inputSchema: {
        modelPath: modelPathSchema,
        assetsRoot: assetsRootSchema,
        outDir: outDirSchema
      }
    },
    async ({ modelPath, assetsRoot, outDir }) => {
      try {
        const { summary, artifacts } = await generateAssetReport({ modelPath, assetsRoot, outDir });
        return toToolResult({
          ...summary,
          artifacts: {
            summaryPath: artifacts.summaryPath ? path.resolve(artifacts.summaryPath) : null,
            previewPath: artifacts.previewPath ? path.resolve(artifacts.previewPath) : null
          }
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  return server;
}

async function main() {
  const server = createMcAssetServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start when this file is run directly (`npm run mcp`), not when
// imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("mcasset MCP server failed to start:", error);
    process.exit(1);
  });
}
