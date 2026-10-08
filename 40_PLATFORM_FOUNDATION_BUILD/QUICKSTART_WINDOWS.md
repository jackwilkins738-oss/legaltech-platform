# Windows quick start — synthetic local application

## Requirement
Node.js 22 or newer. No npm dependencies need to be installed for the current build.

## Fastest route
1. Extract the master repository ZIP.
2. Open `40_PLATFORM_FOUNDATION_BUILD`.
3. Double-click `RUN_LOCAL_APP.bat`.
4. Your browser opens `http://127.0.0.1:3210`.
5. Use **Generate demo item**.
6. Open **Exceptions**, select a synthetic matter, then approve or reject.
7. Open **Audit** to see the resulting events.

## Stop
Close the terminal window or press `Ctrl+C`.

## Reset synthetic state
Double-click `RESET_LOCAL_APP.bat`.

## Important
This is a local synthetic development build. Do not expose port 3210 publicly and do not put real client data into it. The development bearer token is intentionally static and is not a production authentication design.

## Command-line opt-in
The synthetic server now requires `LEGALTECH_ENABLE_SYNTHETIC_DEV_SERVER=true`. `RUN_LOCAL_APP.bat` sets this automatically. This prevents an accidental shared/staging launch from silently enabling the static development bearer token.
