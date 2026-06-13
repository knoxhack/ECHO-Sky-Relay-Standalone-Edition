# ECHO Sky Relay Standalone Edition

Sky Relay Standalone Edition is the ECHO Standalone Runtime packaging lane for
`ECHO: Sky Relay`, Official ECHO Pack #3.

## Role

- Consumes `-standalone.jar` artifacts from `ECHO-Modules`.
- Uses `echoskyrelayprotocol` as the canonical Sky Relay content source.
- Publishes Standalone install, update, repair, and rollback manifests for the ECHO Launcher.
- Proves Sky Relay can run without depending on Minecraft or NeoForge.

## Status

Implementation foundation only. Keep preview-only until standalone runtime loads
Sky Relay data, assets, fragments, save/load, UI, and Signal Crown completion.

## Release Assets

- GitHub prerelease tag: sky-relay-standalone-0.1.0-alpha
- Checked-in payloads: release-assets/sky-relay-standalone-0.1.0-alpha/
- Uploaded assets: sky-relay-standalone-edition-0.1.0.zip, sky-relay-standalone-edition-alpha-0.1.0.pack.json, checksums.txt, echo-release.json, standalone-harness-driver-manifest.template.json, release-manifest.template.json, sky-relay-pack-build-report.json

These files mirror the live GitHub prerelease assets so the source repository has the same release payload shape as Ashfall.
