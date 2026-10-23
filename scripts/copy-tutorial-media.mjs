import { copyFile, mkdir } from 'node:fs/promises';
const destination = new URL('../dist/tutorials/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of ['nexus-quickstart-zh', 'nexus-infrastructure-zh']) {
  for (const extension of ['mp4', 'srt']) {
    await copyFile(new URL(`../docs/videos/${name}.${extension}`, import.meta.url), new URL(`${name}.${extension}`, destination));
  }
}
for (const name of ['01-ceo-office.png', '06-campus.png']) {
  await copyFile(new URL(`../docs/images/${name}`, import.meta.url), new URL(name, destination));
}
console.log('Published two playable tutorial videos and subtitles.');
