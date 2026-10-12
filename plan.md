# Plan: Part 4, Option A: Quarterly Surprise Inspection Selection

## 1. Goal

Build a service that picks a random share of a company's active vehicles each quarter for a surprise inspection.

Requirements from the brief:

| # | Requirement | How we meet it |
|---|---|---|
| R1 | Input: company's active vehicles, a percentage, a quarter | `POST /admin/surprise-inspections { companyId, quarter, percentage }` |
| R2 | Every eligible vehicle has an equal chance | Rank vehicles by a keyed SHA-256 hash and take the top `k` (details in §3) |
| R3 | An auditor can reproduce the result from the same inputs | Store the seed, the algorithm version and a snapshot of all eligible vehicle IDs. A `verify` endpoint and a CLI re-run the pick |
| R4 | A vehicle picked last quarter is still eligible | Eligibility never looks at earlier selections |
| R5 | Running it twice for the same company and quarter must not create a second, different selection | `UNIQUE (company_id, quarter)`, a transaction-scoped advisory lock, and the existing selection returned on re-run |
| R6 | Works for 20 and for 200,000 vehicles | O(n log n) pure function, batched inserts, and a perf test at 200k |

Deliverables: code, tests, README (how to run), a complexity note, and one edge case the brief doesn't mention.

---

## 2. Tech stack

- **Runtime:** Node 22 + TypeScript (strict)
- **Framework:** NestJS (matches the case-study stack)
- **Database:** PostgreSQL 16
- **ORM / migrations:** Prisma. Readable schema, typed queries, raw SQL for the advisory lock
- **Validation:** `class-validator` / `class-transformer` DTOs
- **Tests:** Jest (unit) + Jest with a real Postgres container (integration / e2e via `supertest`)
- **Dev environment:** Docker Compose (api + one Postgres holding a dev and a test database). Hot reload via `nest start --watch`

---

## 3. Selection algorithm (the core)

**Pure function, no I/O:**

```ts
selectVehicles({ vehicleIds, percentage, seed, algorithmVersion }) => {
  eligibleIds,   // sorted, de-duplicated
  selectedIds,   // sorted
  targetCount,
}
```

Steps:
1. **Normalise the input:** de-duplicate the IDs and sort them, so input order can never change the result.
2. **Target count:** `k = ceil(n * percentage / 100)`. Clamp to `[0, n]`. If `n > 0` and `percentage > 0`, then `k >= 1`.
3. **Score each vehicle:** `score = SHA-256(seed + ":" + vehicleId)` (hex string).
4. **Sort by score**, breaking ties by vehicleId (a SHA-256 tie is practically impossible, but this keeps the result fully deterministic). Take the first `k`.

Why this approach:
- **Equal chance:** SHA-256 output behaves like a uniform random value per vehicle, so every k-subset is equally likely. This is a "random sort key" shuffle.
- **Reproducible:** same seed + same eligible set gives the same result on any machine and in any language. An auditor can re-implement it in about 10 lines of Python.
- **Order-independent:** the result depends on the set of IDs, not on DB row order.
- **Seed:** 32 random bytes from `crypto.randomBytes`, generated **once** when the selection is created and stored. A random seed (rather than one derived from company + quarter) means nobody can predict next quarter's pick ahead of time.
- **`algorithm_version`** (e.g. `"sha256-rank-v1"`) is stored, so the algorithm can change later without breaking old audits.

Alternative considered: a seeded PRNG + Fisher–Yates shuffle (O(n)). Rejected because reproducing it depends on the exact PRNG implementation, while a SHA-256 ranking can be re-checked with any standard library.

**Complexity:** time O(n log n) for the sort (hashing is O(n)), space O(n). At 200k vehicles this is well under 1 s. Could drop to O(n log k) with a bounded heap; not needed at this size, and noted in the README.

---

## 4. Database

Based on [database.md](database.md). Only the tables Part 4 needs are implemented.

| Table | Used for | Changes vs database.md |
|---|---|---|
| `companies` | tenant, `min_surprise_inspection_threshold` | none |
| `users` | `triggered_by`, audit logs | `role` has one value, `admin`; `company_id` nullable |
| `vehicles` | eligibility source (`is_deleted = false`; inactive vehicles count) | index `(company_id, is_deleted)` |
| `surprise_inspections` | one row per company + quarter | **add** `seed`, `eligible_count`, `selected_count` |
| `surprise_inspections_vehicles` | snapshot of **every eligible** vehicle, with `is_selected` true/false | **add** `UNIQUE (surprise_inspection_id, vehicle_id)` (replaces the plain index) |
| `audit_logs` | `surprise_inspection.created`, `surprise_inspection.verified` | none |

Notes:
- `seed` moves onto `surprise_inspections`. It is a property of the selection run; `inspections.seed` in database.md looks misplaced and is flagged in the README.
- Storing the full eligible snapshot (not only the picked vehicles) is what makes the audit possible. Vehicles change after the run (added, deleted, deactivated); the snapshot keeps the original input.
- `garages` and `inspections` are out of scope for Part 4. Creating the actual inspection bookings is mentioned as a follow-up.

---

## 5. Idempotency & concurrency (R5)

Inside one transaction:
1. `SELECT pg_advisory_xact_lock(hashtext(companyId || ':' || quarter))`: serialises concurrent requests for the same company + quarter.
2. If a `surprise_inspections` row already exists → return it (HTTP 200), **even if the request used a different percentage**. The response says it already existed. A different percentage does not trigger a new pick (documented decision).
3. Otherwise: load the eligible vehicles → run the pure function → insert the header row → batch-insert snapshot rows (chunks of about 5,000) → write the audit log → commit (HTTP 201).
4. `UNIQUE (company_id, quarter)` is the last line of defence if the lock is ever bypassed.

---

## 6. API

Only an **admin** can trigger surprise inspections, so every route lives under `/admin` and `companyId` is sent in the request.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin/surprise-inspections` | Body `{ companyId, quarter: "2026-Q4", percentage: 25 }`. Creates the selection, or returns the existing one |
| `GET` | `/admin/surprise-inspections?companyId=…&quarter=…` | Selection details: seed, algorithm version, counts, selected vehicles |
| `GET` | `/admin/surprise-inspections/verify?companyId=…&quarter=…` | Re-runs the algorithm on the stored snapshot + seed. Returns `{ reproducible: true/false }` |

Auth for Part 4 is **HTTP Basic auth with one fixed admin account**, kept deliberately simple:
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `docker/.envs/app.env`, compared in constant time
- A global `BasicAuthGuard` checks the credentials, then loads the admin's `users` row (created by the seed) so `triggered_by` and audit logs record who acted
- Real auth (JWT/Cognito, sessions) is out of scope and noted in the README

Validation rules:
- `quarter` matches `^\d{4}-Q[1-4]$`. Must not be a future quarter.
- `percentage` is a number with `0 < percentage <= 100`, and `>= company.min_surprise_inspection_threshold`.

---

## 7. Project structure

Three top-level folders, each with one job:

| Folder | Contains |
|---|---|
| `docker/` | Everything to run the project locally: compose file, Dockerfiles, Postgres init |
| `codes/` | The NestJS application: source, Prisma schema, tests, scripts |
| `deployments/` | Empty for now, holds only a `.gitignore`. Reserved for AWS deployment later |

```
.
├── Makefile                          # short aliases, all run from the repo root
├── README.md
├── plan.md
├── database.md
│
├── docker/
│   ├── docker-compose.yml            # api + db (dev and test databases)
│   ├── api.Dockerfile                # dev image (node:22-alpine, hot reload)
│   ├── postgres/
│   │   └── create-test-db.sh         # creates the <POSTGRES_DB>_test database
│   ├── .envs/app.env.example         # template for .envs/app.env (git-ignored)
│   ├── .envs/db.env.example          # template for .envs/db.env: Postgres credentials (git-ignored)
│   └── .env.example                  # template for docker/.env: host ports (git-ignored)
│
├── codes/
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts                   # demo companies, users, vehicles (+ optional 200k fleet)
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── prisma/                   # PrismaService
│   │   ├── auth/                     # fixed-admin Basic auth guard, @CurrentUser
│   │   ├── common/quarter.ts         # parse / validate / compare quarters
│   │   ├── */interfaces/             # one interface per file (*.interface.ts)
│   │   └── surprise-inspections/
│   │       ├── selection/
│   │       │   ├── select-vehicles.ts        # PURE algorithm
│   │       │   └── select-vehicles.spec.ts
│   │       ├── dto/
│   │       ├── surprise-inspections.controller.ts
│   │       ├── surprise-inspections.service.ts
│   │       └── surprise-inspections.repository.ts
│   ├── scripts/verify-selection.ts   # auditor CLI: seed + ids file → selected ids
│   └── test/                         # e2e / integration (real Postgres)
│
└── deployments/
    └── .gitignore                    # placeholder, nothing else for now
```

---

## 8. Tests

**Unit (pure algorithm):**
- [ ] Same inputs → identical output (determinism)
- [ ] Shuffled input order → identical output
- [ ] Duplicate IDs are ignored
- [ ] `k` rounding: 25% of 20 = 5, 25% of 3 = 1, 100% = all, 0 vehicles = empty
- [ ] Different seed → (almost certainly) different selection
- [ ] **Fairness:** run 20,000 seeds over 20 vehicles at 25%, chi-square test that pick frequencies are uniform
- [ ] **Scale:** 200,000 vehicles finishes in under ~2 s
- [ ] Known-answer test: a fixed seed + ids → hard-coded expected output (guards against accidental algorithm changes)

**Unit (quarter helper):** parsing, invalid formats, future-quarter detection.

**Integration / e2e (real Postgres in Docker):**
- [ ] Create → 201, correct counts, snapshot rows = eligible count
- [ ] Second call → 200 with the **same** selection, no new rows
- [ ] 10 concurrent POSTs → exactly one selection exists
- [ ] Inactive vehicles are eligible; soft-deleted vehicles are excluded
- [ ] A vehicle picked in Q3 can be picked in Q4
- [ ] `verify` returns `reproducible: true`, still true after vehicles change post-run
- [ ] A selection only contains the requested company's vehicles; wrong credentials → 401
- [ ] Percentage below the company threshold → 400
- [ ] 200k-vehicle company end-to-end (tagged `slow`)

---

## 9. Docker dev setup

All Docker files live in `docker/`. The compose file mounts `../codes` into the container, so code edits hot-reload. The `Makefile` at the repo root wraps `docker compose -f docker/docker-compose.yml ...`, so nobody has to remember the path.

- `make up` → Postgres on 5432 + API on 3000 with hot reload
- `make migrate` / `make seed` → apply Prisma migrations / load demo data
- `make test` → unit tests
- `make test-e2e` → integration tests against the `<POSTGRES_DB>_test` database
- `make down` → stop everything

---

## 10. Edge cases to document in the README

The brief asks for one; the README will lead with the first and list the others.

1. **Fleet changes after the pick.** Vehicles added, deleted or deactivated after the selection would make a naive re-run give a different answer. Fix: store the full eligible snapshot and verify against that, not the live table.
2. **Rounding on small fleets.** 25% of 3 vehicles = 0.75. `floor` would pick nobody. We use `ceil`, so any non-empty fleet gets at least one vehicle.
3. **Re-run with a different percentage.** We return the original selection unchanged instead of re-picking. Re-picking would let someone fish for a convenient result.
4. **Company with 0 eligible vehicles.** A selection is still recorded (empty), so the quarter shows as "done" and auditable.
5. **Concurrent triggers** (two admins clicking at the same time). Handled by the advisory lock + unique constraint.

---

## 11. Implementation order

1. [x] Create `docker/`, `codes/`, `deployments/` and the root `Makefile`
2. [x] Scaffold NestJS in `codes/`: strict TS, Prettier
3. [x] `docker/`: dev Dockerfile, docker-compose (api, db with a separate test database), `.envs/app.env`
4. [x] Prisma schema + first migration (tables from §4)
5. [x] Pure `selectVehicles` + quarter helper, with full unit tests (TDD)
6. [x] Repository + service (transaction, advisory lock, batched insert, audit log)
7. [x] DTOs, validation, fixed-admin Basic auth guard, controller
8. [x] Verify endpoint + auditor CLI script
9. [x] Seed script (20 and 200k vehicles)
10. [x] Integration / e2e tests incl. concurrency + tenant isolation
11. [x] `deployments/`: add `.gitignore` only
12. [x] README: setup, migrations + seed data (with demo logins), run, test, API examples, complexity note, edge case, assumptions
