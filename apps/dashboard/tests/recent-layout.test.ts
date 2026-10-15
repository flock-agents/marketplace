import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// T22b: at phone width the Recent rows put the Sample chip, a kind chip, Edit and Delete beside the title and squeezed it to a word per line.
// The page's own CSS drops the actions under the title there.
const dir = join(import.meta.dir, "..", "src");
describe("dashboard Recent rows at phone width", () => {
  const css = readFileSync(join(dir, "App.css"), "utf8");
  it("wraps the trailing actions below the title under 480px, with tokens only", () => {
    expect(css).toMatch(/@media \(max-width: 480px\)\s*{[^]*\.db-recent \.fl-row\s*{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.db-recent \.fl-row-trail\s*{[^}]*flex-basis: 100%/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });
  it("is loaded by main and applied to the Recent list", () => {
    expect(readFileSync(join(dir, "main.tsx"), "utf8")).toContain('import "./App.css"');
    expect(readFileSync(join(dir, "pages", "OverviewPage.tsx"), "utf8")).toContain('className="db-recent"');
  });
});
