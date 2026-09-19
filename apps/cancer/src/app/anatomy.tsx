// Body map: 3D female and male bodies (Human Reference Atlas) with organs shaded by that sex's
// cancer data. Select a body section or an organ, in the scene or from the lists, and show
// either or both sexes.
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { callTool } from './mcp';
import type { Colour, Hover, Layers, Reveal, Sex, View } from './body3d';
import { ANATOMY, HEAT } from './colours';
import { Verified, type Validity } from './validity';

const Body3D = lazy(() => import('./body3d')); // three.js loads only with the body map

type Metric = 'deaths' | 'cases' | 'per100';
type Show = 'both' | Sex;
type Selection = { kind: 'organ' | 'section'; id: string };
type Death = { cause_code: string; deaths: number };
type Estimate = { measure: string; cancer_code: string; count: number };
type Survival = { age: string; population: string; site: string; pct: number };
type SexData = { deaths: Map<string, number>; estimates: Estimate[] };
type Data = { Female: SexData; Male: SexData; survival: Survival[] };

type Organ = {
  id: string;
  name: string;
  psa: string[]; // PSA Mortality Tabulation List 1 codes
  gco: number[]; // GLOBOCAN site codes
  survival?: string; // site in the adult survival study
  sexes: Sex[]; // bodies it belongs to
  note?: string;
};

const SEXES: Sex[] = ['Female', 'Male'];
const LABEL: Record<Sex, string> = { Female: 'Women', Male: 'Men' };

const ORGANS: Organ[] = [
  { id: 'brain', name: 'Brain & nervous system', psa: ['1-042'], gco: [31], sexes: SEXES },
  { id: 'oral', name: 'Mouth & throat', psa: ['1-027'], gco: [1, 2, 3, 4, 5], sexes: SEXES,
    note: 'Lip, oral cavity, salivary glands and pharynx' },
  { id: 'larynx', name: 'Larynx', psa: ['1-033'], gco: [14], sexes: SEXES },
  { id: 'thyroid', name: 'Thyroid', psa: [], gco: [32], survival: 'Thyroid', sexes: SEXES,
    note: 'PSA counts thyroid deaths within “other malignant sites”' },
  { id: 'oesophagus', name: 'Oesophagus', psa: ['1-028'], gco: [6], sexes: SEXES },
  { id: 'lung', name: 'Lung', psa: ['1-034'], gco: [15], survival: 'Lung', sexes: SEXES, note: 'Trachea, bronchus and lung' },
  { id: 'breast', name: 'Breast', psa: ['1-036'], gco: [20], survival: 'Breast', sexes: ['Female'],
    note: 'Men get breast cancer too, but rarely; their registered deaths are in the table' },
  { id: 'liver', name: 'Liver', psa: ['1-031'], gco: [11], survival: 'Liver', sexes: SEXES, note: 'Liver and intrahepatic bile ducts' },
  { id: 'stomach', name: 'Stomach', psa: ['1-029'], gco: [7], survival: 'Stomach', sexes: SEXES },
  { id: 'pancreas', name: 'Pancreas', psa: ['1-032'], gco: [13], sexes: SEXES },
  { id: 'kidney', name: 'Kidney', psa: [], gco: [29], sexes: SEXES, note: 'PSA counts kidney deaths within “other malignant sites”' },
  { id: 'colorectum', name: 'Colon & rectum', psa: ['1-030'], gco: [8, 9, 10], survival: 'Colorectal', sexes: SEXES,
    note: 'Colon, rectum and anus' },
  { id: 'bladder', name: 'Bladder', psa: ['1-041'], gco: [30], sexes: SEXES },
  { id: 'uterus', name: 'Uterus', psa: ['1-038'], gco: [24], sexes: ['Female'],
    note: 'GLOBOCAN: corpus uteri; PSA: other and unspecified parts of the uterus' },
  { id: 'ovary', name: 'Ovary', psa: ['1-039'], gco: [25], survival: 'Ovary', sexes: ['Female'] },
  { id: 'cervix', name: 'Cervix', psa: ['1-037'], gco: [23], survival: 'Cervix', sexes: ['Female'] },
  { id: 'prostate', name: 'Prostate', psa: ['1-040'], gco: [27], sexes: ['Male'] },
  { id: 'testis', name: 'Testis', psa: [], gco: [28], sexes: ['Male'],
    note: 'PSA counts testicular deaths within “other malignant sites”' },
  { id: 'penis', name: 'Penis', psa: [], gco: [26], sexes: ['Male'],
    note: 'PSA counts penile cancer deaths within “other malignant sites”' },
  { id: 'vagina', name: 'Vagina', psa: [], gco: [22], sexes: ['Female'],
    note: 'PSA counts vaginal cancer deaths within “other malignant sites”' },
  { id: 'blood', name: 'Blood & bone marrow', psa: ['1-044', '1-045'], gco: [35, 36], survival: 'Leukaemia', sexes: SEXES,
    note: 'Leukaemia and multiple myeloma, shown on the pelvis, a main bone-marrow site; survival is for leukaemia' },
  { id: 'lymph', name: 'Lymph nodes', psa: ['1-043'], gco: [33, 34], sexes: SEXES,
    note: 'Lymphomas, shown on one lymph node drawn 2.5× life size. PSA counts non-Hodgkin lymphoma only' },
  { id: 'skin', name: 'Skin', psa: ['1-035'], gco: [16, 17], sexes: SEXES,
    note: 'PSA: melanoma; GLOBOCAN: melanoma and other skin cancers. Select it to shade the whole skin' },
];

// Body sections: groups of organs, each counted in exactly one section.
const SECTIONS: { id: string; name: string; organs: string[] }[] = [
  { id: 'head-neck', name: 'Head & neck', organs: ['brain', 'oral', 'larynx', 'thyroid'] },
  { id: 'chest', name: 'Chest', organs: ['lung', 'breast', 'oesophagus'] },
  { id: 'abdomen', name: 'Abdomen', organs: ['liver', 'stomach', 'pancreas', 'kidney', 'colorectum'] },
  { id: 'pelvis', name: 'Pelvis & reproductive', organs: ['bladder', 'uterus', 'cervix', 'ovary', 'vagina', 'prostate', 'testis', 'penis'] },
  { id: 'systemic', name: 'Blood, lymph & skin', organs: ['blood', 'lymph', 'skin'] },
];

const METRICS: { id: Metric; label: string; bins: number[]; binLabels: string[] }[] = [
  { id: 'deaths', label: 'Registered deaths', bins: [250, 1000, 2500, 5000],
    binLabels: ['Under 250', '250–999', '1,000–2,499', '2,500–4,999', '5,000 or more'] },
  { id: 'cases', label: 'Estimated new cases', bins: [500, 2000, 5000, 10000],
    binLabels: ['Under 500', '500–1,999', '2,000–4,999', '5,000–9,999', '10,000 or more'] },
  { id: 'per100', label: 'Deaths per 100 new cases', bins: [20, 40, 60, 80],
    binLabels: ['Under 20', '20–39', '40–59', '60–79', '80 or more'] },
];
const STEPS = HEAT; // data mode: one warm hue, light to dark (validated; see colours.ts)

// Lucide-style icons: 24×24, ~1.65 stroke, round caps (the design system's icon geometry).
const ICONS: Record<string, string[]> = {
  left: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  right: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  in: ['M5 12h14', 'M12 5v14'],
  out: ['M5 12h14'],
  home: ['M3 11 12 4l9 7', 'M5 10v10h14V10'],
  sliders: ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
};
const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name].map((d) => <path key={d} d={d} />)}
  </svg>
);
const LAYER_LABEL = { skin: 'Skin', skeleton: 'Skeleton', organs: 'Organs' } as const;
const SHORT_METRIC: Record<Metric, string> = { deaths: 'Deaths', cases: 'New cases', per100: 'Deaths / 100 cases' };

// Hotkeys work while focus is inside the body map (WCAG 2.1.4: no page-wide single-key shortcuts).
const SHORTCUTS: [string[], string][] = [
  [['P'], 'Open or close the options'],
  [['1', '2', '3'], 'Show both, women, men'],
  [['S', 'K', 'O'], 'Skin, skeleton, organs layer on/off'],
  [['C'], 'Switch data / anatomy colours'],
  [['X'], 'Cut away the front (skin and bones)'],
  [['E'], 'Exploded view'],
  [['R'], 'Auto-rotate'],
  [['D'], 'Dark or light stage'],
  [['W'], 'Full screen'],
  [['M'], 'Next measure to shade by'],
  [['F', 'V', 'B'], 'Front, side, back view'],
  [['←', '→', '↑', '↓'], 'Rotate (with the 3D view focused)'],
  [['+', '−'], 'Zoom in, out'],
  [['Home', '0'], 'Reset the view'],
  [[']', '['], 'Next, previous organ'],
  [['}', '{'], 'Next, previous body section'],
  [['?'], 'This list'],
  [['Esc'], 'Close the options or this list'],
];

const OptionGroup = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="option-group" role="group" aria-label={label}>
    <span className="option-label" aria-hidden="true">{label}</span>
    <div className="option-buttons">{children}</div>
  </div>
);
const Key = ({ k }: { k: string }) => <kbd className="key" aria-hidden="true">{k}</kbd>;


const int = new Intl.NumberFormat('en-PH');
const pct = new Intl.NumberFormat('en-PH', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hasWebGL = () => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
};

async function load(): Promise<Data> {
  const one = async (sex: Sex): Promise<SexData> => {
    const [deaths, est] = await Promise.all([
      callTool<{ rows: Death[] }>('registered_cancer_deaths', { year: 2024, region: 'PH', sex }),
      callTool<{ rows: Estimate[] }>('cancer_estimates', { sex }),
    ]);
    return { deaths: new Map(deaths.rows.map((r) => [r.cause_code, r.deaths])), estimates: est.rows };
  };
  const [Female, Male, survival] = await Promise.all([
    one('Female'), one('Male'), callTool<{ rows: Survival[] }>('cancer_survival', { age: 'adults' }),
  ]);
  return { Female, Male, survival: survival.rows };
}

/** Figures for a set of codes (one organ, or a section's organs) for one sex; null where there's none. */
function figures(codes: { psa: string[]; gco: number[] }, d: SexData) {
  const deaths = codes.psa.length ? codes.psa.reduce((n, c) => n + (d.deaths.get(c) ?? 0), 0) : null;
  const est = (measure: string, sites: number[]) => {
    const rows = d.estimates.filter((e) => e.measure === measure && sites.includes(Number(e.cancer_code)));
    return rows.length ? rows.reduce((n, e) => n + e.count, 0) : null;
  };
  const cases = est('incidence', codes.gco);
  const estDeaths = est('mortality', codes.gco);
  return {
    deaths, cases,
    per100: cases && estDeaths !== null ? (estDeaths / cases) * 100 : null,
    deathShare: deaths !== null ? deaths / (d.deaths.get('1-026') ?? 1) : null,
    caseShare: cases !== null ? cases / (est('incidence', [39]) ?? 1) : null,
  };
}

export function Anatomy({ validity }: { validity: Validity | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('deaths');
  const [show, setShow] = useState<Show>('both');
  const [selection, setSelection] = useState<Selection>({ kind: 'organ', id: 'lung' });
  const [view, setView] = useState<View>({ kind: 'front', n: 0 });
  const [layers, setLayers] = useState<Layers>({ skin: true, skeleton: false, organs: true });
  const [colour, setColour] = useState<Colour>('data');
  const [hover, setHover] = useState<Hover>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reveal, setReveal] = useState<Reveal>({ skin: 0.18, cut: 0, explode: 0 });
  const [spin, setSpin] = useState(false);
  const [dark, setDark] = useState(false);
  const [modelled, setModelled] = useState<Record<Sex, string[]> | null>(null);
  const card = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [hint, setHint] = useState(true); // "drag to rotate", until the viewer is first used
  const onModelled = useCallback((sex: Sex, ids: string[]) => setModelled((m) => ({ ...(m ?? { Female: [], Male: [] }), [sex]: ids })), []);
  const [announcement, setAnnouncement] = useState('');
  const help = useRef<HTMLDialogElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const webgl = useMemo(hasWebGL, []);
  const uid = useId().replace(/:/g, '');

  useEffect(() => {
    load().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  // Stop the 3D render loop while the viewer is scrolled out of view.
  useEffect(() => {
    if (!stage.current || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '200px' });
    io.observe(stage.current);
    return () => io.disconnect();
  }, [data]);

  const visible = useMemo<Sex[]>(() => (show === 'both' ? SEXES : [show]), [show]);
  const spec = METRICS.find((m) => m.id === metric)!;
  const byId = useMemo(() => new Map(ORGANS.map((o) => [o.id, o])), []);
  const value = useCallback((organ: Organ, sex: Sex) => (data ? figures(organ, data[sex])[metric] : null), [data, metric]);
  const paint = useCallback((id: string, sex: Sex) => {
    const organ = byId.get(id);
    const v = organ && organ.sexes.includes(sex) ? value(organ, sex) : null;
    if (v === null) return null;
    const bin = spec.bins.findIndex((t) => v < t);
    return STEPS[bin === -1 ? STEPS.length - 1 : bin];
  }, [byId, value, spec]);
  const section = selection.kind === 'section' ? SECTIONS.find((s) => s.id === selection.id)! : null;
  const selectOrgan = useCallback((id: string) => {
    setSelection({ kind: 'organ', id });
    setView((v) => ({ kind: 'organs', organs: [id], n: v.n + 1 }));
  }, []);
  const selectSection = (id: string) => {
    setSelection({ kind: 'section', id });
    setView((v) => ({ kind: 'organs', organs: SECTIONS.find((s) => s.id === id)!.organs, n: v.n + 1 }));
  };
  const go = (kind: 'front' | 'side' | 'back') => setView((v) => ({ kind, n: v.n + 1 }));
  const orbit = (azimuth: number, polar: number) => setView((v) => ({ kind: 'orbit', azimuth, polar, n: v.n + 1 }));
  const zoom = (by: number) => setView((v) => ({ kind: 'zoom', by, n: v.n + 1 }));
  // Arrow keys orbit only while the 3D view itself is focused (elsewhere they scroll or move focus).
  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => orbit(0.35, 0), ArrowRight: () => orbit(-0.35, 0),
      ArrowUp: () => orbit(0, -0.2), ArrowDown: () => orbit(0, 0.2),
    };
    if (e.target !== e.currentTarget || !keys[e.key]) return;
    e.preventDefault();
    keys[e.key]();
  };
  const say = setAnnouncement; // read out by the live region at the end of the card
  const closePanel = () => {
    setPanelOpen(false);
    optionsButton.current?.focus(); // don't strand focus in a panel that's gone
  };
  const toggleLayer = (l: keyof Layers) => {
    setLayers({ ...layers, [l]: !layers[l] });
    say(`${LAYER_LABEL[l]} layer ${layers[l] ? 'off' : 'on'}`);
  };
  const showOnly = (s: Show) => { setShow(s); say(s === 'both' ? 'Showing women and men' : `Showing ${LABEL[s].toLowerCase()} only`); };
  const setColourMode = (c: Colour) => { setColour(c); say(c === 'data' ? 'Data colours' : 'Anatomy colours'); };
  const setMeasure = (m: Metric) => { setMetric(m); say(`Shading by ${METRICS.find((x) => x.id === m)!.label.toLowerCase()}`); };
  const view3d = (kind: 'front' | 'side' | 'back') => { go(kind); say(`${kind[0].toUpperCase()}${kind.slice(1)} view`); };
  const step = (list: { id: string; name: string }[], kind: Selection['kind'], by: number) => {
    const at = selection.kind === kind ? list.findIndex((x) => x.id === selection.id) : by > 0 ? -1 : 0;
    const next = list[(at + by + list.length) % list.length];
    if (kind === 'organ') selectOrgan(next.id);
    else selectSection(next.id);
    say(`${next.name} selected`);
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void card.current?.requestFullscreen?.();
  };
  const onCardKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || help.current?.open) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    const keys: Record<string, () => void> = {
      p: () => { if (panelOpen) closePanel(); else setPanelOpen(true); say(panelOpen ? 'Options closed' : 'Options open'); },
      '1': () => showOnly('both'), '2': () => showOnly('Female'), '3': () => showOnly('Male'),
      s: () => toggleLayer('skin'), k: () => toggleLayer('skeleton'), o: () => toggleLayer('organs'),
      c: () => setColourMode(colour === 'data' ? 'anatomy' : 'data'),
      x: () => { setReveal({ ...reveal, cut: reveal.cut ? 0 : 0.55 }); say(reveal.cut ? 'Cut-away off' : 'Front cut away'); },
      e: () => { setReveal({ ...reveal, explode: reveal.explode ? 0 : 0.6 }); say(reveal.explode ? 'Exploded view off' : 'Exploded view'); },
      r: () => { setSpin(!spin); say(spin ? 'Auto-rotate off' : 'Auto-rotate on'); },
      d: () => { setDark(!dark); say(dark ? 'Light stage' : 'Dark stage'); },
      w: fullscreen,
      m: () => setMeasure(METRICS[(METRICS.findIndex((x) => x.id === metric) + 1) % METRICS.length].id),
      f: () => view3d('front'), v: () => view3d('side'), b: () => view3d('back'),
      home: () => view3d('front'), '0': () => view3d('front'),
      '+': () => zoom(0.4), '=': () => zoom(0.4), '-': () => zoom(-0.4),
      ']': () => step(ORGANS, 'organ', 1), '[': () => step(ORGANS, 'organ', -1),
      '}': () => step(SECTIONS, 'section', 1), '{': () => step(SECTIONS, 'section', -1),
      '?': () => help.current?.showModal(),
      escape: () => { if (panelOpen) { closePanel(); say('Options closed'); } },
    };
    const act = keys[e.key.toLowerCase()];
    if (!act) return;
    e.preventDefault();
    act();
  };
  const organIds = useMemo(() => ORGANS.map((o) => o.id), []);
  // Organs in the lists that the loaded 3D models don't include (known once the models load).
  const NOT_MODELLED = useMemo(() => new Set(modelled
    ? ORGANS.filter((o) => !o.sexes.some((sex) => modelled[sex].includes(o.id))).map((o) => o.id) : []), [modelled]);
  const highlight = useMemo(() => (section ? new Set(section.organs) : null), [section]);

  if (error) return <p className="card error" role="alert">Couldn’t load the body map: {error}</p>;
  if (!data) return <p className="caption" aria-live="polite">Loading the body map…</p>;

  const shown = (v: number | null) =>
    v === null ? 'no figure' : metric === 'per100' ? `${Math.round(v)} per 100 new cases` : int.format(v);
  const organ = selection.kind === 'organ' ? byId.get(selection.id)! : null;
  const callout = (id: string, sex: Sex) => {
    const o = byId.get(id);
    return o && o.sexes.includes(sex) ? `${o.name} · ${shown(value(o, sex))}` : null;
  };
  // Breast belongs to the female body, but PSA also registers male breast cancer deaths.
  const applies = (o: Organ, sex: Sex) => o.sexes.includes(sex) || o.id === 'breast';
  const members = section
    ? section.organs.map((id) => byId.get(id)!).filter((o) => visible.some((sex) => applies(o, sex)))
    : [];
  const codes = organ ?? { psa: members.flatMap((o) => o.psa), gco: members.flatMap((o) => o.gco) };
  const stats = visible.map((sex) => (!organ || applies(organ, sex) ? figures(codes, data[sex]) : null));
  const survival = organ?.survival
    ? data.survival.find((r) => r.site === organ.survival && r.population === 'Philippine residents')?.pct
    : undefined;
  const cell = (key: number, main: string | null, sub: string | null) =>
    main === null
      ? <td key={key} className="muted">—</td>
      : <td key={key}><strong>{main}</strong>{sub && <span className="caption">{sub}</span>}</td>;
  const hovered = hover && byId.get(hover.id);
  // A plain-language account of what the 3D view shows, for screen readers and everyone else.
  const onLayers = (['skin', 'skeleton', 'organs'] as const).filter((l) => layers[l]).map((l) => LAYER_LABEL[l].toLowerCase());
  const highest = (sex: Sex) => ORGANS
    .filter((o) => o.sexes.includes(sex) && !NOT_MODELLED.has(o.id))
    .map((o) => ({ o, v: value(o, sex) }))
    .filter((x): x is { o: Organ; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v).slice(0, 3)
    .map(({ o, v }) => `${o.name.toLowerCase()} ${shown(v)}`);
  const summary = `Showing ${list(visible.map((s) => LABEL[s].toLowerCase()))}: ${onLayers.length ? list(onLayers) : 'no layers'}, ` +
    `${colour === 'anatomy' ? 'in natural anatomy colours' : `organs shaded by ${spec.label.toLowerCase()}`}. ` +
    `Highest ${spec.label.toLowerCase()}: ${visible.map((s) => `${LABEL[s].toLowerCase()}, ${list(highest(s))}`).join('; ')}. ` +
    `Selected: ${organ?.name ?? section!.name}.`;
  // Section breakdown: its organs ranked by the chosen measure (first visible sex that has a figure).
  const ranked = members
    .map((o) => ({ o, v: visible.map((sex) => (applies(o, sex) ? value(o, sex) : null)) }))
    .sort((a, b) => Math.max(...b.v.map((x) => x ?? -1)) - Math.max(...a.v.map((x) => x ?? -1)));

  return (
    <section ref={card} className="card anatomy" aria-labelledby="anatomy-heading" data-reveal onKeyDown={onCardKey}
             aria-describedby={`${uid}-keys-hint`}>
      <div className="anatomy-head">
        <div>
          <h2 id="anatomy-heading" className="card-heading">Where cancer strikes</h2>
          <p className="caption">
            Real anatomy, organs shaded by each sex’s own figures. Drag to rotate, scroll or pinch to zoom, right-drag
            to pan; the options are in the viewer. Pick a body section or an organ to see its numbers.
          </p>
          <p id={`${uid}-keys-hint`} className="caption">
            Keyboard: press <Key k="?" /> inside the body map for shortcuts.{' '}
            <button type="button" className="link-button" onClick={() => help.current?.showModal()}>Show shortcuts</button>
          </p>
        </div>
      </div>

      <div className="anatomy-body">
        <div className="anatomy-stage-wrap">
        <div ref={stage} className={dark ? 'anatomy-stage dark' : 'anatomy-stage'}>
          <div className="stage-canvas" tabIndex={0} role="application" aria-roledescription="3D viewer"
               aria-label="3D body map. Arrow keys rotate, plus and minus zoom, Home resets the view. Select sections and organs with the buttons below the viewer."
               aria-describedby={`${uid}-summary`} onKeyDown={(e) => { setHint(false); onStageKey(e); }}
               onPointerDown={() => setHint(false)}>
            {webgl ? (
              <Suspense fallback={<p className="caption body3d-loading">Loading 3D…</p>}>
                <Body3D active={onScreen} organIds={organIds} paint={paint} visible={visible} highlight={highlight} layers={layers}
                        colour={colour} reveal={reveal} spin={spin} callout={callout} selected={organ?.id ?? null}
                        onSelect={selectOrgan} onHover={setHover} onModelled={onModelled} view={view} reduced={reduced} />
              </Suspense>
            ) : (
              <p className="caption body3d-loading">This browser can’t show 3D (WebGL is off). Use the lists below.</p>
            )}
          </div>

          <button ref={optionsButton} type="button" className="viewer-btn viewer-options" aria-expanded={panelOpen}
                  aria-controls={`${uid}-panel`} aria-keyshortcuts="P" onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}>
            <Icon name="sliders" /> Options <Key k="P" />
          </button>

          {panelOpen && (
            <div id={`${uid}-panel`} className="viewer-panel" role="region" aria-label="Viewer options">
              <div className="viewer-panel-head">
                <strong>Options</strong>
                <button type="button" className="viewer-btn icon" aria-label="Close options" onClick={closePanel}><Icon name="close" /></button>
              </div>
              <OptionGroup label="Show">
                {(['both', 'Female', 'Male'] as Show[]).map((s, i) => (
                  <button key={s} type="button" className="viewer-btn" aria-pressed={show === s} aria-keyshortcuts={String(i + 1)}
                          onClick={() => showOnly(s)}>
                    {s === 'both' ? 'Both' : LABEL[s]} <Key k={String(i + 1)} />
                  </button>
                ))}
              </OptionGroup>
              <OptionGroup label="Layers">
                {(['skin', 'skeleton', 'organs'] as const).map((l) => (
                  <button key={l} type="button" className="viewer-btn" aria-pressed={layers[l]} aria-label={`${LAYER_LABEL[l]} layer`}
                          aria-keyshortcuts={{ skin: 'S', skeleton: 'K', organs: 'O' }[l]} onClick={() => toggleLayer(l)}>
                    {LAYER_LABEL[l]} <Key k={{ skin: 'S', skeleton: 'K', organs: 'O' }[l]} />
                  </button>
                ))}
              </OptionGroup>
              <OptionGroup label="Colour">
                {(['data', 'anatomy'] as Colour[]).map((c) => (
                  <button key={c} type="button" className="viewer-btn" aria-pressed={colour === c} aria-keyshortcuts="C"
                          onClick={() => setColourMode(c)}>
                    {c === 'data' ? 'Data' : 'Anatomy'}
                  </button>
                ))}
              </OptionGroup>
              <OptionGroup label="Shade by">
                {METRICS.map((m) => (
                  <button key={m.id} type="button" className="viewer-btn" aria-pressed={metric === m.id} aria-keyshortcuts="M"
                          onClick={() => setMeasure(m.id)}>
                    {SHORT_METRIC[m.id]}
                  </button>
                ))}
              </OptionGroup>
              <OptionGroup label="View">
                {(['front', 'side', 'back'] as const).map((k) => (
                  <button key={k} type="button" className="viewer-btn" aria-keyshortcuts={{ front: 'F', side: 'V', back: 'B' }[k]}
                          onClick={() => view3d(k)}>
                    {k[0].toUpperCase() + k.slice(1)} <Key k={{ front: 'F', side: 'V', back: 'B' }[k]} />
                  </button>
                ))}
              </OptionGroup>
              <OptionGroup label="Reveal">
                {([['skin', 'Skin opacity', 1], ['cut', 'Cut away front', 1], ['explode', 'Explode', 1]] as const).map(([k, l, max]) => (
                  <label key={k} className="slider">
                    <span>{l}</span>
                    <input type="range" min={0} max={max} step={0.01} value={reveal[k]}
                           aria-valuetext={`${Math.round(reveal[k] * 100)}%`}
                           onChange={(e) => setReveal({ ...reveal, [k]: Number(e.target.value) })} />
                  </label>
                ))}
              </OptionGroup>
              <OptionGroup label="Stage">
                <button type="button" className="viewer-btn" aria-pressed={spin} aria-keyshortcuts="R" disabled={reduced}
                        title={reduced ? 'Off because your system asks for reduced motion' : undefined}
                        onClick={() => setSpin(!spin)}>Auto-rotate <Key k="R" /></button>
                <button type="button" className="viewer-btn" aria-pressed={dark} aria-keyshortcuts="D" onClick={() => setDark(!dark)}>
                  Dark <Key k="D" />
                </button>
                <button type="button" className="viewer-btn" aria-keyshortcuts="W" onClick={fullscreen}>Full screen <Key k="W" /></button>
              </OptionGroup>
              <button type="button" className="link-button" onClick={() => help.current?.showModal()}>Keyboard shortcuts</button>
            </div>
          )}

          {hint && webgl && <p className="viewer-hint" aria-hidden="true">Drag to rotate · scroll to zoom · <Key k="?" /> for shortcuts</p>}
          {colour === 'data' && (
            <div className="viewer-legend" aria-hidden="true">
              <span>{spec.label}</span>
              <div>{STEPS.map((c) => <i key={c} style={{ background: c }} />)}</div>
              <span className="ends"><em>{spec.binLabels[0]}</em><em>{spec.binLabels[STEPS.length - 1]}</em></span>
            </div>
          )}

          <div className="viewer-camera" role="group" aria-label="Camera">
            <button type="button" className="viewer-btn icon" aria-label="Rotate left" onClick={() => orbit(0.35, 0)}><Icon name="left" /></button>
            <button type="button" className="viewer-btn icon" aria-label="Rotate right" onClick={() => orbit(-0.35, 0)}><Icon name="right" /></button>
            <button type="button" className="viewer-btn icon" aria-label="Zoom in" aria-keyshortcuts="+" onClick={() => zoom(0.4)}><Icon name="in" /></button>
            <button type="button" className="viewer-btn icon" aria-label="Zoom out" aria-keyshortcuts="-" onClick={() => zoom(-0.4)}><Icon name="out" /></button>
            <button type="button" className="viewer-btn icon" aria-label="Reset view" aria-keyshortcuts="Home" onClick={() => view3d('front')}><Icon name="home" /></button>
          </div>
          {!layers.skin && !layers.skeleton && !layers.organs && (
            <p className="caption body3d-loading">All layers are off. Open Options (P) to switch on skin, skeleton or organs.</p>
          )}
        </div>
        <p id={`${uid}-summary`} className="caption stage-summary" aria-live="polite">{summary}</p>
        </div>

        <div className="anatomy-panel" key={`${selection.kind}-${selection.id}`} aria-live="polite">
          <p className="caption panel-kicker">{section ? 'Body section' : 'Organ'}</p>
          <h3 className="card-heading">{organ?.name ?? section!.name}</h3>
          {organ && (organ.note || NOT_MODELLED.has(organ.id)) && (
            <p className="caption">
              {organ.note && `${organ.note}. `}
              {NOT_MODELLED.has(organ.id) && 'Not drawn: the 3D models don’t include it.'}
            </p>
          )}
          {section && <p className="caption">Totals for {list(members.map((o) => o.name.toLowerCase()))}.</p>}
          {organ && !visible.some((sex) => applies(organ, sex)) && (
            <p className="caption">
              Only in the {LABEL[organ.sexes[0]].toLowerCase()}’s figures.{' '}
              <button type="button" className="link-button" onClick={() => setShow(organ.sexes[0])}>
                Show {LABEL[organ.sexes[0]].toLowerCase()}
              </button>
            </p>
          )}
          <table className="panel-table">
            <thead>
              <tr><td />{visible.map((sex) => <th key={sex} scope="col">{LABEL[sex]}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Registered deaths, 2024</th>
                {stats.map((s, i) => cell(i, s?.deaths != null ? int.format(s.deaths) : null,
                  s?.deathShare != null ? `${pct.format(s.deathShare)} of cancer deaths` : null))}
              </tr>
              <tr>
                <th scope="row">Estimated new cases, 2024</th>
                {stats.map((s, i) => cell(i, s?.cases != null ? int.format(s.cases) : null,
                  s?.caseShare != null ? `${pct.format(s.caseShare)} of new cases` : null))}
              </tr>
              <tr>
                <th scope="row">Estimated deaths per 100 new cases</th>
                {stats.map((s, i) => cell(i, s?.per100 != null ? String(Math.round(s.per100)) : null,
                  s?.per100 != null ? 'rough outcome proxy' : null))}
              </tr>
              {organ && (
                <tr>
                  <th scope="row">5-year survival, Metro Manila 1998–2002</th>
                  {survival != null
                    ? <td colSpan={visible.length}><strong>{survival}%</strong><span className="caption">adults, both sexes</span></td>
                    : <td colSpan={visible.length} className="muted">No published figure</td>}
                </tr>
              )}
            </tbody>
          </table>

          {section && (
            <table className="panel-table section-breakdown">
              <caption className="caption">In this section, {spec.label.toLowerCase()}</caption>
              <thead>
                <tr><th scope="col">Organ</th>{visible.map((sex) => <th key={sex} scope="col">{LABEL[sex]}</th>)}</tr>
              </thead>
              <tbody>
                {ranked.map(({ o, v }) => (
                  <tr key={o.id}>
                    <th scope="row">
                      <button type="button" className="link-button" onClick={() => selectOrgan(o.id)}>{o.name}</button>
                    </th>
                    {v.map((x, i) => <td key={i}>{applies(o, visible[i]) ? shown(x) : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="caption">
            Registered deaths: PSA. New cases and deaths per 100: GLOBOCAN 2024 estimates. Survival: Redaniel 2009.
            {section && ' Organs PSA folds into “other malignant sites” (thyroid, kidney, testis) aren’t in the death totals.'}
          </p>
          <Verified v={validity} ids={organ?.survival ? ['psa-table12', 'globocan', 'survival'] : ['psa-table12', 'globocan']} />
        </div>
      </div>

      <div className="section-list" role="group" aria-label="Body sections and organs">
        {SECTIONS.map((s) => (
          <div className="section-row" key={s.id}>
            <button type="button" className="section-chip" aria-pressed={selection.kind === 'section' && selection.id === s.id}
                    onClick={() => selectSection(s.id)}>
              {s.name}
            </button>
            <div className="organ-chips">
              {s.organs.map((id) => byId.get(id)!).map((o) => (
                <button key={o.id} type="button" className="organ-chip"
                        aria-pressed={selection.kind === 'organ' && selection.id === o.id} onClick={() => selectOrgan(o.id)}>
                  {o.name}{NOT_MODELLED.has(o.id) && <span className="visually-hidden"> (not drawn)</span>}
                  {NOT_MODELLED.has(o.id) && <span aria-hidden="true"> ·</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="anatomy-legend" aria-label={colour === 'data' ? `Legend, ${spec.label.toLowerCase()}` : 'Legend, anatomy colours'}>
        {colour === 'data' ? (
          <>
            {spec.binLabels.map((l, i) => <span key={l}><i style={{ background: STEPS[i] }} />{l}</span>)}
            <span><i className="faint" />Faint: no figure for this measure</span>
          </>
        ) : (
          <>
            {([['Skin', 'skin'], ['Bone', 'skeleton'], ['Lung', 'lung'], ['Liver', 'liver'], ['Lymph node', 'lymph']] as const)
              .map(([l, id]) => <span key={id}><i style={{ background: ANATOMY[id] }} />{l}</span>)}
            <span>Natural colours are approximate and carry no data. Switch to data colours to shade by the figures.</span>
          </>
        )}
        <span>· not drawn in 3D</span>
      </div>

      <details className="bars-table">
        <summary className="caption">Show table</summary>
        <table>
          <caption className="caption">{spec.label} by organ</caption>
          <thead><tr><th scope="col">Organ</th>{visible.map((sex) => <th key={sex} scope="col">{LABEL[sex]}</th>)}</tr></thead>
          <tbody>
            {ORGANS.map((o) => (
              <tr key={o.id}>
                <th scope="row">{o.name}</th>
                {visible.map((sex) => <td key={sex}>{o.sexes.includes(sex) ? shown(value(o, sex)) : '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="caption">
        3D anatomy: HuBMAP Human Reference Atlas, 3D Reference Organ Sets v1.10 (Browne &amp; Schlehlein, 2026; CC BY 4.0),
        completed with bones and organs adapted from BodyParts3D (© The Database Center for Life Science, CC BY-SA 2.1 JP)
        and a thyroid from Z-Anatomy (CC BY-SA 4.0). The added parts come from one male body, scaled to fit each figure.
        The combined models are shared under CC BY-SA.
      </p>

      <dialog ref={help} className="shortcuts" aria-labelledby={`${uid}-keys-title`}>
        <h3 id={`${uid}-keys-title`} className="card-heading">Keyboard shortcuts</h3>
        <p className="caption">They work while focus is anywhere in the body map, and never while typing.</p>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what}>
              <dt>{keys.map((k) => <kbd key={k} className="key">{k}</kbd>)}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog"><button className="viewer-btn">Close</button></form>
      </dialog>
      <p className="visually-hidden" aria-live="polite">{announcement}</p>

      {hover && hovered && (
        <div className="tooltip" role="presentation" style={{ left: hover.x, top: hover.y - 12 }}>
          <strong>{shown(value(hovered, hover.sex))}</strong>
          <span>{hovered.name} · {LABEL[hover.sex].toLowerCase()}</span>
        </div>
      )}
    </section>
  );
}

function list(items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
