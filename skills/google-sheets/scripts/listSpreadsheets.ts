import { requireBrowserSession, crawlUrl } from "../../_shared/_google_helpers";

async function main() {
  requireBrowserSession();

  const content = await crawlUrl("https://docs.google.com/spreadsheets/");
  console.log(JSON.stringify({
    source: "browser_session",
    note: "Spreadsheet list from Google Sheets web UI.",
    content,
  }));
}

main();
