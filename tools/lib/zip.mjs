// Minimal ZIP reader (stored + deflate). Used for CC0 texture downloads and for
// the BSP's embedded pakfile lump, both of which are ordinary ZIP archives.
import { inflateRawSync } from 'node:zlib';

export function readZip(buf, base = 0, len = buf.length - base) {
  // scan back for the end-of-central-directory record
  let eocd = -1;
  for (let i = base + len - 22; i >= base; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: no end-of-central-directory found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16) + base;

  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOfs = buf.readUInt32LE(p + 42) + base;
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen);
    entries.push({ name, method, csize, usize, localOfs });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    entries,
    read(entry) {
      // the local header repeats the name/extra lengths, and they can differ
      const nameLen = buf.readUInt16LE(entry.localOfs + 26);
      const extraLen = buf.readUInt16LE(entry.localOfs + 28);
      const start = entry.localOfs + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + entry.csize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return inflateRawSync(raw);
      throw new Error(`zip: unsupported compression method ${entry.method}`);
    },
  };
}
