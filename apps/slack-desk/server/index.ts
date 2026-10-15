// slack-desk subprocess ENTRYPOINT.
//
// The platform spawns this with PORT, APP_ID, APP_DATA_DIR and (once paired) FLOCK_API_URL /
// FLOCK_APP_TOKEN injected. Everything below the SDK call is this app's own business — and there
// is almost none of it here, which is the point: the seam, the auth and the env contract are the
// SDK's, so an app author writes an app.

import { createFlockApp } from "@flock/app-sdk";
import { slackDeskHooks } from "./lifecycle";

createFlockApp({ lifecycle: slackDeskHooks }).listen();
