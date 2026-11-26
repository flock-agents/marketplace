// WhatsApp skill: which PDFs read-chat downloads, and what it answers for each (_documents.ts), with
// the open page stood in: `mark` and `download` answer as Flock's steps would, files are written to
// a temp folder as Flock keeps them.
//
// Run: bun test tests/whatsapp.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DOC_LIMITS, StopDownloads, bytesOf, checkKept, fetchDocuments, pruneDocuments, sameFile, withDocuments, type DocumentIO, type Kept } from "../../skills/whatsapp/scripts/_documents";
import type { Message } from "../../skills/whatsapp/scripts/_page";

let dir = "";
let downloadsDir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-docs-"));
  downloadsDir = join(dir, "downloads");
  require("fs").mkdirSync(downloadsDir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const msg = (id: string, name: string, size = "100 kB", pdf = name.endsWith(".pdf")): Message =>
  ({ from: "School", time: "10:00", text: "[document]", mine: false, doc: { id, name, pdf, size } });

/** A file as Flock keeps it: a PDF unless told otherwise. */
function keep(name: string, bytes = 2000, pdf = true): Kept {
  const path = join(downloadsDir, name);
  writeFileSync(path, (pdf ? "%PDF-1.4\n" : "PK\u0003\u0004") + " ".repeat(bytes));
  return { fileName: name, path, size: bytes + (pdf ? 9 : 4) };
}

/** The open page: each click downloads the marked document, as `files` says (default: a small PDF). */
function page(messages: Message[], files: Record<string, () => Kept[]> = {}, timeLeft = 120_000) {
  const clicked: string[] = [];
  let marked = "";
  const io: DocumentIO = {
    mark: async (id) => { marked = id; return true; },
    download: async () => {
      const m = messages.find((x) => x.doc?.id === marked)!;
      clicked.push(m.doc!.name);
      return (files[m.doc!.name] ?? (() => [keep(m.doc!.name)]))();
    },
    timeLeftMs: () => timeLeft,
    dataDir: dir,
  };
  return { io, clicked };
}

describe("which PDFs are downloaded", () => {
  it("PDFs only, newest first, at most 5 a read; the rest say why", async () => {
    const messages = [1, 2, 3, 4, 5, 6, 7].map((n) => msg(`m${n}`, `Circular-${n}.pdf`)).concat([msg("w", "Timetable.docx")]);
    const { io, clicked } = page(messages);
    const out = await fetchDocuments(messages, io);
    expect(clicked).toEqual(["Circular-7.pdf", "Circular-6.pdf", "Circular-5.pdf", "Circular-4.pdf", "Circular-3.pdf"]);
    expect(out.get("m7")).toMatchObject({ name: "Circular-7.pdf", path: join(downloadsDir, "Circular-7.pdf") });
    expect(out.get("m2")).toEqual({ name: "Circular-2.pdf", error: "not downloaded: at most 5 a read; read the chat again for the rest" });
    expect(out.get("w")).toEqual({ name: "Timetable.docx", error: "not downloaded: only PDFs are" });
    expect(DOC_LIMITS.perRead).toBe(5);
  });

  it("one WhatsApp shows as over 10 MB is never clicked", async () => {
    const messages = [msg("big", "Annual-Report.pdf", "40 pages · PDF · 14 MB"), msg("ok", "Fees.pdf", "9.5 MB")];
    const { io, clicked } = page(messages);
    const out = await fetchDocuments(messages, io);
    expect(clicked).toEqual(["Fees.pdf"]);
    expect(out.get("big")).toEqual({ name: "Annual-Report.pdf", error: "not downloaded: 14 MB, over the 10 MB limit" });
  });

  it("the next read gives the ones downloaded before again, without a click, and gets the older ones", async () => {
    const messages = [1, 2, 3, 4, 5, 6, 7].map((n) => msg(`m${n}`, `Circular-${n}.pdf`));
    await fetchDocuments(messages, page(messages).io);
    const again = page(messages);
    const out = await fetchDocuments(messages, again.io);
    expect(again.clicked).toEqual(["Circular-2.pdf", "Circular-1.pdf"]);
    expect([...out.values()].every((r) => "path" in r)).toBe(true);
  });

  it("a file deleted since is downloaded again", async () => {
    const messages = [msg("a", "Fees.pdf")];
    const first = await fetchDocuments(messages, page(messages).io);
    rmSync((first.get("a") as any).path);
    const again = page(messages);
    await fetchDocuments(messages, again.io);
    expect(again.clicked).toEqual(["Fees.pdf"]);
  });
});

describe("kept 30 days", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const known = () => JSON.parse(require("fs").readFileSync(join(dir, "whatsapp", "documents.json"), "utf8"));

  it("deletes the PDFs downloaded over 30 days ago, file and entry, and keeps the rest", async () => {
    const messages = [msg("old", "Old.pdf"), msg("new", "New.pdf")];
    const out = await fetchDocuments(messages, page(messages).io);
    const stray = join(downloadsDir, "Not-ours.pdf");
    writeFileSync(stray, "%PDF-1.4");
    const k = known();
    k.old.at = Date.now() - 31 * DAY;
    k.new.at = Date.now() - 29 * DAY;
    writeFileSync(join(dir, "whatsapp", "documents.json"), JSON.stringify(k));
    expect(pruneDocuments(dir)).toBe(1);
    expect(existsSync((out.get("old") as any).path)).toBe(false);
    expect(existsSync((out.get("new") as any).path)).toBe(true);
    expect(existsSync(stray)).toBe(true);
    expect(Object.keys(known())).toEqual(["new"]);
    expect(pruneDocuments(dir)).toBe(0);
    expect(DOC_LIMITS.keepMs).toBe(30 * DAY);
  });

  it("a PDF deleted that way is downloaded again when read again, within the caps", async () => {
    const messages = [1, 2, 3, 4, 5, 6].map((n) => msg(`m${n}`, `C-${n}.pdf`));
    await fetchDocuments(messages, page(messages).io);
    const k = known();
    for (const id of Object.keys(k)) k[id].at = Date.now() - 40 * DAY;
    writeFileSync(join(dir, "whatsapp", "documents.json"), JSON.stringify(k));
    expect(pruneDocuments(dir)).toBe(5);
    const again = page(messages);
    const out = await fetchDocuments(messages, again.io);
    expect(again.clicked).toEqual(["C-6.pdf", "C-5.pdf", "C-4.pdf", "C-3.pdf", "C-2.pdf"]);
    expect((out.get("m1") as any).error).toContain("at most 5 a read");
  });

  it("no data folder or no documents.json is nothing to do", () => {
    expect(pruneDocuments("")).toBe(0);
    expect(pruneDocuments(dir)).toBe(0);
  });
});

describe("what a download answers", () => {
  it("a kept file over 10 MB, or not a PDF, is deleted and says why", async () => {
    const messages = [msg("big", "Minutes.pdf", "200 kB"), msg("fake", "Notice.pdf")];
    const { io } = page(messages, {
      "Minutes.pdf": () => [keep("Minutes.pdf", 11 * 1024 * 1024)],
      "Notice.pdf": () => [keep("Notice.pdf", 100, false)],
    });
    const out = await fetchDocuments(messages, io);
    expect(out.get("big")).toEqual({ name: "Minutes.pdf", error: "not kept: 11 MB, over the 10 MB limit" });
    expect(out.get("fake")).toEqual({ name: "Notice.pdf", error: "not kept: the file WhatsApp gave is not a PDF" });
    expect(existsSync(join(downloadsDir, "Minutes.pdf"))).toBe(false);
    expect(existsSync(join(downloadsDir, "Notice.pdf"))).toBe(false);
  });

  it("no download started, or Flock's own error, is that document's reason and the others go on", async () => {
    const messages = [msg("a", "Broken.pdf"), msg("b", "Late.pdf"), msg("c", "Fees.pdf")];
    const { io, clicked } = page(messages, {
      "Broken.pdf": () => { throw new Error("no download started within 20000ms"); },
      "Late.pdf": () => [{ fileName: "Late.pdf", error: "the download did not finish within 120s and was cancelled" }],
    });
    const out = await fetchDocuments(messages, io);
    expect(clicked).toEqual(["Fees.pdf", "Late.pdf", "Broken.pdf"]);
    expect(out.get("a")).toEqual({ name: "Broken.pdf", error: "not downloaded: WhatsApp did not start the download" });
    expect(out.get("b")).toEqual({ name: "Late.pdf", error: "not downloaded: the download did not finish within 120s and was cancelled" });
    expect(out.get("c")).toMatchObject({ path: join(downloadsDir, "Fees.pdf") });
  });

  it("a file that finished late goes to its own document; a stray one is deleted", async () => {
    const messages = [msg("a", "First.pdf"), msg("b", "Second.pdf")];
    const { io } = page(messages, {
      "Second.pdf": () => [],
      "First.pdf": () => [keep("Second.pdf"), keep("First.pdf"), keep("Unasked.pdf")],
    });
    const out = await fetchDocuments(messages, io);
    expect(out.get("a")).toMatchObject({ path: join(downloadsDir, "First.pdf") });
    expect(out.get("b")).toMatchObject({ path: join(downloadsDir, "Second.pdf") });
    expect(existsSync(join(downloadsDir, "Unasked.pdf"))).toBe(false);
  });

  it("the person taking the window ends this read's downloads", async () => {
    const messages = [msg("a", "One.pdf"), msg("b", "Two.pdf")];
    const { io, clicked } = page(messages, { "Two.pdf": () => { throw new StopDownloads("the person has the WhatsApp window open"); } });
    const out = await fetchDocuments(messages, io);
    expect(clicked).toEqual(["Two.pdf"]);
    expect(out.get("a")).toEqual({ name: "One.pdf", error: "not downloaded: the person has the WhatsApp window open" });
  });

  it("none starts with too little time left", async () => {
    const messages = [msg("a", "One.pdf")];
    const { io, clicked } = page(messages, {}, DOC_LIMITS.waitMs);
    const out = await fetchDocuments(messages, io);
    expect(clicked).toEqual([]);
    expect(out.get("a")).toEqual({ name: "One.pdf", error: "not downloaded: no time left in this read; read the chat again later" });
  });

  it("the answer swaps the page's doc for document, and leaves other messages as they were", () => {
    const messages: Message[] = [{ from: "A", time: "1", text: "hi", mine: false }, msg("a", "One.pdf")];
    const out = withDocuments(messages, new Map([["a", { name: "One.pdf", path: "/x/One.pdf", size: 10 }]]));
    expect(out).toEqual([{ from: "A", time: "1", text: "hi", mine: false }, { from: "School", time: "10:00", text: "[document]", mine: false, document: { name: "One.pdf", path: "/x/One.pdf", size: 10 } }]);
  });
});

describe("helpers", () => {
  it("reads the sizes WhatsApp shows", () => {
    expect(bytesOf("120 kB")).toBe(120 * 1024);
    expect(bytesOf("1 page · PDF · 1,5 MB")).toBe(Math.round(1.5 * 1024 ** 2));
    expect(bytesOf("900 B")).toBe(900);
    expect(bytesOf("2 pages")).toBeNull();
  });

  it("knows Flock's safe, numbered name for a file", () => {
    expect(sameFile("Fees (1).pdf", "Fees.pdf")).toBe(true);
    expect(sameFile("a_b.pdf", "a/b.pdf")).toBe(true);
    expect(sameFile("Fees.pdf", "Fees-2.pdf")).toBe(false);
  });

  it("a kept file with no path says Flock's reason", () => {
    expect(checkKept({ fileName: "x.pdf", error: "the download failed: canceled" }, "x.pdf")).toEqual({ name: "x.pdf", error: "not downloaded: the download failed: canceled" });
  });
});
