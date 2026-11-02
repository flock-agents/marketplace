# Changelog

## 1.0.1

- Runs without Python: the server is now a dependency-free JavaScript port that Flock starts with its bundled Node (`npx`). Clean machines failed to sign in with "python not found". Tools, outputs and the token cache are unchanged.

## 1.0.0

- First release: Zepp / Amazfit daily activity, workouts, sleep, heart rate, body composition and PAI, through a JavaScript port of the `zepp-mcp` server (MIT) that Flock runs with its bundled Node: nothing to install, no Python.
- One skill holds several accounts. Each account signs in with its own Zepp email and password and keeps its own token cache.
