export const SUPPORTED_SKIN_DIMENSIONS = Object.freeze(["64x64", "64x32"]);

export function validateSkinDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return { ok: false, error: "Skin dimensions could not be read." };
  }
  if (!SUPPORTED_SKIN_DIMENSIONS.includes(`${width}x${height}`)) {
    return {
      ok: false,
      error: `Unsupported player skin dimensions ${width}x${height}; use a classic/wide 64x64 PNG or legacy 64x32 PNG.`
    };
  }
  return { ok: true, width, height, legacy: height === 32 };
}
