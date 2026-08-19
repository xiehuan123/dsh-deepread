# Community listing update for `1.0.0-rc.1`

This is a prepared metadata update for community catalog maintainers. Do not submit it until the `v1.0.0-rc.1` tag and npm prerelease exist after DR-210.

## Listing fields

| Field | Proposed value |
| --- | --- |
| Package | `dsh-deepread` |
| Version | `1.0.0-rc.1` (prerelease) |
| Summary | Evidence-first deep reading Host tool and packaged skill; optional DeepSeek Harness Web reading UI |
| Repository | https://github.com/xiehuan123/dsh-deepread |
| npm version | https://www.npmjs.com/package/dsh-deepread/v/1.0.0-rc.1 |
| English README | https://github.com/xiehuan123/dsh-deepread/blob/v1.0.0-rc.1/README.md |
| Chinese README | https://github.com/xiehuan123/dsh-deepread/blob/v1.0.0-rc.1/README.zh.md |
| v0.15 manifest | https://github.com/xiehuan123/dsh-deepread/blob/v1.0.0-rc.1/dsh-plugin.json |
| Release notes | https://github.com/xiehuan123/dsh-deepread/blob/v1.0.0-rc.1/docs/releases/1.0.0-rc.1.md |

## Compatibility copy

Minimum dsh-TUI version: `0.8.1`. The package ships a Host-only Community Consensus v0.15 manifest and a packaged skill. Its `lib/client.js` export is optional DeepSeek Harness Web UI, not a dsh-TUI client facet. Node.js `^22.19 || >=24` is required.

DeepSeek Harness Web and headless compatibility starts at `0.1.0-rc.7`. Web loads the browser client; headless and dsh-TUI do not. The npm package, repository, and manifest links above must replace any listing that still points to the `0.5.4` root `index.mjs` layout or describes the whole plugin as a legacy bundle/client pair.

## Submission checklist

- Wait until the tag and npm URL resolve; this document does not claim they exist yet.
- Copy metadata from the tagged `package.json` and `dsh-plugin.json`, not from a working tree.
- Keep the existing Awesome DSH Plugin project URL unless that catalog requests a version-specific link.
- Link the upgrade guide when the catalog supports release notes or migration fields.
