// The 3D skybox in a recovered map's scene.json: geometry relative to the map's sky_camera,
// already multiplied by its scale, with its triangles pre-sorted back-to-front from that
// anchor. A renderer only has to keep the group on the camera and draw it first with no
// depth (BspWorld.tsx, and the editor's reference layer) -- these are the properties that
// makes that safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mapsDir = fileURLToPath(new URL('../public/maps/', import.meta.url));
const maps = readdirSync(mapsDir).filter((m) => existsSync(`${mapsDir}${m}/scene.json`));
const scene = (m: string) => JSON.parse(readFileSync(`${mapsDir}${m}/scene.json`, 'utf8'));

test('every recovered map either has a skybox or says so', () => {
  assert.ok(maps.length >= 4, `recovered maps: ${maps.join(', ')}`);
  for (const m of maps) {
    const s = scene(m);
    const hasCamera = s.entities.some((e: { classname: string }) => e.classname === 'sky_camera');
    assert.equal(!!s.sky, hasCamera, `${m}: a sky payload iff the map has a sky_camera`);
  }
});

for (const m of maps) {
  const s = scene(m);
  if (!s.sky) continue;
  test(`${m}: the skybox is a well-formed backdrop`, () => {
    assert.ok(s.sky.scale >= 1, `scale ${s.sky.scale}`);
    assert.ok(s.sky.radius > 100, `radius ${s.sky.radius} m -- it is scaled up, so it is far away`);
    assert.ok(s.sky.groups.length > 0);
    for (const g of s.sky.groups) {
      assert.ok(s.materials[g.material], 'every group names a material that exists');
      assert.equal(g.pos.length / 3, g.normal.length / 3);
      assert.equal(g.pos.length / 3, g.uv.length / 2);
      assert.equal(g.pos.length / 3, g.uv2.length / 2);
      const verts = g.pos.length / 3;
      for (const i of g.idx) assert.ok(i >= 0 && i < verts, 'indices are in range');
      // back-to-front from the anchor: what makes depth-less drawing correct from any angle
      let prev = Infinity;
      for (let t = 0; t < g.idx.length; t += 3) {
        let far = 0;
        for (const v of [g.idx[t], g.idx[t + 1], g.idx[t + 2]])
          far = Math.max(far, Math.hypot(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]));
        assert.ok(far <= prev + 1e-6, `triangle ${t / 3} of ${s.materials[g.material].name} is nearer than the one before it`);
        prev = far;
      }
    }
  });

  test(`${m}: the skybox rings the viewer, and the playfield is nowhere near it`, () => {
    const bins = new Array(12).fill(0);
    let maxR = 0;
    for (const g of s.sky.groups) for (let i = 0; i < g.pos.length; i += 3) {
      const [x, y, z] = [g.pos[i], g.pos[i + 1], g.pos[i + 2]];
      bins[Math.min(11, ((Math.atan2(z, x) + Math.PI) / (2 * Math.PI) * 12) | 0)]++;
      maxR = Math.max(maxR, Math.hypot(x, y, z));
    }
    assert.ok(bins.every((n) => n > 0), `all twelve azimuths carry backdrop: ${bins.join(',')}`);
    assert.ok(Math.abs(maxR - s.sky.radius) < 1, `the declared radius is the real one (${maxR.toFixed(1)} vs ${s.sky.radius})`);
    // the playfield stays in the playfield: nothing of the world was swept into the backdrop
    let worldR = 0;
    for (const g of s.groups) for (let i = 0; i < g.pos.length; i += 3)
      worldR = Math.max(worldR, Math.hypot(g.pos[i], g.pos[i + 1], g.pos[i + 2]));
    assert.ok(worldR < s.sky.radius / 4, `world radius ${worldR.toFixed(0)} m against a backdrop at ${s.sky.radius} m`);
  });
}
