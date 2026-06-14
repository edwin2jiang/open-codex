# Upstream Compatibility Policy

## Supported surface

Open Codex depends on the documented stable surface of `codex app-server`.
Experimental capabilities are disabled by default.

## Version policy

- Record the exact runtime version for each session.
- Generate protocol types from that runtime during development.
- Test the newest stable Codex release and one previous stable release.
- Alpha builds may support newer prerelease builds on a best-effort basis.
- Block turns when the runtime is known incompatible; diagnostics may still run.

## Upgrade procedure

1. Read upstream release notes and app-server changes.
2. Generate stable TypeScript and JSON Schema outputs for old and new versions.
3. Diff methods, fields, enums, and server-initiated requests.
4. Update adapter mappings without changing the Open Codex event contract when
   possible.
5. Add fixtures for new or changed behavior.
6. Run approval, interruption, resume, and error contract suites.
7. Run the fixed real-task suite.
8. Update the support matrix and release notes.

## Compatibility behavior

- Added notification: persist as raw, then add a mapping.
- Added optional field: ignore safely until mapped.
- Added enum variant: display as unknown, never crash.
- Added server request: show generic approval and fail closed.
- Removed/renamed stable method: mark version unsupported until adapted.
- Experimental change: no support guarantee.

## Upstream pinning

Open Codex currently requires a separately installed runtime. If Codex binaries
are bundled later, the repository will pin release URL, checksum, license, and
NOTICE metadata per platform in a reviewed lock file.
