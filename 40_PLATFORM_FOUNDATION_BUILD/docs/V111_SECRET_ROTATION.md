# V111 Managed secret rotation evidence

V111 records secret lifecycle metadata without persisting secret material or raw secret references. Generations are exact and monotonic, activation is dual-control, superseded generations become retiring, and revocation requires evidence. The connector credential broker can optionally enforce the active generation at use time.
