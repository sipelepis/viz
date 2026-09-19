// 3D body map: Human Reference Atlas female and male bodies (skin, partial skeleton, real organ
// meshes). Organs are shaded by data or shown in natural colours; layers can be switched off.
// Loaded lazily by anatomy.tsx, which owns data, selection, the panel and every DOM control
// (keyboard and screen-reader users drive it from there).
// Models: public/models/body-*.glb, built by scripts/build-body-models.mjs (CC BY 4.0, HuBMAP).
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, ContactShadows, Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ANATOMY } from './colours';

export type Sex = 'Female' | 'Male';
export type Layers = { skin: boolean; skeleton: boolean; organs: boolean };
export type Colour = 'data' | 'anatomy';
// Reveal controls: skin opacity 0-1, cut-away of the front of skin + skeleton 0-1, exploded view 0-1.
export type Reveal = { skin: number; cut: number; explode: number };
export type View =
  | { kind: 'front' | 'side' | 'back'; n: number }
  | { kind: 'organs'; organs: string[]; n: number }
  | { kind: 'orbit'; azimuth: number; polar: number; n: number }
  | { kind: 'zoom'; by: number; n: number };
export type Hover = { id: string; sex: Sex; x: number; y: number } | null;
type Boxes = Map<string, THREE.Box3>; // world bounds per organ, key `${sex}:${id}`

const SEXES: Sex[] = ['Female', 'Male'];
// Side by side when both are shown; a lone figure stands in the centre.
const figureX = (sex: Sex, visible: Sex[]) => (visible.length > 1 ? (sex === 'Female' ? -0.55 : 0.55) : 0);
const url = (sex: Sex) => `/models/body-${sex.toLowerCase()}.glb`;
const NO_FIGURE = '#e6e6e6';
// Groups that carry no cancer figures: shells and orientation organs.
const NON_DATA = new Set(['skin', 'skeleton', 'context', 'intestine', 'heart', 'spleen', 'gallbladder', 'trachea', 'fallopian', 'seminal']);
const CLIPPED = new Set(['skin', 'skeleton']); // what the cut-away slices

function Figure({ sex, x, organIds, paint, selected, highlight, layers, colour, reveal, callout, reduced, onSelect, onHover, onModelled, boxes }: {
  sex: Sex; x: number; organIds: Set<string>; paint: (id: string, sex: Sex) => string | null;
  selected: string | null; highlight: Set<string> | null; layers: Layers; colour: Colour; reveal: Reveal;
  callout: (id: string, sex: Sex) => string | null; reduced: boolean;
  onSelect: (id: string) => void; onHover: (h: Hover) => void; onModelled: (sex: Sex, ids: string[]) => void; boxes: Boxes;
}) {
  const { scene } = useGLTF(url(sex));
  const hovered = useRef<string | null>(null);
  const calloutRef = useRef<THREE.Group>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 10), []);
  const offsets = useMemo(() => new Map<string, THREE.Vector3>(), []);
  const cutNow = useRef(10);

  // One clone per figure, with its own materials; feet on the floor.
  const { root, groups, height, materials, base } = useMemo(() => {
    const model = scene.clone(true);
    const box = new THREE.Box3().setFromObject(model.getObjectByName('skin') ?? model);
    model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const group = new THREE.Group();
    group.add(model);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const material = (id: string) => {
      if (!materials.has(id)) {
        const m = new THREE.MeshStandardMaterial({ color: NO_FIGURE, roughness: 0.55 });
        if (CLIPPED.has(id)) { m.clippingPlanes = [plane]; m.side = THREE.DoubleSide; }
        materials.set(id, m);
      }
      return materials.get(id)!;
    };
    for (const organ of model.children) {
      organ.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.computeVertexNormals(); // smooth shading from the welded mesh
        // The context group holds the heart and the small intestine; colour them apart.
        const id = organ.name === 'context' && /duoden|jejun|ileum|intestin/i.test(o.name) ? 'intestine' : organ.name;
        o.material = material(id);
        if (NON_DATA.has(id)) o.raycast = () => undefined; // clicks pass through to the organs
      });
    }
    const base = new Map(model.children.map((o) => [o.name, o.position.clone()]));
    return { root: group, groups: model.children, height: box.max.y - box.min.y, materials, base };
  }, [scene, plane]);
  useEffect(() => onModelled(sex, groups.map((g) => g.name)), [groups, sex, onModelled]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  useLayoutEffect(() => {
    root.position.x = x;
    root.updateWorldMatrix(true, true);
    for (const organ of groups) organ.position.copy(base.get(organ.name)!); // measure un-exploded
    root.updateWorldMatrix(true, true);
    const all = new THREE.Box3();
    const centres = new Map<string, THREE.Vector3>();
    for (const organ of groups) {
      if (organ.name === 'skin' || organ.name === 'skeleton') continue;
      const box = new THREE.Box3().setFromObject(organ);
      if (box.isEmpty()) continue;
      centres.set(organ.name, box.getCenter(new THREE.Vector3()));
      all.union(box);
      if (!NON_DATA.has(organ.name)) boxes.set(`${sex}:${organ.name}`, box);
    }
    // Exploded view: every organ moves away from the trunk's centre, further the further out it is.
    const middle = all.getCenter(new THREE.Vector3());
    for (const [id, c] of centres) {
      const d = c.clone().sub(middle);
      d.z += 0.04; // favour the viewer's side so organs don't hide behind each other
      const off = d.clone().multiplyScalar(0.9).add(d.clone().normalize().multiplyScalar(0.1));
      off.y = THREE.MathUtils.clamp(off.y, -0.3, 0.3); // keep the head and pelvis organs in frame
      offsets.set(id, off);
    }
  }, [root, groups, base, offsets, sex, x, boxes]);

  // Layers: the pelvis stands for bone marrow, so it shows with either the skeleton or the organs.
  useEffect(() => {
    for (const organ of groups) {
      organ.visible = organ.name === 'skin' ? layers.skin
        : organ.name === 'skeleton' ? layers.skeleton
        : organ.name === 'blood' ? layers.skeleton || layers.organs
        : layers.organs;
    }
  }, [groups, layers]);

  const targets = useMemo(() => new Map([...materials.keys()].map((id) => [id, new THREE.Color()])), [materials]);
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const k = reduced ? 1 : 1 - Math.exp(-8 * Math.min(delta, 0.1)); // colours glide between modes
    const anatomy = colour === 'anatomy';
    for (const [id, material] of materials) {
      const target = targets.get(id)!;
      const focused = id === selected || !!highlight?.has(id);
      const dimmed = !!highlight && !highlight.has(id) && !NON_DATA.has(id); // outside the selected section
      const value = organIds.has(id) ? paint(id, sex) : null;
      let opacity = 1;
      if (id === 'skin') {
        // Data mode tints the skin by skin-cancer figures only while skin is in focus.
        target.set(!anatomy && focused ? value ?? NO_FIGURE : ANATOMY.skin);
        opacity = focused ? Math.max(reveal.skin, 0.45) : reveal.skin;
      } else if (id === 'skeleton') {
        target.set(ANATOMY.skeleton);
      } else if (NON_DATA.has(id)) {
        target.set(anatomy ? ANATOMY[id] ?? '#dcdcdc' : '#dcdcdc');
        opacity = anatomy ? 0.9 : 0.4;
      } else {
        target.set(dimmed ? NO_FIGURE : anatomy ? ANATOMY[id] ?? NO_FIGURE : value ?? NO_FIGURE);
        opacity = dimmed ? 0.15 : !anatomy && value === null ? 0.5 : 1;
      }
      if (material.transparent !== opacity < 1) {
        material.transparent = opacity < 1;
        material.depthWrite = opacity >= 1;
        material.needsUpdate = true; // three only picks up a transparency flip on recompile
      }
      material.opacity = opacity;
      material.color.lerp(target, k);
      const pulse = focused && !NON_DATA.has(id) ? (reduced ? 0.18 : 0.12 + 0.12 * Math.sin(t * 3.4)) : 0;
      material.emissive.setScalar(1);
      material.emissiveIntensity = Math.max(pulse, hovered.current === id ? 0.2 : 0);
    }
  });

  // Cut-away and exploded view ease towards their sliders.
  useFrame((_, delta) => {
    const k = reduced ? 1 : 1 - Math.exp(-7 * Math.min(delta, 0.1));
    const cutGoal = reveal.cut > 0 ? 0.2 - reveal.cut * 0.27 : 0.6; // world z of the cut; 0.6 is in front of the body
    cutNow.current += (cutGoal - cutNow.current) * (cutNow.current > 5 ? 1 : k);
    plane.constant = cutNow.current;
    for (const organ of groups) {
      const off = offsets.get(organ.name);
      if (!off) continue;
      const b = base.get(organ.name)!;
      organ.position.x += (b.x + off.x * reveal.explode - organ.position.x) * k;
      organ.position.y += (b.y + off.y * reveal.explode - organ.position.y) * k;
      organ.position.z += (b.z + off.z * reveal.explode - organ.position.z) * k;
    }
    const box = selected ? boxes.get(`${sex}:${selected}`) : undefined;
    if (calloutRef.current && box && selected) {
      const off = offsets.get(selected);
      const live = groups.find((g) => g.name === selected);
      box.getCenter(calloutRef.current.position);
      if (off && live) calloutRef.current.position.add(live.position).sub(base.get(selected)!);
      calloutRef.current.position.y += (box.max.y - box.min.y) / 2;
    }
  });
  const label = selected && boxes.has(`${sex}:${selected}`) && layers.organs ? callout(selected, sex) : null;

  const organOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    for (let o: THREE.Object3D | null = e.object; o; o = o.parent) if (organIds.has(o.name)) return o.name;
    return null;
  };
  const hover = (e: ThreeEvent<PointerEvent>) => {
    const id = organOf(e);
    if (!id) return;
    e.stopPropagation();
    hovered.current = id;
    document.body.style.cursor = 'pointer';
    onHover({ id, sex, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };
  return (
    <>
      <primitive
        object={root}
        onPointerOver={hover}
        onPointerMove={hover}
        onPointerOut={() => { hovered.current = null; document.body.style.cursor = ''; onHover(null); }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          const id = organOf(e);
          if (!id) return;
          e.stopPropagation();
          if (e.delta < 5) onSelect(id); // a drag to orbit isn't a click
        }}
      />
      <Html position={[x, height + 0.12, 0]} center className="body3d-label" zIndexRange={[4, 0]}>
        {sex === 'Female' ? 'Women' : 'Men'}
      </Html>
      <group ref={calloutRef}>
        {label && (
          <Html center className="body3d-callout" zIndexRange={[5, 0]}>
            <span>{label}</span>
          </Html>
        )}
      </group>
    </>
  );
}

function Camera({ view, reduced, boxes, visible, spin }: { view: View; reduced: boolean; boxes: Boxes; visible: Sex[]; spin: boolean }) {
  const controls = useRef<CameraControls>(null);
  useFrame((_, delta) => {
    if (spin && !reduced) void controls.current?.rotate(Math.min(delta, 0.1) * 0.3, 0, false); // turntable
  });
  // Framing distances suit a landscape stage; pull back on narrow (portrait) canvases.
  const aspect = useThree((s) => s.size.width / s.size.height);
  const pullBack = Math.max(1, 1.25 / aspect);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const smooth = !reduced;
    switch (view.kind) {
      case 'orbit':
        void c.rotate(view.azimuth, view.polar, smooth);
        return;
      case 'zoom':
        void c.dolly(view.by, smooth);
        return;
      case 'organs': {
        // Frame everything selected (an organ or a section) on the visible figures.
        const union = new THREE.Box3();
        for (const sex of visible) for (const id of view.organs) {
          const box = boxes.get(`${sex}:${id}`);
          if (box) union.union(box);
        }
        if (union.isEmpty()) return; // nothing modelled (e.g. stomach): keep the current view
        const target = union.getCenter(new THREE.Vector3());
        const size = union.getSize(new THREE.Vector3());
        const distance = Math.max(view.organs.length > 1 ? 0.95 : 0.6, Math.max(size.x, size.y) * 1.7) * pullBack;
        void c.setLookAt(target.x, target.y + 0.1, target.z + distance, target.x, target.y, target.z, smooth);
        return;
      }
      default: {
        const [x, y, z] = { front: [0, 1.1, 3.6], side: [3.0, 1.1, 2.0], back: [0, 1.1, -3.6] }[view.kind];
        void c.setLookAt(x * pullBack, y, z * pullBack, 0, 0.95, 0, smooth);
      }
    }
  }, [view, reduced, boxes, visible, pullBack]);
  return (
    <CameraControls ref={controls} makeDefault minDistance={0.25} maxDistance={6} smoothTime={0.45}
                    minPolarAngle={0.2} maxPolarAngle={Math.PI - 0.2} />
  );
}

export default function Body3D({ active, organIds, paint, visible, highlight, selected, layers, colour, reveal, spin, callout, onSelect, onHover, onModelled, view, reduced }: {
  active: boolean; // false while the viewer is off-screen: stop rendering
  organIds: string[];
  paint: (id: string, sex: Sex) => string | null;
  visible: Sex[];
  highlight: Set<string> | null; // a body section's organs
  selected: string | null;
  layers: Layers;
  colour: Colour;
  reveal: Reveal;
  spin: boolean;
  callout: (id: string, sex: Sex) => string | null; // text for the label on the selected organ
  onSelect: (id: string) => void;
  onHover: (h: Hover) => void;
  onModelled: (sex: Sex, ids: string[]) => void; // which groups the loaded model really has
  view: View;
  reduced: boolean;
}) {
  const ids = useMemo(() => new Set(organIds), [organIds]);
  const boxes = useMemo<Boxes>(() => new Map(), []);
  return (
    <Canvas
      className="body3d-canvas"
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 2]}
      camera={{ position: [0, 1.4, 6], fov: 32, near: 0.02, far: 40 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
      aria-hidden="true" // the DOM controls and summary around it carry the same information
    >
      <hemisphereLight args={['#ffffff', '#d8d0c8', 1.1]} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2.5]} intensity={0.6} />
      <Suspense fallback={<Html center className="body3d-loading">Loading the anatomy models…</Html>}>
        {visible.map((sex) => (
          <Figure key={sex} sex={sex} x={figureX(sex, visible)} organIds={ids} paint={paint} selected={selected}
                  highlight={highlight} layers={layers} colour={colour} reveal={reveal} callout={callout}
                  reduced={reduced} onSelect={onSelect} onHover={onHover} onModelled={onModelled} boxes={boxes} />
        ))}
        <Camera view={view} reduced={reduced} boxes={boxes} visible={visible} spin={spin} />
      </Suspense>
      <ContactShadows position={[0, 0, 0]} opacity={0.25} scale={4} blur={2.6} far={1.5} />
    </Canvas>
  );
}

SEXES.forEach((sex) => useGLTF.preload(url(sex)));
