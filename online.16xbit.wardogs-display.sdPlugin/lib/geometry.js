const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Maps a region given in reference-screen pixels (config.reference, e.g. 3840x2160) to real screen pixels.
 *
 * Without `anchor` the region is scaled by screen width from the top-left corner (original behaviour).
 * With `anchor` ("left" | "center" | "right") the region keeps its distance from that screen edge / the screen
 * centre, and everything is scaled by screen HEIGHT, which is how most game HUDs scale. Vertically it is measured
 * from the bottom edge, or from the top with `valign: "top"`. On a 16:9 screen both modes give the same result.
 */
export function fitRegion(region, ref, screen, name = "region") {
  const [sw, sh] = screen;
  for (const f of ["x", "y", "w", "h"]) {
    if (!Number.isFinite(region?.[f])) throw new Error(`${name}: "${f}" must be a number`);
  }
  if (region.w <= 0 || region.h <= 0) throw new Error(`${name}: w and h must be positive`);
  if (!(ref?.width > 0 && ref?.height > 0)) throw new Error(`reference width/height must be positive numbers`);

  let x, y, k;
  if (region.anchor === undefined) {
    k = sw / ref.width;
    x = region.x * k;
    y = region.y * k;
  } else {
    if (!["left", "center", "right"].includes(region.anchor)) throw new Error(`${name}: anchor must be left, center or right`);
    if (region.valign !== undefined && !["top", "bottom"].includes(region.valign)) throw new Error(`${name}: valign must be top or bottom`);
    k = sh / ref.height;
    x = region.anchor === "center" ? sw / 2 + (region.x - ref.width / 2) * k
      : region.anchor === "right" ? sw - (ref.width - region.x) * k
      : region.x * k;
    y = region.valign === "top" ? region.y * k : sh - (ref.height - region.y) * k;
  }

  // Keep the capture inside the screen.
  x = clamp(Math.round(x), 0, sw - 1);
  y = clamp(Math.round(y), 0, sh - 1);
  const w = clamp(Math.round(region.w * k), 1, sw - x);
  const h = clamp(Math.round(region.h * k), 1, sh - y);
  return { x, y, w, h };
}
