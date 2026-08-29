import { BELETH_PROPS } from "@/components/beleth-props";
import { BELETH_SVG } from "@/components/beleth-svg";
import type { BelethPnl, BelethScene } from "@/lib/beleth";

/**
 * The animated mascot, inlined server-side (no runtime fetch, no hydration
 * flash). The globals.css keyframes reach the named groups inside the SVG;
 * `data-scene` selects one CSS-only skit, `data-pnl` swaps the mouth (happy /
 * sad / neutral) and tints the flame.
 *
 * Three composition-time fixes over the generated base art (beleth-svg.ts,
 * left untouched):
 *  - a fuller flame rooted at the head crown — the generated one is a tiny
 *    blob floating in a 4px gap above the head;
 *  - a wing-coloured membrane wedge injected INTO the #wing group at each
 *    armpit, so the wings read as attached to the torso and flap with it; the
 *    #body edge, drawn next, covers its inner side and keeps the silhouette;
 *  - a nose + the three mouths (happy / sad / neutral) injected INTO #beleth
 *    right after #head, so they track the face through every scene transform;
 *  - the remaining prop layer (bell, lens, stamp, …) spliced in before </svg>.
 */
// A real layered pixel flame that floats 2px clear of the head crown (head top
// is y17; the flame's lowest pixel is y14). Three concentric tones — red-orange
// spiky body, orange middle, yellow core with a white-hot centre — the shape
// the reference art uses. Wrapped in #flame-rig: #flame does the flicker,
// #flame-rig scales it by the day's P&L (tall & hard when green, low when red,
// out when Beleth sleeps). See globals.css.
const FLAME = `<g id="flame-rig"><g id="flame">
<rect x="30" y="2" width="1" height="2" fill="#e0532a"></rect>
<rect x="29" y="4" width="3" height="2" fill="#e0532a"></rect>
<rect x="28" y="6" width="5" height="1" fill="#e0532a"></rect>
<rect x="27" y="7" width="7" height="1" fill="#e0532a"></rect>
<rect x="26" y="8" width="9" height="4" fill="#e0532a"></rect>
<rect x="27" y="12" width="7" height="1" fill="#e0532a"></rect>
<rect x="28" y="13" width="5" height="1" fill="#e0532a"></rect>
<rect x="29" y="14" width="3" height="1" fill="#e0532a"></rect>
<rect x="30" y="5" width="1" height="1" fill="#f5a53c"></rect>
<rect x="29" y="6" width="3" height="1" fill="#f5a53c"></rect>
<rect x="28" y="7" width="5" height="1" fill="#f5a53c"></rect>
<rect x="27" y="8" width="7" height="4" fill="#f5a53c"></rect>
<rect x="28" y="12" width="5" height="1" fill="#f5a53c"></rect>
<rect x="29" y="13" width="3" height="1" fill="#f5a53c"></rect>
<rect x="30" y="7" width="1" height="1" fill="#ffd95e"></rect>
<rect x="29" y="8" width="3" height="1" fill="#ffd95e"></rect>
<rect x="28" y="9" width="5" height="2" fill="#ffd95e"></rect>
<rect x="29" y="11" width="3" height="1" fill="#ffd95e"></rect>
<rect x="30" y="12" width="1" height="1" fill="#ffd95e"></rect>
<rect x="30" y="8" width="1" height="3" fill="#fff1c4"></rect>
</g></g>`;

// Membrane wedges that fill the armpit gap between torso and wing. Injected as
// the last children of #wing so they flap with it and read as wing, not flesh.
const MEMBRANE = `<g id="wing-join">
<rect x="20" y="46" width="4" height="1" fill="#3a1418"></rect>
<rect x="19" y="47" width="5" height="1" fill="#3a1418"></rect>
<rect x="19" y="48" width="5" height="1" fill="#3a1418"></rect>
<rect x="19" y="49" width="6" height="1" fill="#3a1418"></rect>
<rect x="20" y="50" width="5" height="1" fill="#3a1418"></rect>
<rect x="20" y="51" width="5" height="1" fill="#3a1418"></rect>
<rect x="21" y="52" width="4" height="1" fill="#3a1418"></rect>
<rect x="22" y="53" width="3" height="1" fill="#3a1418"></rect>
<rect x="36" y="46" width="4" height="1" fill="#3a1418"></rect>
<rect x="36" y="47" width="5" height="1" fill="#3a1418"></rect>
<rect x="36" y="48" width="5" height="1" fill="#3a1418"></rect>
<rect x="35" y="49" width="6" height="1" fill="#3a1418"></rect>
<rect x="35" y="50" width="5" height="1" fill="#3a1418"></rect>
<rect x="35" y="51" width="5" height="1" fill="#3a1418"></rect>
<rect x="35" y="52" width="4" height="1" fill="#3a1418"></rect>
<rect x="35" y="53" width="3" height="1" fill="#3a1418"></rect>
</g>`;

// The generated head already carries a faint nose/mouth in #8e4446 — two
// nostril dashes at y37 and a mouth bar at y40. #nose paints those two spots
// back to muzzle colour, then redraws the nostrils one row higher; each mouth
// group draws its expression on the same y39-41 band the old bar occupied, so
// the feature lands exactly where the base art put it. Injected INTO #beleth
// after #head so it rides every scene transform on the face.
const FACE = `<g id="nose">
<rect x="27" y="37" width="7" height="1" fill="#b05a5c"></rect>
<rect x="27" y="40" width="7" height="1" fill="#b05a5c"></rect>
<rect x="28" y="36" width="1" height="1" fill="#8e4446"></rect>
<rect x="32" y="36" width="1" height="1" fill="#8e4446"></rect>
</g>
<g id="pr-mouth-flat">
<rect x="28" y="40" width="5" height="1" fill="#4a1d22"></rect>
</g>
<g id="pr-mouth-smile">
<rect x="27" y="39" width="1" height="1" fill="#4a1d22"></rect>
<rect x="33" y="39" width="1" height="1" fill="#4a1d22"></rect>
<rect x="28" y="40" width="1" height="1" fill="#4a1d22"></rect>
<rect x="32" y="40" width="1" height="1" fill="#4a1d22"></rect>
<rect x="29" y="41" width="3" height="1" fill="#4a1d22"></rect>
</g>
<g id="pr-mouth-frown">
<rect x="29" y="39" width="3" height="1" fill="#4a1d22"></rect>
<rect x="28" y="40" width="1" height="1" fill="#4a1d22"></rect>
<rect x="32" y="40" width="1" height="1" fill="#4a1d22"></rect>
<rect x="27" y="41" width="1" height="1" fill="#4a1d22"></rect>
<rect x="33" y="41" width="1" height="1" fill="#4a1d22"></rect>
</g>`;

const SPRITE_HTML = BELETH_SVG.replace(/<g id="flame">[\s\S]*?<\/g>/, FLAME)
  .replace(/<\/g>\s*<g id="tail">/, `${MEMBRANE}</g>\n<g id="tail">`)
  .replace(/<\/g>\s*<g id="horn">/, `${FACE}</g>\n<g id="horn">`)
  .replace("</svg>", `${BELETH_PROPS}</svg>`);

export function BelethSprite({
  scene = "guard",
  pnl = null,
  className = "",
}: {
  scene?: BelethScene;
  pnl?: BelethPnl;
  className?: string;
}) {
  return (
    <div
      className={`beleth-sprite${className ? ` ${className}` : ""}`}
      data-scene={scene}
      data-pnl={pnl ?? undefined}
      dangerouslySetInnerHTML={{ __html: SPRITE_HTML }}
    />
  );
}
