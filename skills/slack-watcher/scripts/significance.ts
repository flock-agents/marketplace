interface SlackEvent {
  channel?: string;
  user?: string;
  text?: string;
  bot_id?: string | null;
  subtype?: string | null;
  ts?: string;
}

interface WatcherConfig {
  channels?: string[];
  ignoreBots?: boolean;
  keywords?: string;
}

function checkSignificance(event: SlackEvent, config: WatcherConfig): { significant: boolean; reason?: string } {
  if (config.channels && config.channels.length > 0) {
    if (!event.channel || !config.channels.includes(event.channel)) {
      return { significant: false, reason: "channel_not_watched" };
    }
  }

  if (config.ignoreBots !== false) {
    if (event.bot_id) return { significant: false, reason: "bot_message" };
    if (event.subtype === "bot_message") return { significant: false, reason: "bot_subtype" };
  }

  if (config.keywords && config.keywords.trim()) {
    const kwList = config.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (kwList.length > 0) {
      const text = (event.text || "").toLowerCase();
      if (!kwList.some((kw) => text.includes(kw))) {
        return { significant: false, reason: "keyword_no_match" };
      }
    }
  }

  return { significant: true };
}

const event: SlackEvent = JSON.parse(process.env.INGEST_EVENT || "{}");
const config: WatcherConfig = JSON.parse(process.env.ROUTINE_CONFIG || "{}");

const result = checkSignificance(event, config);
console.log(JSON.stringify(result));
process.exit(result.significant ? 0 : 1);
