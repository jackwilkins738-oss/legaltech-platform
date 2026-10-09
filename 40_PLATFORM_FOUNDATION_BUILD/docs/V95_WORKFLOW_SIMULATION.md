# V95 — Synthetic workflow simulation and impact preview

V95 adds a side-effect-free simulator for the same bounded workflow definitions used by V65. It validates the production graph, evaluates deterministic branches over an explicitly synthetic scenario, and projects work/notification effects without creating work, sending notifications, touching matters or scheduling timers.

Simulation stops at signals/delays and returns hashes rather than the scenario context. A caller-supplied synthetic-data validator must approve the scenario before evaluation. Two simulations with the same synthetic context can be compared to identify path/effect changes before a configuration bundle is activated.

This is intended for post-TO design validation and release review. It is not a legal outcome simulator and it must not be supplied real client data.
