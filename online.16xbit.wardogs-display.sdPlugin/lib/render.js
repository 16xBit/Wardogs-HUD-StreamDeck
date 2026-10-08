const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Builds a 144x144 key image: pure black background (OLED pixels off, so it looks background-less),
 * a small label on top and a large number below. Font size shrinks to fit up to 4 digits.
 */
export function keyImage({ label, value, color = "#ffffff", labelColor = "#9aa4af" }) {
  const has = value !== null && value !== undefined;
  const text = has ? String(value) : "--";
  const size = Math.min(70, Math.floor(132 / (0.6 * Math.max(text.length, 2))));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="#000"/>` +
    `<text x="72" y="42" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="30" fill="${labelColor}">${esc(label)}</text>` +
    `<text x="72" y="112" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="${has ? color : "#555"}">${esc(text)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}
