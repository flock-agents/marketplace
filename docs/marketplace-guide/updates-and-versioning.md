# Updates & Versioning

## How Updates Work

Flock checks for updates by comparing the installed version against the `latestVersion` in `catalog.json` using semver comparison.

1. Flock fetches `catalog.json` periodically
2. For each installed package, it compares the local version with `latestVersion`
3. If a newer version is available, the user sees an update prompt
4. On update, Flock fetches the tagged version and replaces the local copy

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **Major** (2.0.0): Breaking changes — different manifest schema, removed functions, changed behavior
- **Minor** (1.1.0): New features — added functions, new capabilities, expanded config options
- **Patch** (1.0.1): Bug fixes — fixed scripts, corrected instructions, typo fixes

### Examples

| Change | Version Bump |
|--------|-------------|
| Fix a typo in instructions.md | Patch (1.0.0 → 1.0.1) |
| Add a new function to a skill | Minor (1.0.1 → 1.1.0) |
| Rename a function or change params | Major (1.1.0 → 2.0.0) |
| Update a script to handle edge cases | Patch |
| Add a new connection method | Minor |
| Change the manifest schema | Major |

## Publishing an Update

```bash
# 1. Make your changes
# 2. Update version in flock.skill.json / flock.app.json
# 3. Update catalog.json: latestVersion, latestTag, updatedAt
# 4. Commit
git add .
git commit -m "my-skill v1.1.0: add search function"

# 5. Tag
git tag my-skill-v1.1.0

# 6. Push
git push origin main --tags
```

## Checksum-Based Modification Detection

Flock computes a checksum of each installed package's files at install time. On update:

1. Flock computes the current checksum of the installed files
2. If the checksum matches the install-time checksum, the update proceeds normally
3. If the checksum differs (user modified files locally), Flock warns the user

### Force Update

If the user has modified files locally and wants the marketplace version:

- Flock prompts: "This skill has been modified locally. Update anyway? Local changes will be lost."
- Force update replaces all files with the marketplace version
- There is no merge — it's a full replacement

### Preserving Local Modifications

If the user wants to keep their changes:

- Skip the update — local modifications are preserved
- Or: back up the modified files, update, then re-apply changes manually

## Data-Safe Uninstall

When a skill or app is uninstalled:

- **Code files are removed** — scripts, instructions, manifest
- **Data is preserved** — anything in `$APP_DATA_DIR` stays
- **Connections are not deleted** — browser sessions and API keys remain configured
- **Re-installing restores access** to preserved data

## Backward Compatibility Guidelines

When publishing updates:

1. **Don't remove functions** in minor/patch versions — deprecate first, remove in the next major
2. **Don't change function signatures** in minor/patch — add new optional params instead
3. **Don't rename the slug** — this breaks existing installations
4. **Keep the manifest schema stable** — add new fields, don't remove or rename existing ones
5. **Test with the minimum Flock version** you declare — don't use features from newer versions

## Catalog Update Checklist

When bumping a version, update these fields in `catalog.json`:

- `latestVersion`: new version string
- `latestTag`: new tag name (e.g., `my-skill-v1.1.0`)
- `updatedAt`: current UTC timestamp
- Top-level `updatedAt`: current UTC timestamp (so Flock knows the catalog changed)
