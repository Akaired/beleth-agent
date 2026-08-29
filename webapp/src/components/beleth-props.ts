// Hand-authored prop layer for the reactive mascot. These groups are spliced
// into the base sprite SVG (src/components/beleth-svg.ts) just before </svg>, so
// they render on top of the character. Every top-level group is opacity:0 by
// default (globals.css, `[id^="pr-"]`) and revealed by the active data-scene.
// Same 60x68 pixel grid as the base art. The scene state machine that picks a
// data-scene lives in src/lib/beleth.ts; the choreography in globals.css.
export const BELETH_PROPS = `
<g id="pr-bell">
<rect x="48" y="36" width="2" height="1" fill="#8a6a20"></rect>
<rect x="47" y="37" width="4" height="1" fill="#b98f2e"></rect>
<rect x="47" y="38" width="4" height="1" fill="#d9a94a"></rect>
<rect x="46" y="39" width="6" height="1" fill="#e6bd63"></rect>
<rect x="45" y="40" width="8" height="1" fill="#e6bd63"></rect>
<rect x="45" y="41" width="8" height="1" fill="#d9a94a"></rect>
<rect x="44" y="42" width="10" height="1" fill="#e6bd63"></rect>
<rect x="44" y="43" width="10" height="1" fill="#c9962f"></rect>
<rect x="45" y="44" width="8" height="1" fill="#8a6a20"></rect>
<rect x="48" y="45" width="2" height="1" fill="#6b4f16"></rect>
<rect x="46" y="40" width="1" height="3" fill="#f2d488"></rect>
</g>
<g id="pr-soundwave">
<rect x="55" y="40" width="1" height="1" fill="#d9a03c"></rect>
<rect x="56" y="41" width="1" height="2" fill="#d9a03c"></rect>
<rect x="55" y="43" width="1" height="1" fill="#d9a03c"></rect>
<rect x="57" y="39" width="1" height="1" fill="#c98f2e"></rect>
<rect x="58" y="40" width="1" height="4" fill="#c98f2e"></rect>
<rect x="57" y="44" width="1" height="1" fill="#c98f2e"></rect>
</g>
<g id="pr-lens">
<rect x="45" y="29" width="4" height="1" fill="#3a444c"></rect>
<rect x="44" y="30" width="1" height="5" fill="#3a444c"></rect>
<rect x="49" y="30" width="1" height="5" fill="#3a444c"></rect>
<rect x="45" y="35" width="4" height="1" fill="#3a444c"></rect>
<rect x="45" y="30" width="4" height="5" fill="#9fd8e8" fill-opacity="0.32"></rect>
<rect x="46" y="30" width="1" height="2" fill="#eaf7fb" fill-opacity="0.75"></rect>
<rect x="49" y="35" width="1" height="1" fill="#5a3a1c"></rect>
<rect x="50" y="36" width="1" height="1" fill="#5a3a1c"></rect>
<rect x="51" y="37" width="2" height="2" fill="#4a2f16"></rect>
</g>
<g id="pr-ticket">
<rect x="39" y="15" width="9" height="8" fill="#eef1f3"></rect>
<rect x="39" y="15" width="9" height="1" fill="#cfd6da"></rect>
<rect x="46" y="15" width="2" height="2" fill="#dbe1e4"></rect>
<rect x="41" y="17" width="5" height="1" fill="#7f888f"></rect>
<rect x="41" y="19" width="5" height="1" fill="#b7bec3"></rect>
<rect x="41" y="20" width="3" height="1" fill="#b7bec3"></rect>
<rect x="41" y="22" width="4" height="1" fill="#35a67c"></rect>
</g>
<g id="pr-stamp">
<rect x="40" y="33" width="5" height="1" fill="#6a4a2a"></rect>
<rect x="39" y="34" width="7" height="1" fill="#7d5832"></rect>
<rect x="41" y="35" width="3" height="2" fill="#5a3a1c"></rect>
<rect x="39" y="37" width="7" height="1" fill="#2a333a"></rect>
<rect x="38" y="38" width="9" height="1" fill="#3a444c"></rect>
<rect x="39" y="39" width="7" height="1" fill="#d9a03c"></rect>
</g>
<g id="pr-doc">
<rect x="39" y="46" width="15" height="10" fill="#eef1f3"></rect>
<rect x="39" y="46" width="15" height="1" fill="#d3dade"></rect>
<rect x="41" y="48" width="10" height="1" fill="#aab2b8"></rect>
<rect x="41" y="50" width="11" height="1" fill="#c2c9ce"></rect>
<rect x="41" y="52" width="8" height="1" fill="#c2c9ce"></rect>
<rect x="41" y="54" width="9" height="1" fill="#c2c9ce"></rect>
</g>
<g id="pr-seal">
<rect x="45" y="51" width="2" height="1" fill="#d9a03c"></rect>
<rect x="44" y="52" width="4" height="1" fill="#e6bd63"></rect>
<rect x="45" y="53" width="2" height="1" fill="#c98f2e"></rect>
<rect x="43" y="52" width="1" height="1" fill="#d9a03c"></rect>
<rect x="48" y="52" width="1" height="1" fill="#d9a03c"></rect>
</g>
<g id="pr-plus1">
<rect x="43" y="30" width="3" height="1" fill="#35a67c"></rect>
<rect x="44" y="29" width="1" height="3" fill="#35a67c"></rect>
<rect x="47" y="28" width="1" height="1" fill="#35a67c"></rect>
<rect x="48" y="28" width="1" height="5" fill="#35a67c"></rect>
<rect x="47" y="32" width="3" height="1" fill="#35a67c"></rect>
</g>
<g id="pr-cross">
<rect x="42" y="23" width="9" height="9" fill="#f6ecec"></rect>
<rect x="42" y="23" width="9" height="1" fill="#e2cccc"></rect>
<rect x="44" y="25" width="1" height="1" fill="#e0584c"></rect>
<rect x="45" y="26" width="1" height="1" fill="#e0584c"></rect>
<rect x="46" y="27" width="1" height="1" fill="#e0584c"></rect>
<rect x="47" y="28" width="1" height="1" fill="#c8443a"></rect>
<rect x="48" y="29" width="1" height="1" fill="#e0584c"></rect>
<rect x="49" y="30" width="1" height="1" fill="#e0584c"></rect>
<rect x="48" y="25" width="1" height="1" fill="#e0584c"></rect>
<rect x="47" y="26" width="1" height="1" fill="#e0584c"></rect>
<rect x="45" y="29" width="1" height="1" fill="#e0584c"></rect>
<rect x="44" y="30" width="1" height="1" fill="#e0584c"></rect>
</g>
<g id="pr-wind">
<g id="bw1"><rect x="2" y="29" width="7" height="1" fill="#8c959d" fill-opacity="0.55"></rect></g>
<g id="bw2"><rect x="1" y="34" width="10" height="1" fill="#aab2b8" fill-opacity="0.6"></rect></g>
<g id="bw3"><rect x="3" y="39" width="6" height="1" fill="#8c959d" fill-opacity="0.5"></rect></g>
</g>
<g id="pr-sweat">
<rect x="38" y="24" width="1" height="1" fill="#bfe6f0"></rect>
<rect x="38" y="25" width="1" height="1" fill="#8fc9dc"></rect>
</g>
<g id="pr-smoke">
<g id="bsm1"><rect x="30" y="12" width="1" height="1" fill="#8c959d" fill-opacity="0.5"></rect></g>
<g id="bsm2"><rect x="29" y="9" width="1" height="1" fill="#9aa2a8" fill-opacity="0.4"></rect></g>
<g id="bsm3"><rect x="31" y="6" width="1" height="1" fill="#aab2b8" fill-opacity="0.3"></rect></g>
</g>
<g id="pr-zzz">
<g id="bz1">
<rect x="38" y="14" width="3" height="1" fill="#8c959d"></rect>
<rect x="40" y="15" width="1" height="1" fill="#8c959d"></rect>
<rect x="38" y="16" width="3" height="1" fill="#8c959d"></rect>
</g>
<g id="bz2">
<rect x="43" y="9" width="4" height="1" fill="#9aa2a8"></rect>
<rect x="45" y="10" width="1" height="1" fill="#9aa2a8"></rect>
<rect x="44" y="11" width="1" height="1" fill="#9aa2a8"></rect>
<rect x="43" y="12" width="4" height="1" fill="#9aa2a8"></rect>
</g>
<g id="bz3">
<rect x="49" y="3" width="5" height="1" fill="#aab2b8"></rect>
<rect x="52" y="4" width="1" height="1" fill="#aab2b8"></rect>
<rect x="51" y="5" width="1" height="1" fill="#aab2b8"></rect>
<rect x="50" y="6" width="1" height="1" fill="#aab2b8"></rect>
<rect x="49" y="7" width="5" height="1" fill="#aab2b8"></rect>
</g>
</g>
<g id="pr-coins">
<g id="bcoinL">
<rect x="6" y="43" width="4" height="1" fill="#d9a03c"></rect>
<rect x="5" y="44" width="6" height="2" fill="#e6bd63"></rect>
<rect x="6" y="46" width="4" height="1" fill="#c98f2e"></rect>
<rect x="7" y="44" width="1" height="1" fill="#f2d488"></rect>
</g>
<g id="bcoinR">
<rect x="49" y="39" width="4" height="1" fill="#d9a03c"></rect>
<rect x="48" y="40" width="6" height="2" fill="#e6bd63"></rect>
<rect x="49" y="42" width="4" height="1" fill="#c98f2e"></rect>
<rect x="50" y="40" width="1" height="1" fill="#f2d488"></rect>
</g>
</g>
<g id="pr-calendar">
<rect x="43" y="15" width="10" height="11" fill="#eef1f3"></rect>
<rect x="43" y="15" width="10" height="3" fill="#e0584c"></rect>
<rect x="45" y="14" width="1" height="2" fill="#cfd6da"></rect>
<rect x="50" y="14" width="1" height="2" fill="#cfd6da"></rect>
<rect x="45" y="20" width="6" height="1" fill="#8c959d"></rect>
<rect x="45" y="22" width="6" height="1" fill="#b7bec3"></rect>
<rect x="47" y="23" width="3" height="3" fill="#e0584c" fill-opacity="0.35"></rect>
<rect x="47" y="23" width="3" height="1" fill="#e0584c"></rect>
<rect x="47" y="25" width="3" height="1" fill="#e0584c"></rect>
<rect x="47" y="23" width="1" height="3" fill="#e0584c"></rect>
<rect x="49" y="23" width="1" height="3" fill="#e0584c"></rect>
</g>
<g id="pr-eyes-shut">
<rect x="21" y="32" width="5" height="1" fill="#2a1a1e"></rect>
<rect x="34" y="32" width="5" height="1" fill="#2a1a1e"></rect>
<rect x="22" y="33" width="3" height="1" fill="#1a0e10"></rect>
<rect x="35" y="33" width="3" height="1" fill="#1a0e10"></rect>
<rect x="20" y="33" width="1" height="1" fill="#2a1a1e"></rect>
<rect x="39" y="33" width="1" height="1" fill="#2a1a1e"></rect>
</g>
`;
