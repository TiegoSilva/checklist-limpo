import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const input = await readFile(new URL('../public/icon.svg', import.meta.url));
for (const size of [192, 512])
  await sharp(input)
    .resize(size, size)
    .png()
    .toFile(
      fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)),
    );
console.log('Ícones PWA gerados.');
