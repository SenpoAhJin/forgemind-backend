/**
 * generate_wig_glb.mjs
 *
 * Makes simple white "cap" wig GLB files (one per body) WITHOUT Blender.
 * No packages needed. Run from the project root:
 *
 *     node scripts/generate_wig_glb.mjs
 *
 * Output: assets/models/garments/Wig_White_Cap_Male.glb and ..._Female.glb
 *
 * The numbers below are ESTIMATES of where the head is, built from the body
 * bounding boxes in docs/GARMENT_SPEC.md. If the wig floats, sinks or looks
 * too big when you view it, change the numbers in HEAD below and run again.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'garments');

// Top of the head (Y max) and middle of the body (X/Z) - from bodyBounds.ts
const BODIES = {
  male:   { headTopY: 0.931, centerX: -0.002, centerZ: -0.012 },
  female: { headTopY: 0.944, centerX: -0.003, centerZ: 0.002 },
};

// ESTIMATED head size (half-sizes, in body units). TWEAK THESE.
const HEAD = { halfHeight: 0.125, halfWidth: 0.095, halfDepth: 0.105 };
const WIG_THICKNESS = 0.015;   // how far the wig sits outside the head
const COVER_ANGLE_DEG = 115;   // 90 = down to the ears' height, bigger = lower
const RINGS = 16;
const SEGMENTS = 32;
const COLOR = [0.92, 0.92, 0.95, 1]; // soft white

function buildCap({ headTopY, centerX, centerZ }) {
  const rx = HEAD.halfWidth + WIG_THICKNESS;
  const ry = HEAD.halfHeight + WIG_THICKNESS;
  const rz = HEAD.halfDepth + WIG_THICKNESS;
  const cx = centerX;
  const cy = headTopY - HEAD.halfHeight; // middle of the head
  const cz = centerZ;
  const maxTheta = (COVER_ANGLE_DEG * Math.PI) / 180;

  const positions = [];
  const normals = [];
  for (let i = 0; i <= RINGS; i++) {
    const theta = (i / RINGS) * maxTheta;
    for (let j = 0; j <= SEGMENTS; j++) {
      const phi = (j / SEGMENTS) * Math.PI * 2;
      const lx = rx * Math.sin(theta) * Math.cos(phi);
      const ly = ry * Math.cos(theta);
      const lz = rz * Math.sin(theta) * Math.sin(phi);
      positions.push(cx + lx, cy + ly, cz + lz);
      const n = [lx / (rx * rx), ly / (ry * ry), lz / (rz * rz)];
      const len = Math.hypot(...n) || 1;
      normals.push(n[0] / len, n[1] / len, n[2] / len);
    }
  }
  const indices = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * (SEGMENTS + 1) + j;
      const b = a + SEGMENTS + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise from outside
    }
  }
  return { positions, normals, indices };
}

function pad4(buf, fill) {
  const extra = (4 - (buf.length % 4)) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra, fill)]) : buf;
}

function toGlb(name, { positions, normals, indices }) {
  const pos = Buffer.from(new Float32Array(positions).buffer);
  const nor = Buffer.from(new Float32Array(normals).buffer);
  const idx = pad4(Buffer.from(new Uint16Array(indices).buffer), 0);
  const bin = Buffer.concat([pos, nor, idx]);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < positions.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[k + a]);
      max[a] = Math.max(max[a], positions[k + a]);
    }
  }

  const json = {
    asset: { version: '2.0', generator: 'ForgeMind generate_wig_glb.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{
      name: 'WigWhite',
      pbrMetallicRoughness: { baseColorFactor: COLOR, metallicFactor: 0, roughnessFactor: 0.8 },
      doubleSided: true,
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length, byteLength: nor.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length + nor.length, byteLength: indices.length * 2, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonChunk.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4); // "BIN\0"
  return { glb: Buffer.concat([header, jh, jsonChunk, bh, bin]), min, max };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [bodyType, cfg] of Object.entries(BODIES)) {
  const label = bodyType[0].toUpperCase() + bodyType.slice(1);
  const fileName = `Wig_White_Cap_${label}.glb`;
  const mesh = buildCap(cfg);
  const { glb, min, max } = toGlb(`Wig_White_Cap_${label}`, mesh);
  writeFileSync(join(OUT_DIR, fileName), glb);
  const f = (v) => v.map((n) => n.toFixed(3)).join(', ');
  console.log(`${fileName}: ${(glb.length / 1024).toFixed(1)} KB, ${mesh.indices.length / 3} triangles`);
  console.log(`   min [${f(min)}]  max [${f(max)}]`);
}