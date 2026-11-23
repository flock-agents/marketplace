export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set(["svg","g","path","rect","circle","ellipse","line","polyline","polygon"]);
export const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  "xmlns","viewBox","d","x","y","x1","y1","x2","y2","cx","cy","r","rx","ry","width","height","points","transform",
  "fill","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","opacity","fill-opacity",
  "stroke-opacity","fill-rule","clip-rule",
]);
export interface SvgNode { name: string; attrs: Record<string, string>; children: SvgNode[] }

const TAG = /<\s*(\/)?\s*([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?\s*>/y;
const ATTR = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseSvg(src: string): SvgNode {
  // Only one leading XML declaration is dropped. Any other `<?` or comment is refused below: HTML and XML
  // parsers disagree on where those end (`--!>`), which would let markup slip past this checker.
  const s = src.trim().replace(/^<\?xml\s[^>?]*\?>/, "").trim();
  const root: SvgNode = { name: "#root", attrs: {}, children: [] };
  const stack: SvgNode[] = [root];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s.startsWith("<!", i)) throw new Error("comments and declarations are not allowed");
    if (s.startsWith("<?", i)) throw new Error("processing instructions are not allowed");
    if (s[i] !== "<") throw new Error(`text content at ${i}`);
    TAG.lastIndex = i;
    const m = TAG.exec(s);
    if (!m) throw new Error(`malformed tag at ${i}`);
    i = TAG.lastIndex;
    const [, closing, name, attrSrc, selfClose] = m;
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`mismatched </${name}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrSrc.matchAll(ATTR)) {
      if (Object.prototype.hasOwnProperty.call(attrs, a[1])) throw new Error(`duplicate attribute ${a[1]}`);
      const v = a[2] ?? a[3] ?? "";
      if (v.includes("&")) throw new Error(`"&" in attribute ${a[1]} (entities can hide url() and javascript:)`);
      if (v.includes("\\")) throw new Error(`backslash in attribute ${a[1]} (CSS escapes can hide url())`);
      attrs[a[1]] = v;
    }
    const node: SvgNode = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error("unclosed element");
  if (root.children.length !== 1 || root.children[0].name !== "svg") throw new Error("root must be one <svg>");
  return root.children[0];
}

export function svgViolations(src: string): string[] {
  let tree: SvgNode;
  try { tree = parseSvg(src); } catch (e) {
    const msg = (e as Error).message;
    // A text node is how <text>14</text> or <script>…</script> first shows up; name the element if we can.
    const el = /<\s*([A-Za-z][\w:-]*)[^>]*>[^<]+</.exec(src)?.[1];
    return [el && !ALLOWED_ELEMENTS.has(el) ? `element <${el}> not allowed` : `unparseable: ${msg}`];
  }
  const out: string[] = [];
  (function walk(n: SvgNode) {
    if (!ALLOWED_ELEMENTS.has(n.name)) out.push(`element <${n.name}> not allowed`);
    for (const [k, v] of Object.entries(n.attrs)) {
      if (!ALLOWED_ATTRS.has(k)) out.push(`attribute ${k} not allowed on <${n.name}>`);
      if (/url\s*\(/i.test(v)) out.push(`url() reference in ${k}`);
      if (/javascript:/i.test(v)) out.push(`javascript: in ${k}`);
    }
    n.children.forEach(walk);
  })(tree);
  return out;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Re-serialises a parsed tree: only allowlisted element and attribute names, escaped values. Nothing unchecked can come out. */
export function serializeSvg(node: SvgNode, extraAttrs: ReadonlySet<string> = new Set()): string {
  if (!ALLOWED_ELEMENTS.has(node.name)) return "";
  const attrs = Object.entries(node.attrs)
    .filter(([k]) => ALLOWED_ATTRS.has(k) || extraAttrs.has(k))
    .map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  const kids = node.children.map((c) => serializeSvg(c, extraAttrs)).join("");
  return kids ? `<${node.name}${attrs}>${kids}</${node.name}>` : `<${node.name}${attrs}/>`;
}
