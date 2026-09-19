// Colours for the 3D body map, shared by the scene and its legend (kept apart from body3d.tsx so
// the legend doesn't pull three.js into the main bundle).

// Data mode: one warm hue, light to dark (validated with the dataviz skill's ordinal checks:
// monotone lightness, visible step gaps, lightest step clears the white stage).
export const HEAT = ['#f2a47a', '#e27850', '#c84c30', '#9c2c1d', '#5e1810'];

// Anatomy mode: natural colours (approximate, for orientation; not data).
export const ANATOMY: Record<string, string> = {
  skin: '#d9a383', skeleton: '#eadfc8', brain: '#e3a7a6', oral: '#cf6f6f', larynx: '#e6dac4', lung: '#d98c8a',
  breast: '#efc39f', liver: '#7e3326', pancreas: '#e2b872', kidney: '#93392f', colorectum: '#c98a64',
  bladder: '#dca394', uterus: '#bf6670', cervix: '#b25863', ovary: '#e4b9a2', prostate: '#a95b55',
  blood: '#eadfc8' /* the pelvis: bone */, lymph: '#9fb06a', context: '#a33c36', heart: '#a33c36', intestine: '#d99d7f',
  stomach: '#d98f7f', oesophagus: '#c9837a', thyroid: '#b5524a', testis: '#e6c9b0', penis: '#d79a86', vagina: '#c9717b',
  spleen: '#6e2f3a', gallbladder: '#6f8f3f', trachea: '#e8ddd0', fallopian: '#dba3a0', seminal: '#d9b48f',
};
