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

Gameplay evidence must follow `docs/gameplay-evidence.md` and the template at
`fixtures/sky-relay/gameplay-qa/manual-evidence.template.json`.
