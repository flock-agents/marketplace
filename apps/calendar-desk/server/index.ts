// calendar-desk subprocess ENTRYPOINT. The platform injects PORT, APP_ID, APP_DATA_DIR and, once
// paired, FLOCK_API_URL / FLOCK_APP_TOKEN / FLOCK_WEBHOOK_SECRET. Everything below the SDK call is
// this app's own: the lifecycle hooks, the operations the agent may call, the widget route, and the
// minute loop.
import { createFlockApp } from "@flock/app-sdk";
import { calendarDeskHooks } from "./lifecycle";
import { ops } from "./ops";
import { widgetRoutes } from "./widget";
import { startMinuteLoop } from "./scheduler";

const flock = createFlockApp({ lifecycle: calendarDeskHooks, ops });
// The linked SDK resolves its own hono copy; the types differ nominally, the runtime is one Hono.
flock.hono.route("/", widgetRoutes as never);
flock.listen();
startMinuteLoop(flock.platform);
