// Valve Material (VMT) parser. VMTs are a small brace-nested key/value dialect;
// we only need the shader name and the top-level parameters.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

export function parseVmt(text) {
  // strip // comments outside of quoted strings
  const clean = text.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ''));
  const tok = clean.match(/"[^"]*"|\{|\}|[^\s{}"]+/g) ?? [];
  let i = 0;
  const unq = (s) => (s[0] === '"' ? s.slice(1, -1) : s);
  function block() {
    const obj = {};
    while (i < tok.length) {
      if (tok[i] === '}') { i++; break; }
      const key = unq(tok[i++]).toLowerCase();
      if (tok[i] === '{') { i++; obj[key] = block(); }
      else obj[key] = unq(tok[i++] ?? '');
    }
    return obj;
  }
  const shader = unq(tok[i++] ?? '');
  if (tok[i] === '{') i++;
  return { shader, params: block() };
}

/**
 * Case-insensitive lookup. VMT paths and on-disk names disagree constantly, and
 * Valve's own material files mix separators freely — `models\\player\\x/y` is
 * normal — so normalise backslashes before splitting.
 */
export function resolveInsensitive(root, relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let cur = root;
  for (let p = 0; p < parts.length; p++) {
    const want = parts[p].toLowerCase();
    let entries;
    try { entries = readdirSync(cur); } catch { return null; }
    const last = p === parts.length - 1;
    let hit = entries.find((e) => (last ? e.toLowerCase().replace(/\.[^.]*$/, '') === want || e.toLowerCase() === want : e.toLowerCase() === want));
    if (!hit) return null;
    cur = join(cur, hit);
  }
  return cur;
}

export function findMaterial(materialsRoot, rawName) {
  const name = rawName.replace(/\\/g, '/');
  const vmtPath = resolveInsensitive(materialsRoot, `${name}.vmt`)
    ?? resolveInsensitive(materialsRoot, name.endsWith('.vmt') ? name : `${name}.vmt`);
  if (!vmtPath) return null;
  const mat = parseVmt(readFileSync(vmtPath, 'latin1'));
  let base = mat.params.$basetexture ?? null;
  // patch materials (Patch { include ... }) point at another VMT
  if (!base && mat.shader.toLowerCase() === 'patch' && mat.params.include) {
    const inc = resolveInsensitive(materialsRoot, mat.params.include.replace(/^materials\//i, ''));
    if (inc) {
      const parent = parseVmt(readFileSync(inc, 'latin1'));
      base = parent.params.$basetexture ?? null;
      mat.shader = parent.shader;
      mat.params = { ...parent.params, ...mat.params };
    }
  }
  const vtfPath = base ? resolveInsensitive(materialsRoot, `${base}.vtf`) : null;
  return { name, vmtPath, shader: mat.shader, params: mat.params, basetexture: base, vtfPath };
}
