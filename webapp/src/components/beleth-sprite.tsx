import { BELETH_SVG } from "@/components/beleth-svg";

/**
 * The animated mascot, inlined server-side (no runtime fetch, no hydration
 * flash). The globals.css keyframes reach the named groups inside the SVG —
 * the same mechanism as the mockup's injected sprite.
 */
export function BelethSprite() {
  return (
    <div
      className="beleth-sprite"
      dangerouslySetInnerHTML={{ __html: BELETH_SVG }}
    />
  );
}