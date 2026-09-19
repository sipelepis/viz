// Builds public/models/body-{female,male}.glb for the 3D body map from two sources:
//
//  1. Human Reference Atlas 3D Reference Organ Sets v1.10 (HuBMAP, CC BY 4.0; Visible Human data,
//     National Library of Medicine): the skin, the organs the dashboard maps and the bones the
//     atlas models (spine, pelvis, leg bones, sternum or hyoid). One female and one male body.
//  2. BodyParts3D 4.0 (c) The Database Center for Life Science, CC BY-SA 2.1 Japan: one adult male,
//     per-part OBJ files in millimetres. Supplies what the atlas lacks: skull, ribs, shoulder girdle,
//     arm, hand and foot bones, stomach, oesophagus, testes and penis, and the ischium and pubis that
//     the female atlas pelvis is missing. BodyParts3D has no thyroid gland, so that one mesh comes
//     from Z-Anatomy (CC BY-SA 4.0), itself a BodyParts3D derivative. These parts are fitted piecewise
//     into each atlas body (see fitParts); the female body gets the same male-derived parts scaled by
//     her own transforms. One atlas organ is adjusted in turn: the brain, which all but touches the
//     atlas skin, is rescaled to sit inside the fitted skull.
//
// Every app-level id becomes one top-level group; meshes keep positions only, are welded,
// simplified to a triangle budget, quantized and meshopt-compressed. Because of source 2 the
// resulting GLBs are CC BY-SA (see public/models/ATTRIBUTION.md).
//
// The build prints "fit check" lines: how far fitted parts land from the atlas's own organs, and what
// share of each fitted part's vertices lies outside the atlas skin (a ray-cast test; a few percent is
// fingers and toes, more means a fit has gone wrong).
//
//   node scripts/build-body-models.mjs   (from apps/cancer; needs `unzip`; downloads ~750 MB once into .cache/)
//   node scripts/build-body-models.mjs --fit-only   (fit checks only, writes nothing)
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const VERSION = 'v1.10';
const CACHE = new URL('../.cache/', import.meta.url);
const OUT = new URL('../public/models/', import.meta.url);
const BP3D_URL = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip';
// Z-Anatomy's Startup.blend exported to glTF by this repository (pinned commit), CC BY-SA 4.0.
const ZANATOMY_URL = 'https://raw.githubusercontent.com/DrMuratAltun/anatomi-simulatoru/37e85dfbbb398e11ba33c8f0e411f06f9bba592f/systems/ic-organlar.glb';

// Organ id (as used by the app) -> atlas node names, without the VH_F_/VH_M_ prefix.
const ORGANS = {
  skin: ['skin'],
  brain: ['Allen_brain'],
  oral: ['tongue', 'secondary_palate', 'buccal_mucosa', 'major_salivary_gland', 'mouth_floor'], // mouth without gums/teeth
  larynx: ['larynx'],
  lung: ['lungs'],
  breast: ['mammary_gland'],
  liver: ['liver'],
  pancreas: ['pancreas'],
  kidney: ['kidney'],
  colorectum: ['colon'],
  bladder: ['urinary_bladder'],
  uterus: ['body_of_uterus', 'fundus_of_uterus', 'cornua', 'lower_uterine_segment', 'posterior_wall_of_uterus',
    'anterior_wall_of_uterus'],
  cervix: ['cervix'],
  ovary: ['ovary'],
  vagina: ['vagina'],
  fallopian: ['fallopian_tube'],
  prostate: ['prostate_gland'],
  seminal: ['male_genital_duct'],
  blood: ['pelvis'], // stand-in: the pelvis is a main site of bone marrow
  lymph: ['Yao_capsule_of_lymph_node'], // one detailed node; its capsule is the outer surface
  heart: ['heart'],
  intestine: ['small_intestine'],
  spleen: ['spleen'],
  gallbladder: ['gallbladder_'],
  trachea: ['tracheobronchial_tree'],
  // The atlas's own bones (plus the pelvis, above). BodyParts3D fills in the rest.
  skeleton: ['vertebral_column', 'sternum', 'manubrium', 'hyoid', 'lower_limb'],
};
const SKIP = /nucleus_pulposus/; // hidden inside the intervertebral disks
const ENLARGE = { lymph: 2.5 }; // a 2 cm node is too small to see or click at body scale

// BodyParts3D element names (from the OBJ headers) per group. `skeleton` lists only what the atlas lacks.
const SKULL = /^(Frontal|Occipital|Sphenoid) bone$|^Ethmoid$|^Vomer$|^Mandible$|^(Right|Left) (parietal|temporal|nasal|lacrimal|palatine|zygomatic) bone$|^(Right|Left) (maxilla|inferior nasal concha)$| tooth$/;
const RIBS = / rib$| costal cartilage$/;
const STERNUM = /^(Manubrium|Body of sternum|Xiphoid process)$/;
const GIRDLE = /^(Right|Left) (clavicle|scapula)$/;
const ARM = /^(Right|Left) (humerus|radius|ulna|scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate)$| metacarpal bone$|^\w+ phalanx of .* (finger|thumb)$/;
const FOOT = /^(Right|Left) (calcaneus|talus|cuboid bone|(medial|intermediate|lateral) cuneiform bone)$|^Navicular bone of (right|left) foot$| metatarsal bone$|^\w+ phalanx of .* toe$|^Sesamoid bone of foot$/;
const BP3D_SKELETON = (sex) => [SKULL, RIBS, GIRDLE, ARM, FOOT, sex === 'male' ? STERNUM : /^(Hyoid bone|Xiphoid process)$/]; // each atlas body has one of the two
const BP3D_ORGANS = {
  stomach: { re: /^Stomach$/ },
  oesophagus: { re: /^Esophagus$/ },
  testis: { re: /^(Right|Left) testis$/, sex: 'male' },
  penis: { re: /^(Corpus cavernosum|Corpus spongiosum) of penis$|^Glans penis$/, sex: 'male' },
};
// Reference structures present in both sources, used to fit and to check the fit.
const REF = {
  thoracic: / thoracic vertebra$/,
  spine: / (cervical|thoracic|lumbar) vertebra$/,
  brain: /gyrus$|lobe$|lobule$|^Cerebellum$|^Pons$/,
  heart: /^Wall of (ventricle|left atrium|right atrium)$/,
  spleen: /^Spleen$/,
  hips: /^(Right|Left) hip bone$/,
  femur: /^(Right|Left) femur$/,
  pelvis: /^(Right|Left) hip bone$|^Sacrum$/, // BodyParts3D's sacrum includes the coccyx
  liver: /^Hepatovenous segment|^Caudate lobe of liver$/,
  kidney: /^(Right|Left) kidney$/,
  tibia: /^(Right|Left) tibia$/,
};

// Triangle budgets. `skeleton` is the atlas's bones, `skeleton:bp3d` the added ones (already coarse).
const BUDGET = { skin: 60000, skeleton: 40000, 'skeleton:bp3d': 50000, brain: 16000, lung: 12000, breast: 12000, oral: 10000,
  liver: 10000, colorectum: 12000, blood: 12000, kidney: 8000, heart: 10000, intestine: 12000, trachea: 10000,
  thyroid: 2000, testis: 1000, penis: 3000, gallbladder: 2000, ovary: 1000 };
const DEFAULT_BUDGET = 5000;
const RIB_MARGIN = 0.012; // ribs lie this far outside the lungs, in metres
const FLESH = 0.007; // least depth of the foot bones under the skin
const LIP = 0.01; // thickness of the lips in front of the incisors
const FINGER_GIRTH = 0.8; // the atlas hands are slimmer than BodyParts3D's
const SCALP = 0.005; // least thickness of skin over the skull

async function download(url, file) {
  if (existsSync(file)) return file;
  mkdirSync(new URL('.', file), { recursive: true });
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return file;
}

const hraSource = async (sex) => fileURLToPath(await download(
  `https://cdn.humanatlas.io/digital-objects/ref-organ/united-${sex}/${VERSION}/assets/3d-vh-${sex[0]}-united.glb`,
  new URL(`hra/3d-vh-${sex[0]}-united-${VERSION}.glb`, CACHE)));

// ---- geometry helpers: points are flat [x, y, z, ...] arrays in metres, y up, facing +z ----

function bbox(...pointSets) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const pts of pointSets) {
    for (let i = 0; i < pts.length; i++) {
      const a = i % 3;
      if (pts[i] < min[a]) min[a] = pts[i];
      if (pts[i] > max[a]) max[a] = pts[i];
    }
  }
  return { min, max };
}
const centre = (b) => b.min.map((v, a) => (v + b.max[a]) / 2);
const size = (b) => b.max.map((v, a) => v - b.min[a]);

function centroid(pts, keep = () => true) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < pts.length; i += 3) {
    if (!keep(pts[i], pts[i + 1], pts[i + 2])) continue;
    sum[0] += pts[i]; sum[1] += pts[i + 1]; sum[2] += pts[i + 2]; n++;
  }
  return sum.map((v) => v / n);
}

function extreme(pts, score) { // the point with the highest score
  let best = -Infinity, at = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const s = score(pts[i], pts[i + 1], pts[i + 2]);
    if (s > best) { best = s; at = i; }
  }
  return [pts[at], pts[at + 1], pts[at + 2]];
}

function where(pts, keep) { // the points that pass `keep(x, y, z)`
  const out = [];
  for (let i = 0; i < pts.length; i += 3) if (keep(pts[i], pts[i + 1], pts[i + 2])) out.push(pts[i], pts[i + 1], pts[i + 2]);
  return out;
}

// Point-in-mesh test for a closed surface: cast a ray towards +z and count crossings, with the
// triangles bucketed on a 1 cm grid in x, y. Returns the share of `pts` that lie outside.
function outsideShare({ pos, idx }) {
  const CELL = 0.01, grid = new Map(), key = (x, y) => Math.floor(x / CELL) * 1e5 + Math.floor(y / CELL);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const x0 = Math.min(pos[a], pos[b], pos[c]), x1 = Math.max(pos[a], pos[b], pos[c]);
    const y0 = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]), y1 = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]);
    for (let x = x0; x < x1 + CELL; x += CELL) for (let y = y0; y < y1 + CELL; y += CELL) { const k = key(Math.min(x, x1), Math.min(y, y1)); (grid.get(k) ?? grid.set(k, []).get(k)).push(t); }
  }
  const inside = (x, y, z) => {
    let crossings = 0;
    for (const t of new Set(grid.get(key(x, y)))) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const d = (pos[b + 1] - pos[c + 1]) * (pos[a] - pos[c]) + (pos[c] - pos[b]) * (pos[a + 1] - pos[c + 1]);
      if (!d) continue;
      const u = ((pos[b + 1] - pos[c + 1]) * (x - pos[c]) + (pos[c] - pos[b]) * (y - pos[c + 1])) / d;
      const v = ((pos[c + 1] - pos[a + 1]) * (x - pos[c]) + (pos[a] - pos[c]) * (y - pos[c + 1])) / d;
      if (u >= 0 && v >= 0 && u + v <= 1 && u * pos[a + 2] + v * pos[b + 2] + (1 - u - v) * pos[c + 2] > z) crossings++;
    }
    return crossings % 2 === 1;
  };
  return (...pointSets) => {
    let out = 0, all = 0;
    for (const pts of pointSets) for (let i = 0; i < pts.length; i += 3, all++) if (!inside(pts[i], pts[i + 1], pts[i + 2])) out++;
    return out / all;
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(...a);

// Axis-aligned scale + translate taking box `from` onto box `to`. `yFrom`/`yTo` override the vertical axis.
function boxMap(from, to, yFrom = from, yTo = to) {
  const s = [0, 1, 2].map((a) => { const [f, t] = a === 1 ? [yFrom, yTo] : [from, to]; return (t.max[a] - t.min[a]) / (f.max[a] - f.min[a]); });
  const o = [0, 1, 2].map((a) => { const [f, t] = a === 1 ? [yFrom, yTo] : [from, to]; return t.min[a] - f.min[a] * s[a]; });
  return (p) => [p[0] * s[0] + o[0], p[1] * s[1] + o[1], p[2] * s[2] + o[2]];
}

// Rotate + uniformly scale so that segment p0->p1 lands on q0->q1 (shortest rotation, no twist).
function segmentMap(p0, p1, q0, q1, girth = 1) { // `girth` scales across the segment only
  const d0 = sub(p1, p0), d1 = sub(q1, q0);
  const s = len(d1) / len(d0);
  const a = d0.map((v) => v / len(d0)), b = d1.map((v) => v / len(d1));
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const k = 1 / (1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  const R = [ // Rodrigues: I + [v]x + [v]x^2 / (1 + a.b)
    [1 - k * (v[1] * v[1] + v[2] * v[2]), -v[2] + k * v[0] * v[1], v[1] + k * v[0] * v[2]],
    [v[2] + k * v[0] * v[1], 1 - k * (v[0] * v[0] + v[2] * v[2]), -v[0] + k * v[1] * v[2]],
    [-v[1] + k * v[0] * v[2], v[0] + k * v[1] * v[2], 1 - k * (v[0] * v[0] + v[1] * v[1])],
  ];
  return (p) => {
    const d = sub(p, p0), t = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    for (let i = 0; i < 3; i++) d[i] = t * a[i] + girth * (d[i] - t * a[i]);
    return [0, 1, 2].map((r) => q0[r] + s * (R[r][0] * d[0] + R[r][1] * d[1] + R[r][2] * d[2]));
  };
}

function apply(parts, map) {
  for (const part of parts) {
    for (let i = 0; i < part.pos.length; i += 3) part.pos.set(map([part.pos[i], part.pos[i + 1], part.pos[i + 2]]), i);
  }
}

// ---- BodyParts3D ----

function parseObj(text) { // positions + faces only; millimetres, z up, facing -y  ->  metres, y up, facing +z
  const pos = [], idx = [];
  let bounds;
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      pos.push(x / 1000, z / 1000, -y / 1000);
    } else if (line.startsWith('f ')) {
      const f = line.slice(2).trim().split(/\s+/).map((t) => parseInt(t, 10) - 1);
      for (let i = 2; i < f.length; i++) idx.push(f[0], f[i - 1], f[i]);
    } else if (line.startsWith('# Bounds(mm):')) {
      bounds = line.match(/-?\d+\.\d+/g).map(Number);
    }
  }
  // Self-check: the header's bounds must match what we parsed, and every face must point at a vertex.
  const b = bbox(pos);
  [b.min[0], -b.max[2], b.min[1], b.max[0], -b.min[2], b.max[1]].forEach((v, i) => assert(Math.abs(v * 1000 - bounds[i]) < 1, 'OBJ bounds'));
  assert(idx.every((i) => i >= 0 && i < pos.length / 3), 'OBJ face index out of range');
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

async function loadBp3d() {
  const dir = new URL('bp3d/isa_BP3D_4.0_obj_99/', CACHE);
  if (!existsSync(dir)) {
    const zip = await download(BP3D_URL, new URL('bp3d/isa_BP3D_4.0_obj_99.zip', CACHE));
    execFileSync('unzip', ['-qo', fileURLToPath(zip), '-d', fileURLToPath(new URL('bp3d/', CACHE))]);
  }
  const wanted = [SKULL, RIBS, STERNUM, GIRDLE, ARM, FOOT, /^Hyoid bone$/,
    ...Object.values(BP3D_ORGANS).map((o) => o.re), ...Object.values(REF)];
  const parts = new Map(); // element name -> part; the archive repeats some elements under two file ids
  for (const file of readdirSync(dir)) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    const name = text.match(/^# English name : (.*)$/m)?.[1].trim();
    if (name && !parts.has(name) && wanted.some((re) => re.test(name))) parts.set(name, { name, ...parseObj(text) });
  }
  return [...parts.values()];
}

async function loadThyroid(io) { // Z-Anatomy's thyroid plus its trachea, which locates it
  const doc = await io.read(fileURLToPath(await download(ZANATOMY_URL, new URL('zanatomy/ic-organlar.glb', CACHE))));
  const get = (name) => {
    const node = doc.getRoot().listNodes().find((n) => n.getName() === name);
    const { pos, idx } = worldMesh([node]);
    return { name, pos: new Float32Array(pos), idx: new Uint32Array(idx) };
  };
  return { thyroid: get('Thyroid gland'), trachea: get('Trachea') };
}

// ---- atlas ----

function worldMesh(nodes) { // every mesh under `nodes`, merged, in world space
  const pos = [], idx = [];
  for (const node of nodes) {
    node.traverse((c) => {
      const m = c.getWorldMatrix(), v = [0, 0, 0];
      for (const prim of c.getMesh()?.listPrimitives() ?? []) {
        const a = prim.getAttribute('POSITION'), first = pos.length / 3;
        for (const i of prim.getIndices().getArray()) idx.push(first + i);
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, v);
          pos.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
        }
      }
    });
  }
  return { pos, idx };
}

const triangles = (nodes) => {
  let n = 0;
  for (const node of nodes) node.traverse((c) => c.getMesh()?.listPrimitives().forEach((p) => { n += (p.getIndices()?.getCount() ?? 0) / 3; }));
  return n;
};

const mm = (v) => v.map((x) => Math.round(x * 1000)).join(',');

// Fits copies of the BodyParts3D parts into one atlas body. `hra(name)` gives the atlas's points for a node name.
function fitParts(sex, all, zanatomy, hra, outside) {
  const parts = all.map((p) => ({ ...p, pos: p.pos.slice() }));
  const pick = (...res) => parts.filter((p) => res.some((re) => re.test(p.name)));
  const pts = (...res) => pick(...res).map((p) => p.pos);
  const check = (what, got, want) => console.log(`  ${sex} fit check ${what.padEnd(7)} centre off by ${mm(sub(centre(got), centre(want)))} mm, size ${mm(size(got))} vs ${mm(size(want))}`);
  const skin = hra('skin');
  const thoracic = Array.from({ length: 12 }, (_, i) => hra(`thoracic_vertebra_${i + 1}`));

  // 1. Thorax: the rib cage spans the atlas's thoracic vertebrae in height, reaches back to them, is as
  //    wide as the lungs plus a margin and comes forward to the sternum (or, on the male body, which
  //    has none, to just under the skin of the chest).
  const lungs = bbox(hra('lungs')), spine = bbox(...thoracic);
  const front = sex === 'female' ? bbox(hra('sternum'), hra('manubrium')).max[2]
    : bbox(where(skin, (x, y, z) => Math.abs(x) < 0.02 && y > spine.min[1] + 0.1 && y < spine.max[1] - 0.05 && z > 0)).max[2] - 0.012;
  const thorax = boxMap(bbox(...pts(RIBS, STERNUM, REF.thoracic)),
    { min: [lungs.min[0] - RIB_MARGIN, 0, spine.min[2]], max: [lungs.max[0] + RIB_MARGIN, 0, front] }, bbox(...pts(REF.thoracic)), spine);
  apply(pick(RIBS, STERNUM, GIRDLE, ARM, /^Esophagus$/, REF.heart), thorax);
  check('heart', bbox(...pts(REF.heart)), bbox(hra('heart')));

  // 2. Upper abdomen: liver + spleen + kidneys box onto the atlas's, for the stomach that lies between them.
  const abdomen = boxMap(bbox(...pts(REF.liver, REF.spleen, REF.kidney)), bbox(hra('liver'), hra('spleen'), hra('kidney')));
  apply(pick(/^Stomach$/, REF.liver, REF.spleen, REF.kidney), abdomen);
  for (const organ of ['liver', 'spleen', 'kidney']) check(organ, bbox(...pts(REF[organ])), bbox(hra(organ)));
  // The oesophagus runs down the front of the spine, so it follows the atlas's spinal curve: shift each
  // height by the offset between the atlas's vertebrae and BodyParts3D's (as placed by the thorax map).
  const spineLine = (pts) => { // per 1 cm of height: [centre x, front z] of the vertebrae
    const bins = new Map();
    for (let i = 0; i < pts.length; i += 3) { const k = Math.round(pts[i + 1] * 100), b = bins.get(k) ?? bins.set(k, [Infinity, -Infinity, -Infinity]).get(k); b[0] = Math.min(b[0], pts[i]); b[1] = Math.max(b[1], pts[i]); b[2] = Math.max(b[2], pts[i + 2]); }
    const keys = [...bins.keys()];
    return (y) => { const k = keys.reduce((best, q) => (Math.abs(q - y * 100) < Math.abs(best - y * 100) ? q : best)); return [-1, 0, 1].map((d) => bins.get(k + d) ?? bins.get(k)).reduce((sum, b) => [sum[0] + (b[0] + b[1]) / 6, sum[1] + b[2] / 3], [0, 0]); };
  };
  apply(pick(REF.spine), thorax);
  const theirs = spineLine(pts(REF.spine).flatMap((p) => [...p])), ours = spineLine(hra('vertebra'));
  apply(pick(/^Esophagus$/), (p) => { const a = theirs(p[1]), b = ours(p[1]); return [p[0] + b[0] - a[0], p[1], p[2] + b[1] - a[1]]; });
  const cardia = extreme(pts(/^Esophagus$/)[0], (x, y) => -y), join = extreme(pts(/^Stomach$/)[0], (x, y, z) => -len(sub([x, y, z], cardia)));
  console.log(`  ${sex} fit check oesophagus' lower end ${mm(cardia)} is ${mm([len(sub(join, cardia))])} mm from the stomach (${mm(join)})`);

  // 3. Head: BodyParts3D's brain box onto the atlas's brain, then shrunk about the brain's centre
  //    until the vault clears the scalp by SCALP at the top and the back.
  const brain = bbox(hra('Allen_brain')), c = centre(brain);
  apply(pick(SKULL, /^Hyoid bone$/), boxMap(bbox(...pts(REF.brain)), brain));
  const skull = bbox(...pts(SKULL)), head = bbox(where(skin, (x, y) => y > c[1]));
  const k = Math.min(1, (head.max[1] - SCALP - c[1]) / (skull.max[1] - c[1]), (head.min[2] + SCALP - c[2]) / (skull.min[2] - c[2]));
  apply(pick(SKULL, /^Hyoid bone$/), (p) => p.map((v, a) => c[a] + (v - c[a]) * k));
  // The face then comes forward (stretching the skull front to back) until the incisors sit a lip's thickness behind the skin's lips.
  const teeth = bbox(...pts(/ tooth$/)), back = bbox(...pts(SKULL)).min[2];
  const lips = bbox(where(skin, (x, y) => Math.abs(x) < 0.015 && y > teeth.min[1] && y < centre(teeth)[1])).max[2];
  const stretch = (lips - LIP - back) / (teeth.max[2] - back);
  apply(pick(SKULL, /^Hyoid bone$/), (p) => [p[0], p[1], back + (p[2] - back) * stretch]);
  // The atlas's brain all but touches its skin, leaving no room for bone, so it takes the same shrink and
  // stretch: it then sits in this skull as BodyParts3D's brain sits in its own.
  const brainFit = { scale: [k, k, k * stretch], translation: [c[0] * (1 - k), c[1] * (1 - k), back + (c[2] * (1 - k) - back) * stretch] };
  console.log(`  ${sex} fit check skull   shrunk x${k.toFixed(3)}: ${mm(bbox(...pts(SKULL)).min)} .. ${mm(bbox(...pts(SKULL)).max)}, skin above brain centre ${mm(head.min)} .. ${mm(head.max)}, atlas top ${mm([bbox(hra('cervical_vertebra_1')).max[1]])}`);

  // 4. Arms: the atlas skin holds them away from the body, bent at the elbow and wrist. Trace the skin
  //    arm's centreline, find the elbow and wrist along it at the (scaled) bone lengths, then carry
  //    humerus, forearm and hand each on its own segment, ending fingertip to fingertip.
  // 5. Feet: the box of the foot bones into the box of the skin's foot below the atlas's tibia, less the flesh.
  for (const side of [-1, 1]) { // -1 is the body's right
    const mine = (p) => p.pos[0] * side > 0, name = side < 0 ? 'right' : 'left ';
    const arm = pick(ARM).filter(mine), bones = (re) => arm.filter((p) => re.test(p.name));
    const humerus = bones(/ humerus$/)[0].pos, ys = bbox(humerus);
    const joints = [centroid(humerus, (x, y) => y > ys.max[1] - 0.035), centroid(humerus, (x, y) => y < ys.min[1] + 0.025),
      centroid(bones(/ (lunate|capitate)$/).flatMap((p) => [...p.pos]))]; // shoulder, elbow, wrist
    joints.push(extreme(bones(/phalanx/).flatMap((p) => [...p.pos]), (x, y, z) => len(sub([x, y, z], joints[2])))); // fingertip
    const lengths = [0, 1, 2].map((i) => len(sub(joints[i + 1], joints[i])));
    const shoulder = joints[0], reach = extreme(skin, (x) => x * side);
    const armSkin = where(skin, (x, y) => x * side > Math.abs(shoulder[0]) + (y > shoulder[1] - 0.3 ? 0.04 : 0.1) && y < shoulder[1] && y > reach[1] - 0.15); // clear of trunk and hips
    const fingertip = extreme(armSkin, (x, y, z) => len(sub([x, y, z], shoulder)));
    const along = sub(fingertip, shoulder).map((v) => v / len(sub(fingertip, shoulder))), line = [];
    for (let t = 0.1; t < len(sub(fingertip, shoulder)); t += 0.01) { // centroids of 1 cm slices across the arm
      const slice = where(armSkin, (x, y, z) => { const d = (x - shoulder[0]) * along[0] + (y - shoulder[1]) * along[1] + (z - shoulder[2]) * along[2] - t; return d >= 0 && d < 0.01; });
      if (slice.length) line.push(centroid(slice));
    }
    const nearest = (from, distance) => line.reduce((best, p) => (Math.abs(len(sub(p, from)) - distance) < Math.abs(len(sub(best, from)) - distance) ? p : best));
    const to = [shoulder, 0, 0, fingertip.map((v, a) => v + (shoulder[a] - v) * 0.03)];
    let scale = len(sub(to[3], shoulder)) / (lengths[0] + lengths[1] + lengths[2]);
    for (let i = 0; i < 4; i++) { // the joints' places and the arm's scale depend on each other
      to[1] = nearest(shoulder, lengths[0] * scale);
      to[2] = nearest(to[1], lengths[1] * scale);
      scale = (len(sub(to[1], shoulder)) + len(sub(to[2], to[1])) + len(sub(to[3], to[2]))) / (lengths[0] + lengths[1] + lengths[2]);
    }
    const hand = arm.filter((p) => !/ (humerus|radius|ulna)$/.test(p.name)), unfitted = hand.map((p) => p.pos.slice());
    [bones(/ humerus$/), bones(/ (radius|ulna)$/)].forEach((segment, i) => apply(segment, segmentMap(joints[i], joints[i + 1], to[i], to[i + 1])));
    // The hand is slimmed as far as it takes to sit inside the skin's (the female atlas hand is much narrower than BodyParts3D's).
    const slim = [1, 0.9, 0.8, 0.7].map((girth) => {
      hand.forEach((p, i) => p.pos.set(unfitted[i]));
      apply(hand, segmentMap(joints[2], joints[3], to[2], to[3], girth));
      return [outside(...hand.filter((p) => !/phalanx/.test(p.name)).map((p) => p.pos)), girth];
    }).reduce((best, tried) => (tried[0] < best[0] - 0.02 ? tried : best))[1];
    hand.forEach((p, i) => p.pos.set(unfitted[i]));
    apply(hand, segmentMap(joints[2], joints[3], to[2], to[3], slim));
    // Fingers: the skin hand's fingertips are the farthest points from the wrist, one per 9-degree cone. The
    // first four are the long fingers (the shortest of them the little finger, the rest in order of angle
    // from it); the thumb is the later one that stands farthest round from the little finger.
    const wrist = to[2], far = (p) => len(sub(p, wrist)), angle = (p, q) => { const a = sub(p, wrist), b = sub(q, wrist); return Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b)))); };
    let handSkin = where(armSkin, (x, y, z) => far([x, y, z]) > 0.05 && angle([x, y, z], to[3]) < Math.PI / 3);
    const tips = [];
    while (tips.length < 9 && handSkin.length) {
      const tip = extreme(handSkin, (x, y, z) => far([x, y, z]));
      tips.push(tip);
      handSkin = where(handSkin, (x, y, z) => angle([x, y, z], tip) > 9 * Math.PI / 180);
    }
    const long = tips.slice(0, 4), little = long.reduce((best, p) => (far(p) < far(best) ? p : best));
    long.sort((p, q) => angle(q, little) - angle(p, little)); // index, middle, ring, little
    const thumb = tips.slice(4).filter((p) => far(p) > 0.6 * far(long[1]) && angle(p, little) > angle(long[0], little) + 0.14).sort((p, q) => angle(q, little) - angle(p, little))[0];
    ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger'].forEach((finger, i) => {
      const chain = arm.filter((p) => p.name.endsWith(finger) || (i === 0 && / first metacarpal bone$/.test(p.name))), all = chain.flatMap((p) => [...p.pos]);
      const near = extreme(all, (x, y, z) => -far([x, y, z])), base = centroid(all, (x, y, z) => len(sub([x, y, z], near)) < 0.012), tip = extreme(all, (x, y, z) => far([x, y, z]));
      const target = [thumb, ...long][i], aim = target?.map((v, a) => v + (base[a] - v) * 0.06), ratio = aim ? len(sub(aim, base)) / len(sub(tip, base)) : 0;
      if (ratio > 0.75 && ratio < 1.3) apply(chain, segmentMap(base, tip, base, aim, FINGER_GIRTH));
      else console.log(`  ${sex} fit check ${name} ${finger}: no believable skin fingertip (x${ratio.toFixed(2)}), left as is`);
    });
    console.log(`  ${sex} fit check ${name} arm x${scale.toFixed(2)}, hand slimmed x${slim}, via ${to.map(mm).join(' -> ')}: ${(outside(...arm.map((p) => p.pos)) * 100).toFixed(1)}% outside the skin`);

    const foot = pick(FOOT).filter(mine), ankle = bbox(hra(`tibia_${side < 0 ? 'R' : 'L'}`)).min[1];
    const footSkin = where(skin, (x, y) => x * side > 0 && y < ankle), room = bbox(footSkin), sole = new Map(), cell = (x, z) => Math.round(x * 100) * 1000 + Math.round(z * 100); // sole: lowest skin per square cm
    apply(foot, boxMap(bbox(...foot.map((p) => p.pos)), { min: [room.min[0] + FLESH, room.min[1] + 1.5 * FLESH, room.min[2] + 2 * FLESH], max: [room.max[0] - FLESH, ankle, room.max[2] - 2.5 * FLESH] }));
    // The skin's sole is not flat (the toes turn up), so lift the bones with it, fading out towards the ankle.
    for (let i = 0; i < footSkin.length; i += 3) { const k = cell(footSkin[i], footSkin[i + 2]); sole.set(k, Math.min(sole.get(k) ?? Infinity, footSkin[i + 1])); }
    apply(foot, (p) => [p[0], p[1] + Math.max(0, (sole.get(cell(p[0], p[2])) ?? room.min[1]) - room.min[1]) * Math.max(0, (ankle - p[1]) / (ankle - room.min[1])), p[2]]);
    console.log(`  ${sex} fit check ${name} foot into ${mm(room.min)} .. ${mm(room.max)}: ${(outside(...foot.map((p) => p.pos)) * 100).toFixed(1)}% outside the skin`);
  }

  // 6. Thyroid (Z-Anatomy): centred in height on the lower border of the atlas's larynx (the cricoid), and
  //    set against the atlas's trachea there as it sits against the top of Z-Anatomy's; scaled by the tracheas' lengths.
  const zt = zanatomy.trachea.pos, ht = hra('trachea_of_respiratory_system'), cricoid = bbox(hra('larynx')).min[1];
  const from = centroid(zt, (x, y) => y > bbox(zt).max[1] - 0.015), to = centroid(ht, (x, y) => Math.abs(y - cricoid) < 0.0075);
  from[1] = centre(bbox(zanatomy.thyroid.pos))[1]; to[1] = cricoid;
  const s = Math.min(1.1, size(bbox(ht))[1] / size(bbox(zt))[1]);
  const thyroid = { name: 'Thyroid gland', idx: zanatomy.thyroid.idx, pos: zanatomy.thyroid.pos.slice() };
  apply([thyroid], (p) => p.map((v, a) => to[a] + (v - from[a]) * s));
  console.log(`  ${sex} fit check thyroid x${s.toFixed(2)} ${mm(bbox(thyroid.pos).min)} .. ${mm(bbox(thyroid.pos).max)}, larynx ${mm(bbox(hra('larynx')).min)} .. ${mm(bbox(hra('larynx')).max)}`);

  // 7. Male genitals: carried by the pelvis (hip bones + sacrum onto the atlas's pelvis). The penis is then
  //    laid along the atlas's penile urethra, bulb at its start and tip of the glans just short of its
  //    opening, and slimmed to the (cadaveric) skin; the testes go to the middle of the skin's scrotum,
  //    which hangs behind and just above that opening.
  if (sex === 'male') {
    const penis = pick(BP3D_ORGANS.penis.re), testes = pick(BP3D_ORGANS.testis.re);
    apply([...penis, ...testes], boxMap(bbox(...pts(REF.pelvis)), bbox(hra('pelvis'))));
    const run = (tube, end = tube) => { const back = bbox(tube).min[2] + 0.01, root = centroid(tube, (x, y, z) => z < back); return [root, extreme(end, (x, y, z) => len(sub([x, y, z], root)))]; };
    const [bulb, glans] = run(penis.flatMap((p) => [...p.pos]), pick(/^Glans penis$/)[0].pos), [start, opening] = run(hra('other_urethra'));
    apply(penis, segmentMap(bulb, glans, start, opening.map((v, a) => v + (start[a] - v) * 0.05), 0.8));
    const sac = centre(bbox(where(skin, (x, y, z) => Math.abs(x) < 0.05 && Math.abs(y - opening[1] - 0.012) < 0.025 && z > opening[2] - 0.075 && z < opening[2] - 0.03)));
    const from = centre(bbox(...testes.map((p) => p.pos)));
    apply(testes, (p) => p.map((v, a) => v + sac[a] - from[a]));
    console.log(`  ${sex} fit check penis laid on urethra ${mm(start)} -> ${mm(opening)}, testes centred on ${mm(sac)}`);
  }

  // 8. The female atlas pelvis is sacrum, coccyx and ilia only. Complete it with the lower part (ischium and
  //    pubis) of BodyParts3D's hip bones: pelvis box onto pelvis box in width and depth, the same scale in
  //    height with the hip joints level with the atlas's femoral heads, keeping the triangles below where
  //    the atlas's ilia end.
  if (sex === 'female') {
    const hips = pick(REF.hips), ilium = bbox(hra('ilium')), theirs = bbox(...pts(REF.pelvis)), ours = bbox(hra('pelvis'));
    const level = boxMap(theirs, ours), s = size(ours)[0] / size(theirs)[0], joint = bbox(...pts(REF.femur)).max[1], hraJoint = bbox(hra('femur_R'), hra('femur_L')).max[1];
    apply(hips, (p) => { const q = level(p); return [q[0], hraJoint + (p[1] - joint) * s, q[2]]; });
    for (const hip of hips) {
      const idx = [];
      for (let t = 0; t < hip.idx.length; t += 3) if ([0, 1, 2].every((i) => hip.pos[hip.idx[t + i] * 3 + 1] < ilium.min[1] + 0.012)) idx.push(hip.idx[t], hip.idx[t + 1], hip.idx[t + 2]);
      hip.idx = new Uint32Array(idx);
    }
    console.log(`  ${sex} fit check hip bones ${mm(bbox(...pts(REF.hips)).min)} .. ${mm(bbox(...pts(REF.hips)).max)} below the atlas ilia ${mm(ilium.min)} .. ${mm(ilium.max)}; femur heads ${mm(bbox(hra('femur_R')).max)} / ${mm(bbox(hra('femur_L')).max)}`);
  }

  for (const [what, re] of Object.entries({ skull: SKULL, ribs: RIBS, girdle: GIRDLE, stomach: /^Stomach$/, oesophagus: /^Esophagus$/, ...(sex === 'male' ? { penis: BP3D_ORGANS.penis.re, testis: BP3D_ORGANS.testis.re } : {}) })) {
    console.log(`  ${sex} fit check ${what.padEnd(10)} ${(outside(...pts(re)) * 100).toFixed(1)}% outside the skin`);
  }
  return { parts: [...parts, thyroid], brainFit };
}

async function build(io, sex, bp3d, zanatomy) {
  const doc = await io.read(await hraSource(sex));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const prefix = sex === 'female' ? 'VH_F_' : 'VH_M_';
  const nodes = root.listNodes();
  const find = (names) => nodes.filter((n) => names.some((name) => n.getName() === name || n.getName() === prefix + name));
  const cache = new Map();
  const hra = (name) => cache.get(name) ?? cache.set(name, worldMesh(find([name])).pos).get(name);

  const { parts: fitted, brainFit } = fitParts(sex, bp3d, zanatomy, hra, outsideShare(worldMesh(find(['skin']))));
  if (process.argv.includes('--fit-only')) return 'nothing (--fit-only)';

  const units = new Map(); // budget unit -> nodes
  const groups = new Map(); // group id -> node
  const group = (id) => groups.get(id) ?? groups.set(id, doc.createNode(id)).get(id);
  const add = (id, unit, node) => { group(id).addChild(node); units.set(unit, [...(units.get(unit) ?? []), node]); };

  for (const [id, names] of Object.entries(ORGANS)) {
    // Flatten each picked subtree into meshes carrying their world transforms.
    for (const n of find(names)) {
      n.traverse((c) => {
        if (c.getMesh() && !SKIP.test(c.getName())) add(id, id, doc.createNode(c.getName()).setMesh(c.getMesh()).setMatrix(c.getWorldMatrix()));
      });
    }
  }
  const buffer = root.listBuffers()[0];
  const addPart = (id, unit, part) => {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(part.pos).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(part.idx).setBuffer(buffer));
    add(id, unit, doc.createNode(part.name).setMesh(doc.createMesh(part.name).addPrimitive(prim)));
  };
  for (const part of fitted) {
    if (BP3D_SKELETON(sex).some((re) => re.test(part.name))) addPart('skeleton', 'skeleton:bp3d', part);
    for (const [id, { re, sex: only }] of Object.entries(BP3D_ORGANS)) if (re.test(part.name) && (!only || only === sex)) addPart(id, id, part);
    if (part.name === 'Thyroid gland') addPart('thyroid', 'thyroid', part);
    if (sex === 'female' && REF.hips.test(part.name)) addPart('blood', 'blood', part); // her ischium and pubis
  }
  group('brain').setScale(brainFit.scale).setTranslation(brainFit.translation);
  for (const [id, s] of Object.entries(ENLARGE)) {
    const b = bbox(worldMesh([group(id)]).pos);
    group(id).setScale([s, s, s]).setTranslation(centre(b).map((v) => v * (1 - s)));
  }

  for (const child of scene.listChildren()) scene.removeChild(child);
  for (const g of groups.values()) scene.addChild(g);
  for (const material of root.listMaterials()) material.dispose(); // the app assigns its own

  // Keep positions only: seams in normals/UVs stop vertices welding, which blocks simplification.
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) if (semantic !== 'POSITION') prim.setAttribute(semantic, null);
    }
  }
  await doc.transform(prune(), dedup(), weld());
  const before = new Map([...units].map(([unit, ns]) => [unit, triangles(ns)]));
  for (const [unit, ns] of units) {
    const ratio = (BUDGET[unit] ?? DEFAULT_BUDGET) / before.get(unit);
    if (ratio >= 1) continue;
    for (const n of ns) n.getMesh().listPrimitives().forEach((p) => simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.05 }));
  }
  // No normals: the app computes smooth ones from the welded mesh (glTF-Transform's normals() are flat).
  await doc.transform(prune(), quantize());
  const after = new Map([...units].map(([unit, ns]) => [unit, triangles(ns)])); // count before encoding
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  mkdirSync(OUT, { recursive: true });
  const out = fileURLToPath(new URL(`body-${sex}.glb`, OUT));
  await io.write(out, doc);
  for (const unit of units.keys()) {
    console.log(`  ${sex} ${unit.padEnd(14)} ${before.get(unit).toLocaleString().padStart(9)} -> ${after.get(unit).toLocaleString()} triangles`);
  }
  return out;
}

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const bp3d = await loadBp3d();
const zanatomy = await loadThyroid(io);
for (const sex of ['female', 'male']) console.log(`wrote ${await build(io, sex, bp3d, zanatomy)}`);
