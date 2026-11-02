// Bun inlines a text import at build (`import x from "./a.md" with { type: "text" }`).
declare module "*.md" { const text: string; export default text; }
