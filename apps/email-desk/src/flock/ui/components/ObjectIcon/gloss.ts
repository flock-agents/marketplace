// The dark finish's lit gloss is an SVG filter that CSS reaches as url(#fl-obj-gloss).
// It lives outside the object SVGs (their allowlist forbids url()), once per document.
export const GLOSS_ID = "fl-obj-gloss";
export const GLOSS_SVG = `<svg id="${GLOSS_ID}-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>`
  + `<filter id="${GLOSS_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">`
  + `<feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="b"/>`
  + `<feSpecularLighting in="b" surfaceScale="3" specularConstant=".9" specularExponent="22" style="lighting-color:var(--obj-white)" result="s"><fePointLight x="-40" y="-60" z="90"/></feSpecularLighting>`
  + `<feComposite in="s" in2="SourceAlpha" operator="in" result="sm"/>`
  + `<feComposite in="SourceGraphic" in2="sm" operator="arithmetic" k1="0" k2="1" k3=".55" k4="0"/>`
  + `</filter></defs></svg>`;
export function ensureGloss(): void {
  if (typeof document === "undefined" || !document.body) return;
  if (document.getElementById(`${GLOSS_ID}-defs`)) return;
  document.body.insertAdjacentHTML("beforeend", GLOSS_SVG);
}
