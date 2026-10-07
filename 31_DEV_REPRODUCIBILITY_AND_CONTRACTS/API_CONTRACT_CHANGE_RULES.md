# API / Event Contract Change Rules

Before changing an existing API/event/schema:
1. state why current contract is insufficient;
2. classify additive vs breaking;
3. update OpenAPI/JSON schema;
4. update implementation and tests;
5. add migration/backward-compatibility plan where relevant;
6. create ADR for breaking change;
7. preserve tenant/error non-disclosure semantics.

Do not let generated code silently redefine contracts.
