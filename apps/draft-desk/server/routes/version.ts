import { Hono } from "hono";
import { BUILD_VERSION } from "../services/buildVersion";

// Public, non-secret endpoint: the version of the CURRENTLY deployed build. The client polls it
// to detect a new deploy and auto-reload. No auth — the value is safe to expose.
const version = new Hono();

version.get("/", (c) => c.json({ version: BUILD_VERSION }));

export default version;
