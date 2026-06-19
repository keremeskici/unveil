// Generates Unveil PWA icons from the current public logo asset.
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const SOURCE = "public/unveil-eye-logo.png";

async function makeIcon(size, output) {
  await sharp(SOURCE)
    .resize(size, size, { fit: "cover", position: "center" })
    .png()
    .toFile(output);
}

mkdirSync("public", { recursive: true });
await Promise.all([
  makeIcon(192, "public/icon-192.png"),
  makeIcon(512, "public/icon-512.png"),
  makeIcon(180, "public/apple-touch-icon.png"),
]);

console.log("icons written: 192, 512, apple-touch (180)");
