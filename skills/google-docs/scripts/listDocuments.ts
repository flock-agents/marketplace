import {
  requireBrowserSession,
  crawlUrl,
} from "../../_shared/_google_helpers";

requireBrowserSession();

(async () => {
  const content = await crawlUrl("https://docs.google.com/document/");
  console.log(JSON.stringify({
    source: "browser_session",
    note: "Document list from Google Docs web UI.",
    content,
  }));
})();
