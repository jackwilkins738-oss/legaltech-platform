# V110 Support diagnostics

V110 adds a bounded diagnostic snapshot for JIT support. It requires the exact existing `DIAGNOSTIC_READ` support scope, uses a strict allowlist of operational state fields, rejects arbitrary provider data, and records only hashed evidence. It is not a log export, shell, database browser, matter viewer or support back door.
