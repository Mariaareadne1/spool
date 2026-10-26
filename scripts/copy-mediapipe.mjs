// Self-host the MediaPipe vision WASM runtime so the instrument never depends on a CDN at play time.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dest = join(root, 'public/mediapipe');
const files = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

if (!existsSync(src)) {
  console.error('[copy-mediapipe] @mediapipe/tasks-vision is not installed; run npm install');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of files) cpSync(join(src, f), join(dest, f));
console.log(`[copy-mediapipe] copied ${files.length} files to public/mediapipe`);
