import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../public/models/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
await mkdir(root, { recursive: true });
for (const [name, info] of Object.entries(manifest.files)) {
  const target = new URL(name, root);
  let data = await readFile(target).catch(() => null);
  if (!data || createHash('sha256').update(data).digest('hex') !== info.sha256) {
    console.log(`Downloading ${name}`);
    const response = await fetch(manifest.assetBase + name);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}. Run scripts/convert-models.py to build from source.`);
    data = Buffer.from(await response.arrayBuffer());
    if (data.length !== info.bytes || createHash('sha256').update(data).digest('hex') !== info.sha256) throw new Error(`${name}: checksum mismatch`);
    await writeFile(target, data);
  }
  console.log(`${name}: verified (${data.length} bytes)`);
}
