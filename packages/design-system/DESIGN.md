---
name: Akashi Design System
description: A reusable monochrome design language for websites and product interfaces, with expressive typography, tactile surfaces, and restrained motion.
colors:
  paper: "#fafafa"
  surface: "#ffffff"
  ink: "#191919"
  muted: "#6d6d6d"
  line: "#dedede"
  lead: "#4c4c4c"
  secondaryHeading: "#666666"
  mentionSurface: "#ededed"
  mentionText: "#141414"
typography:
  display:
    fontFamily: "'Zen Kaku Gothic New', sans-serif"
    fontSize: "clamp(44px, 4.5vw, 72px)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  wordmark:
    fontFamily: "'Zen Kaku Gothic New', sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  lead:
    fontFamily: "'Manrope', sans-serif"
    fontSize: "clamp(17px, 1.45vw, 23px)"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.02em"
  interface:
    fontFamily: "'Manrope', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.2
  code:
    fontFamily: "'DM Mono', monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.75
rounded:
  button: "13px"
  window: "16px"
  contentCard: "17px"
  dialog: "20px"
  mention: "5px"
spacing:
  desktopGutter: "4.25vw"
  mobileGutter: "25px"
  columnGap: "4vw"
  wideColumnGap: "6vw"
components:
  secondaryButton:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.interface}"
    rounded: "{rounded.button}"
    padding: "13px 23px"
  contentCard:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.contentCard}"
  mention:
    backgroundColor: "{colors.mentionSurface}"
    textColor: "{colors.mentionText}"
    rounded: "{rounded.mention}"
---

# Akashi — Design System

## 1. Overview

A quiet, precise, and approachable visual language built around monochrome surfaces, Japanese Gothic display typography, generous space, and subtle interaction feedback. The system is intended as a reusable foundation for websites and product interfaces.

**Zen Kaku Gothic New + Manrope** establish the identity. **DM Mono** supports commands and technical details. Fine borders, soft shadows, and restrained motion add depth without competing with the content.

When adapting the system, retain the palette, type hierarchy, surface treatment, and interaction principles. Replace the brand name, copy, navigation, and imagery with the project's own. Component sizes and layout patterns are starting points; choose them to suit the content and device.

Visual references: [UImaxxing](https://uimaxx.ing/) for tactile surfaces and interaction feedback; [UI Skills](https://www.ui-skills.com/) for hierarchy and interface craft.

## 2. Colors

Use a monochrome palette. Establish hierarchy through contrast, weight, spacing, and scale.

| Role | Color | Use |
| --- | --- | --- |
| Paper | `#fafafa` | Page background. |
| Surface | `#ffffff` | Cards, dialogs, and secondary buttons. |
| Ink | `#191919` | Primary text and dark surfaces. |
| Muted | `#6d6d6d` | Secondary text. |
| Line | `#dedede` | Structural dividers and surface borders. |
| Lead | `#4c4c4c` | Introductory paragraphs. |
| Secondary heading | `#666666` | Quieter phrases within large headings. |
| Mention surface | `#ededed` | Selected inline tokens. |
| Mention text | `#141414` | Text within selected tokens. |

Primary buttons use a restrained `#292929` → `#141414` gradient with white text. Hover brightens it to `#3b3b3b` → `#252525`. Neutral hover fills include `#efefef` and `#f1f1f1`.

Keep supporting text legible; do not lower its contrast simply to make it feel secondary. Use a 2px ink focus outline with a 5px offset. Pale borders separate surfaces; controls and states must remain identifiable without relying on those borders alone.

## 3. Typography

### Font pairing

- **Zen Kaku Gothic New:** identity and display headings. Use 500 for headings, 700 for wordmarks, and 400 for secondary heading phrases. Its Japanese Gothic character gives the system a distinct, composed tone.
- **Manrope:** body copy, navigation, buttons, captions, and quotations. Its readable forms complement the display face.
- **DM Mono:** commands, terminal output, and compact technical markers. Reserve it for content that benefits from a monospaced face.

Self-host the font files, retain their SIL Open Font License notices, and use `font-display: swap`. Disable synthetic weights and italics with `font-synthesis: none`. Include the glyph subsets required by the project's languages; Latin-only subsets will not support Japanese copy.

### Reference type scale

| Element | Family / weight | Size / line height | Tracking |
| --- | --- | --- | --- |
| Wordmark | Zen Kaku Gothic New 700 | 36px / 1 | −0.03em |
| Display heading | Zen Kaku Gothic New 500 | `clamp(44px, 4.5vw, 72px)` / 1.12 | −0.035em |
| Oversized heading | Zen Kaku Gothic New 500 | `clamp(48px, 6.7vw, 96px)` / 1.1 | −0.035em |
| Card heading | Zen Kaku Gothic New 500 | `clamp(24px, 2.25vw, 32px)` / 1.22 | −0.025em |
| Lead paragraph | Manrope 400 | `clamp(17px, 1.45vw, 23px)` / 1.45 | −0.02em |
| Compact description | Manrope 400 | 13px / 1.6 | Normal |
| Button label | Manrope 500 | 14px / 1.2 | Normal |
| Quote | Manrope 400 | 18px / 1.5 | −0.01em |
| Compact command | DM Mono 400 | 11px / 1.75 | Normal |

The compact sizes are for short supporting content. Use a larger, comfortable body size for sustained reading, forms, or dense product interfaces.

Balance headline wrapping. Emphasize secondary phrases with regular weight and gray instead of italics. On mobile, use fluid sizes and natural wrapping; typical display headings span 40–56px, card headings 24–30px, and wordmarks approximately 30px. Check longer copy rather than scaling down the entire interface.

Font sources: [Zen Kaku Gothic New](https://github.com/googlefonts/zen-kakugothic), [Manrope](https://fonts.google.com/specimen/Manrope), [DM Mono](https://github.com/googlefonts/dm-mono).

## 4. Layout

### Composition

Use generous outer gutters and a clear hierarchy: one primary message or task, supporting content, then secondary actions. Keep navigation visually quieter than the main content.

Useful starting dimensions:

- Maximum width of 1800px for expansive visual sections; constrain reading content more tightly.
- Desktop side gutters of 4.25vw and mobile gutters of approximately 25px.
- Two-column layouts near `1fr 1.07fr`, with a 4vw gap.
- A wider 6vw gap when text and a detailed visual need more separation.
- Centered feature blocks up to 880px wide; narrower input or prompt cards up to 660px.

Let content determine page height. Avoid viewport locks or fixed containers that push content over navigation or other controls.

### Stable tabbed cards

Compact tabbed cards should maintain their outer geometry when switching between related panels. Keep the heading, tab list, and surrounding content stationary; fade only the panel contents.

One implementation is to place all panel contents in the same CSS grid cell so the tallest panel establishes the shared height. Inactive contents use `visibility: hidden`, `inert`, and `aria-hidden`. Do not use `display: none` for this pattern, since it removes their sizing contribution. Apply this to bounded card content rather than long pages with substantially different lengths.

### Responsive behavior

Start compact spacing adjustments near 1100px. Around 760px, stack multi-column sections and allow natural scrolling. Treat these as content-driven breakpoints, not device assumptions.

Retain primary actions and essential navigation on smaller screens. Reduce decorative spacing and tilt before reducing text size. Check wrapping, touch targets, media proportions, and control clearance at narrow widths and short viewport heights.

## 5. Elevation & Depth

White surfaces sit above near-white paper through fine borders and soft downward shadows. A reference shadow for floating feature cards:

```css
box-shadow:
  0 1px 2px #00000005,
  0 9px 14px -11px #0000002e,
  0 28px 45px -28px #00000038,
  0 56px 84px -53px #0000003d;
```

Reserve the full shadow for prominent floating surfaces. Use a border or lighter shadow for routine interface elements.

Decorative UI previews can rest at approximately ±2°, with hover moving them closer to level and lifting them by up to 3px. Reduce tilt to roughly ±1° on mobile. Keep navigation, reading columns, forms, and tabbed cards level.

Dialogs can use a translucent `#fafafaab` backdrop with 10px blur. Keep the dialog itself opaque and readable. Avoid colored shadows, ambient glows, and heavy outlines.

## 6. Shapes

| Element | Radius / dimensions |
| --- | --- |
| Main button | 13px radius; minimum height 48px desktop, 46px mobile. |
| Floating window | 16px radius. |
| Input or prompt card | 15–16px radius. |
| Content card | 17px radius. |
| Segmented control | 13px outer radius; 9px options. |
| Inline command | 11px radius. |
| Embedded media | 10px radius. |
| Mention token | 5px radius. |
| Dialog | 20px radius. |

Icon controls are circular. A visual diameter around 38–42px fits the system; provide a sufficient hit area and spacing for touch interaction.

Use Lucide-style icon geometry: a 24×24 view box, approximately 1.65 stroke width, rounded caps and joins, and `currentColor`. Typical visible sizes are 16–20px. Hide decorative SVGs from assistive technology and give icon-only controls accessible labels.

## 7. Components

### Buttons and navigation

Primary buttons use white text on the dark neutral gradient. Secondary buttons use a white surface, ink text, and a fine border. Keep labels direct and pair them with icons only when the icon helps explain the action.

Use a thin underline, stronger text, or a neutral fill to identify the active navigation item. Segmented controls place the selected option on a distinct neutral surface. Preserve visible focus and selected states independently of hover.

Copy actions provide brief confirmation without replacing the surrounding layout.

### Cards and dialogs

Group related content with a clear heading, comfortable padding, and restrained secondary text. Give only prominent feature cards the full floating treatment. Keep actions and contextual links in predictable positions.

Dialogs must support keyboard focus, Escape dismissal, and focus restoration to the triggering control. Keep lengthy content scrollable within the available viewport.

### Media and inline tokens

Use real interface captures when demonstrating an existing product. Keep captures faithful, provide descriptive alt text, and distinguish recordings from illustrative animations. Use grayscale when it preserves the information being shown.

Reserve media dimensions before loading to avoid layout movement. Animated examples need a static poster and an accessible pause or replay mechanism. Text inside media should follow the same typography as the surrounding interface.

For typing interactions, highlight a mention only after the full token has been entered or recognized. Use charcoal text on the light-gray mention surface with a 5px radius; partial text remains unhighlighted.

### Motion

Motion should communicate a change of state. Reading surfaces settle after entering; frequent controls should respond promptly.

| Interaction | Reference behavior |
| --- | --- |
| Content exit | Fade with up to 10px directional movement; 180ms, accelerating ease. |
| Prominent section entrance | Fade with up to 20px movement; 750ms, decelerating ease, optional 75ms stagger. |
| Navigation indicator | Slide to the selected item; up to 500ms, ease-in-out. |
| Tab selection | Content opacity only; 300ms, decelerating ease. |
| Dialog entrance | Fade, 10px rise, scale 0.99 → 1; 220ms. |
| Button feedback | 180–200ms hover transition; press scale 0.97. |
| Decorative preview hover | Small lift and rotation adjustment; up to 600ms. |

The longer entrance timing is for prominent visual sections, not routine product actions. GSAP implementations can use `power2.in` for exit, `power3.out` for entrance, `power3.inOut` for navigation, and `power2.out` for tab fades; equivalent easing in other libraries is suitable.

Respect `prefers-reduced-motion`. Remove nonessential movement, settle transitions immediately, and use posters for animated media. A motion-pause control should stop CSS animations, settle scripted transitions, and pause or replace animated media consistently.

### Sound

Sound is optional, subtle feedback: a soft tap, a short paired navigation cue, or a brighter copy confirmation. Keep cues brief and quiet, and avoid overlapping sounds during rapid interaction.

Start audio only after a trusted interaction. Provide an obvious mute control, remember the preference, and suspend audio when the page is hidden. Every action must work without sound, including when audio is unavailable. Avoid background music and scroll-triggered audio.

### Accessibility

Preserve semantic headings, a skip link, visible focus, labeled controls, live status where appropriate, and correct tab behavior. Support arrow keys and Home/End within tab lists without overriding text entry or browser shortcuts.

Communicate status with text and shape as well as tone. Validate text contrast, zoom, keyboard access, reduced motion, and touch targets in the consuming project. Check font loading, media loading, long labels, and narrow layouts before release.

## 8. Do's and Don'ts

**Do**

- Keep colors neutral and typography consistent across the interface and embedded media.
- Use spacing and hierarchy to make the primary task obvious.
- Keep tabbed cards stable and media dimensions predictable.
- Adapt content, navigation, and density to the project's needs.
- Preserve keyboard access, visible focus, reduced motion, and control over sound.
- Keep font licensing and required language coverage with the implementation.

**Don't**

- Mix unrelated display fonts or use italic styling for headline emphasis.
- Add cultural ornament as a substitute for a coherent identity.
- Add colored glows or decorative accents that compete with the monochrome hierarchy.
- Apply showcase tilts or large shadows to every component.
- Let animation delay routine actions, shift reading content, or hide state changes.
- Depend on sound, hover, or animation alone to communicate essential information.
