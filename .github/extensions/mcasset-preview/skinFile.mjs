import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function readPngDimensions(filePath) {
  const bytes = await readFile(filePath);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`skinPath must point to a PNG file: ${filePath}`);
  }

  let offset = 8;
  let dimensions = null;
  let ended = false;
  let sawPalette = false;
  let imageDataEnded = false;
  const imageChunks = [];
  let chunkIndex = 0;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`skinPath contains a truncated PNG chunk: ${filePath}`);
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (pngCrc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) {
      throw new Error(`skinPath contains a PNG chunk with an invalid checksum: ${filePath}`);
    }

    if (type === "IHDR") {
      if (length !== 13 || dimensions || chunkIndex !== 0) {
        throw new Error(`skinPath has an invalid PNG header: ${filePath}`);
      }
      dimensions = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === "IDAT") {
      if (imageDataEnded) {
        throw new Error(`skinPath has non-contiguous PNG image data: ${filePath}`);
      }
      imageChunks.push(data);
    } else if (type === "PLTE") {
      sawPalette = true;
    } else if (type === "IEND") {
      if (length !== 0) {
        throw new Error(`skinPath has an invalid PNG end chunk: ${filePath}`);
      }
      ended = true;
      break;
    } else if (imageChunks.length > 0) {
      imageDataEnded = true;
    }
    offset = dataEnd + 4;
    chunkIndex += 1;
  }

  if (!dimensions || imageChunks.length === 0 || !ended || dimensions.interlace !== 0) {
    throw new Error(`skinPath is not a supported non-interlaced PNG: ${filePath}`);
  }
  const formats = {
    0: { channels: 1, depths: [1, 2, 4, 8, 16] },
    2: { channels: 3, depths: [8, 16] },
    3: { channels: 1, depths: [1, 2, 4, 8] },
    4: { channels: 2, depths: [8, 16] },
    6: { channels: 4, depths: [8, 16] }
  };
  const format = formats[dimensions.colorType];
  if (!format || !format.depths.includes(dimensions.bitDepth) || (dimensions.colorType === 3 && !sawPalette)) {
    throw new Error(`skinPath uses an unsupported PNG color format: ${filePath}`);
  }

  const decoded = inflateSync(Buffer.concat(imageChunks));
  const rowLength = 1 + Math.ceil(dimensions.width * format.channels * dimensions.bitDepth / 8);
  if (
    decoded.length !== dimensions.height * rowLength ||
    Array.from({ length: dimensions.height }, (_, row) => decoded[row * rowLength]).some((filter) => filter > 4)
  ) {
    throw new Error(`skinPath PNG pixel data is invalid or incomplete: ${filePath}`);
  }
  return { width: dimensions.width, height: dimensions.height };
}
