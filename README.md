# FleetCheck: Quarterly Surprise Inspection Selection

Part 4, **Option A** of the Audacity engineering case study.

Each quarter, a share of each company's active vehicles is picked at random for a surprise inspection. Every eligible vehicle has an equal chance. An auditor can reproduce any pick later from the stored inputs. Running the pick twice for the same company and quarter never produces a second, different selection. It works for 20 vehicles and for 200,000.

**Stack:** NestJS · PostgreSQL 16 · Prisma · Jest · Docker Compose

---

## Contents

1. [Quick start](#quick-start)
2. [Environment variables](#environment-variables)
3. [Migrations and seed data](#migrations-and-seed-data)
4. [Authentication](#authentication)
5. [API](#api)
6. [Running the tests](#running-the-tests)
7. [How the selection works](#how-the-selection-works)
8. [Time and space complexity](#time-and-space-complexity)
9. [Reproducing a selection as an auditor](#reproducing-a-selection-as-an-auditor)
10. [Design decisions and assumptions](#design-decisions-and-assumptions)
11. [Project structure](#project-structure)

---

## Quick start

Requirements: Docker (with Compose v2) and `make`. Node does not need to be installed on your machine.

```bash
make build   # builds the API image
make up      # starts Postgres + API, applies migrations
make seed    # loads demo companies, users and vehicles
curl --location 'http://localhost:3000/health' \
  --request GET
# {"status":"ok"}
```

The first `make up` installs npm packages inside the container, which takes a minute or two. The API runs with hot reload: edit anything under `codes/` and it restarts.

| Command | What it does |
|---|---|
| `make build` | Build the API image. Run it once at the start, and again after changing `docker/api.Dockerfile` or `docker/api-entrypoint.sh` |
| `make up` / `make down` | Start / stop Postgres and the API (data is kept in a Docker volume). `up` doesn't rebuild the image |
| `make clean` | Stop everything and **delete the database volume** (needed after changing `db.env`) |
| `make logs` | Follow API logs |
| `make migrate` | Apply pending migrations |
| `make migration name=add_x` | Create a new migration after editing `schema.prisma` |
| `make seed` | **Wipe** the dev database and load demo data |
| `make seed-large` | Same, plus a company with 200,000 vehicles |
| `make reset` | Drop the dev database, re-run all migrations, then seed |
| `make test` | Unit tests |
| `make test-e2e` | Integration tests against a real Postgres (`<POSTGRES_DB>_test` database, `fleetcheck_test` by default) |
| `make test-slow` | Integration tests including the 200,000-vehicle run |
| `make verify args="..."` | Auditor CLI, see [below](#reproducing-a-selection-as-an-auditor) |
| `make psql` | Open `psql` on the dev database |

All settings live in env files; see [Environment variables](#environment-variables).

---

## Environment variables

There are three env files. Each one is git-ignored, and the first `make` command creates it from its committed `.example` template. Edit them freely afterwards; `make` never overwrites an existing file.

| Key | File | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | `docker/.envs/db.env` | `fleetcheck` | Postgres username. The db container creates it on first start; the API connects with it |
| `POSTGRES_PASSWORD` | `docker/.envs/db.env` | `fleetcheck` | Password for `POSTGRES_USER`. Letters and digits only, because it's placed in the database URL unescaped |
| `POSTGRES_DB` | `docker/.envs/db.env` | `fleetcheck` | Dev database name. The e2e test database is named `<POSTGRES_DB>_test` (`fleetcheck_test`) |
| `ADMIN_EMAIL` | `docker/.envs/app.env` | `admin@fleetcheck.test` | Username for the admin Basic auth login. `make seed` creates a user with this email, recorded as `triggered_by` on selections |
| `ADMIN_PASSWORD` | `docker/.envs/app.env` | `password123` | Password for the admin Basic auth login |
| `APP_PORT` | `docker/.env` | `3000` | Port the API listens on inside the container (passed to the app as `PORT`) |
| `LOCAL_PORT` | `docker/.env` | `3000` | Port on your machine that forwards to `APP_PORT`. Open the API at `http://localhost:<LOCAL_PORT>` |
| `DB_PORT` | `docker/.env` | `5432` | Port on your machine that forwards to Postgres, for a local database client |

Two more variables are **built automatically**, so don't set them yourself. The API's entrypoint ([api-entrypoint.sh](docker/api-entrypoint.sh)) derives them from `db.env`:

| Key | Value | Used for |
|---|---|---|
| `DATABASE_URL` | `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>` | The app, migrations and seed |
| `TEST_DATABASE_URL` | `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>_test` | `make test-e2e` (the tests wipe this database) |

They're set for the running app and for every `make` command. They're not set in a plain `docker compose exec api` shell, so use `make shell` instead.

**Who reads which file:**
- `db.env`: the Postgres and API containers
- `app.env`: the API container
- `docker/.env`: Docker Compose itself, to fill in the ports in `docker-compose.yml`

**Changing settings:**
- `app.env` or `docker/.env`: run `make up` to restart with the new values.
- `db.env`: Postgres only reads the credentials when its volume is first created, so run `make clean && make up && make seed`. **`make clean` deletes the database.**

---

## Migrations and seed data

### Migrations

Migrations live in [codes/prisma/migrations](codes/prisma/migrations) and are generated from [codes/prisma/schema.prisma](codes/prisma/schema.prisma). `make up` applies them automatically on start; `make migrate` applies them by hand.

The migrations create every table from [database.md](database.md), with a few additions, listed below.

| Table | Change vs database.md | Why |
|---|---|---|
| `users` | `role` has one value, `admin`; `company_id` nullable | Only admins trigger surprise inspections, and an admin isn't tied to one company |
| `vehicles` | added index `(company_id, is_deleted)` | Loading the eligible vehicles for a company is the hot query |
| `surprise_inspections` | added `seed`, `eligible_count`, `selected_count` | The seed is the input an auditor needs; the counts are cross-checks |
| `surprise_inspections_vehicles` | index `(surprise_inspection_id, vehicle_id)` made **unique** | A vehicle can appear in a selection's snapshot only once |
| `surprise_inspections_vehicles` | added `inspection_id` (unique, FK to `inspections`) | Links each picked vehicle to the inspection created for it; empty for vehicles that weren't picked |
| `inspections` | `seed` column dropped | The seed belongs to the selection run, not to a single inspection booking |

All ids are UUIDs generated by Postgres (`gen_random_uuid()`).

### Seed data

`make seed` **deletes all existing data** and loads:

| Company | Id | Vehicles | Min. percentage |
|---|---|---|---|
| Swift Logistics | `11111111-1111-4111-8111-111111111111` | 20 (19 eligible: 1 inactive, which still counts; 1 soft-deleted, which doesn't) | 10% |
| Northern Haulage | `22222222-2222-4222-8222-222222222222` | 8 (all eligible) | 5% |
| Mega Freight *(only with `make seed-large`)* | `33333333-3333-4333-8333-333333333333` | 200,000 | 5% |

It also creates:
- the **admin user** (email = `ADMIN_EMAIL` from `app.env`), recorded as `triggered_by` on every selection
- two garages
- a **2026-Q3 selection for Swift Logistics** (25%), made with the real algorithm, so the read and verify endpoints work straight away. Its 5 inspections are already marked completed at a garage: 1 failed, 4 passed

---

## Authentication

Only an **admin** can trigger surprise inspections, so the API uses HTTP **Basic auth with one fixed admin account**, kept deliberately simple for this assignment:

- The credentials are `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `docker/.envs/app.env` (defaults: `admin@fleetcheck.test` / `password123`).
- Send `Authorization: Basic base64(ADMIN_EMAIL:ADMIN_PASSWORD)` on every request. With the default credentials that's `Authorization: Basic YWRtaW5AZmxlZXRjaGVjay50ZXN0OnBhc3N3b3JkMTIz`.
- To build the header for other credentials, run `printf '%s' 'email:password' | base64`.
- The examples send this header explicitly rather than using curl's `-u email:password` shortcut. `-u` builds exactly the same header, but writing it out shows what actually goes over the wire, and the commands import into Postman and other HTTP clients unchanged.
- The guard compares both values in constant time, so response timing doesn't reveal how close a guess was. A wrong username or password returns `401`.
- After a successful check, the guard loads the admin's `users` row, so selections and audit logs record who acted (`triggered_by`, `audit_logs.user_id`). If that row is missing, run `make seed`.
- A global guard ([basic-auth.guard.ts](codes/src/auth/basic-auth.guard.ts)) protects every route except `GET /health`.

In production this would be replaced by real user accounts with token-based auth (e.g. Cognito/JWT), per-role permissions and rate limiting on login.

---

## API

Base URL: `http://localhost:3000`. All `/admin/*` routes require the admin credentials.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check (no login) |
| `POST` | `/admin/surprise-inspections` | Create the quarter's selection for a company, or return the existing one |
| `GET` | `/admin/surprise-inspections?companyId=…&quarter=…` | Read a selection |
| `GET` | `/admin/surprise-inspections/verify?companyId=…&quarter=…` | Re-run the algorithm on the stored inputs and check it matches |

### Create a selection

```bash
curl --location 'http://localhost:3000/admin/surprise-inspections' \
  --request POST \
  --header 'Authorization: Basic YWRtaW5AZmxlZXRjaGVjay50ZXN0OnBhc3N3b3JkMTIz' \
  --header 'Content-Type: application/json' \
  --data '{
    "companyId": "11111111-1111-4111-8111-111111111111",
    "quarter": "2026-Q4",
    "percentage": 25
  }'
```

```json
{
  "created": true,
  "selection": {
    "id": "a6637cdd-…",
    "companyId": "11111111-1111-4111-8111-111111111111",
    "quarter": "2026-Q4",
    "percentage": 25,
    "algorithmVersion": "sha256-rank-v1",
    "seed": "6ad133ff083bc5f6…",
    "eligibleCount": 19,
    "selectedCount": 5,
    "triggeredBy": "7aa3e6be-…",
    "createdAt": "2026-10-12T15:49:03.819Z",
    "selectedVehicles": [
      {
        "id": "b8c7ccea-…",
        "registrationNo": "SWF-005",
        "inspection": { "id": "03f23565-…", "status": "pending", "result": null }
      },
      "…"
    ]
  }
}
```

- **201** with `"created": true` when a new selection is made. A pending surprise inspection is created for each picked vehicle and returned with it.
- **200** with `"created": false` and the *original* selection when one already exists for that company and quarter, even if the request asks for a different percentage.

Request rules:

| Field | Rule |
|---|---|
| `companyId` | UUID of an existing company |
| `quarter` | `YYYY-Qn` (e.g. `2026-Q4`); the current or a past quarter, never a future one |
| `percentage` | number, `0 < percentage ≤ 100`, at most 2 decimal places, at least the company's `min_surprise_inspection_threshold` |

Any other field (e.g. a client-supplied `seed`) is rejected with `400`.

### Read and verify

Both take `companyId` and `quarter` as query parameters:

```bash
curl --location 'http://localhost:3000/admin/surprise-inspections?companyId=11111111-1111-4111-8111-111111111111&quarter=2026-Q3' \
  --request GET \
  --header 'Authorization: Basic YWRtaW5AZmxlZXRjaGVjay50ZXN0OnBhc3N3b3JkMTIz'

curl --location 'http://localhost:3000/admin/surprise-inspections/verify?companyId=11111111-1111-4111-8111-111111111111&quarter=2026-Q3' \
  --request GET \
  --header 'Authorization: Basic YWRtaW5AZmxlZXRjaGVjay50ZXN0OnBhc3N3b3JkMTIz'
```

```json
{
  "reproducible": true,
  "quarter": "2026-Q3",
  "algorithmVersion": "sha256-rank-v1",
  "seed": "bab1560d…",
  "percentage": 25,
  "eligibleCount": 19,
  "storedSelectedCount": 5,
  "recomputedSelectedCount": 5
}
```

### Errors

| Status | When |
|---|---|
| 400 | Invalid or missing `companyId`, `quarter` or `percentage`; future quarter; percentage below the company's minimum; inactive company |
| 401 | Missing or wrong admin credentials |
| 404 | Unknown company, or no selection for that quarter |

---

## Running the tests

```bash
make test        # unit tests (algorithm + quarter helper), about 2 s
make test-e2e    # API + database integration tests, about 4 s
make test-slow   # also runs the 200,000-vehicle end-to-end test, about 15 s
```

The e2e tests run the real NestJS app against the separate `<POSTGRES_DB>_test` database (`fleetcheck_test` by default), which they wipe between tests. Your dev data is never touched.

**Unit tests** ([select-vehicles.spec.ts](codes/src/surprise-inspections/selection/select-vehicles.spec.ts)):
- Same inputs give the same output; input order and duplicate ids don't matter
- A different seed gives a different selection
- Rounding: 25% of 20 = 5, 25% of 3 = 1, 0 vehicles = empty, and a floating-point trap case
- **Fairness:** 20,000 runs over 20 vehicles, with a chi-square test that every vehicle is picked equally often
- **Known answer:** the expected output was computed separately with Python's `hashlib`, so the TypeScript code is checked against an independent implementation
- 200,000 vehicles are selected in well under 3 seconds

**Integration tests** ([surprise-inspections.e2e-spec.ts](codes/test/surprise-inspections.e2e-spec.ts)):
- Inactive vehicles are eligible and soft-deleted ones aren't; the snapshot holds every eligible vehicle
- Every picked vehicle gets exactly one pending surprise inspection, linked from the snapshot; re-runs and concurrent requests don't create extra inspections
- Running it twice returns the same selection, with no new rows
- **10 concurrent requests create exactly one selection**
- A vehicle picked last quarter can be picked again this quarter
- Verify still passes after vehicles are deleted, deactivated or added post-run
- Verify **detects tampering** with the stored selection
- Selections only ever contain the requested company's vehicles
- Auth failures (no credentials, wrong username, wrong password) and the admin recorded as `triggered_by`
- Validation rules (missing or invalid `companyId`, quarter, percentage) and the company's minimum percentage

---

## How the selection works

The core is a pure function with no I/O: [select-vehicles.ts](codes/src/surprise-inspections/selection/select-vehicles.ts).

1. De-duplicate and sort the eligible vehicle ids, so input order can never change the result.
2. `k = ceil(n × percentage / 100)`, calculated in whole basis points to avoid floating-point errors.
3. Give each vehicle a score: `SHA-256(seed + ":" + vehicleId)`.
4. Sort by score (ties broken by id) and pick the first `k`.

**Why this is fair.** SHA-256 output behaves like an independent uniform random number for each vehicle, so sorting by it is a random shuffle. Every vehicle, and every set of `k` vehicles, is equally likely. The chi-square unit test checks this empirically.

**Why it is reproducible.** The result depends only on the seed, the percentage and the *set* of eligible ids. All three are stored, so anyone can re-run it in any language with a standard SHA-256 library.

**Where the seed comes from.** 32 random bytes from `crypto.randomBytes`, generated once when the selection is created. It is not derived from the company and quarter. A derived seed would let anyone work out next quarter's pick in advance, and clients can't supply their own seed to fish for a convenient result.

**How duplicate runs are prevented.** Everything happens in one database transaction:

1. `pg_advisory_xact_lock` on `(company, quarter)`. A second, simultaneous request waits here.
2. If a selection already exists, return it.
3. Otherwise load the eligible vehicles and run the algorithm. Then save:
   - the selection
   - a **pending surprise inspection** in `inspections` for every picked vehicle (`type = surprise`, no garage or result yet)
   - a snapshot of **every** eligible vehicle (with `is_selected` true or false, and `inspection_id` for the picked ones)
   - an audit log entry

The `UNIQUE (company_id, quarter)` constraint backs this up: if a duplicate ever gets past the lock, the service catches the violation and returns the selection that won.

`algorithm_version` (`sha256-rank-v1`) is stored with each selection, so the algorithm can change in future without breaking verification of old selections.

---

## Time and space complexity

For `n` eligible vehicles:

| Step | Time | Space |
|---|---|---|
| De-duplicate + sort ids | O(n log n) | O(n) |
| Hash every id | O(n) | O(n) |
| Sort by score, take `k` | O(n log n) | O(n) |
| **Algorithm total** | **O(n log n)** | **O(n)** |
| Save snapshot (batches of 5,000 rows) | O(n) rows written | O(n) rows stored |

Measured on a laptop with 200,000 vehicles:

| Operation | Time |
|---|---|
| Algorithm only (hash + sort) | ~0.3 s |
| `POST` (load vehicles, select, write 200,000 snapshot rows) | ~7 s |
| `GET …/verify` (load snapshot, re-run, compare) | ~0.7 s |

Writing the snapshot is most of the `POST` time. This runs once per company per quarter, so it's acceptable. If it ever became a problem, a raw `INSERT … SELECT unnest(...)` or `COPY` would be several times faster than Prisma's `createMany`.

Possible optimisation if fleets grow much larger: keep a bounded max-heap of the `k` lowest scores to get O(n log k) time and O(k) extra space. It isn't needed at 200,000.

---

## Reproducing a selection as an auditor

The `verify` endpoint does this inside the app. An auditor who doesn't want to trust our code can reproduce it independently.

**1. Export the stored inputs** (run from the repo root):

```bash
# runs SQL from stdin with the credentials from db.env
db() { docker compose -f docker/docker-compose.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'; }
COMPANY=11111111-1111-4111-8111-111111111111
QUARTER=2026-Q3

# the seed and percentage
echo "SELECT seed, percentage FROM surprise_inspections WHERE company_id = '$COMPANY' AND quarter = '$QUARTER'" | db

# the eligible snapshot, one id per line
echo "SELECT siv.vehicle_id FROM surprise_inspections_vehicles siv
      JOIN surprise_inspections si ON si.id = siv.surprise_inspection_id
      WHERE si.company_id = '$COMPANY' AND si.quarter = '$QUARTER'" | db > codes/eligible-ids.txt
```

**2a. Re-run with our CLI** (paths are relative to `codes/`, which is mounted into the container):

```bash
make verify args="--seed <seed> --percentage 25 --ids eligible-ids.txt"
```

**2b. Or re-run with no FleetCheck code at all**, e.g. in Python:

```python
import hashlib, math
ids = sorted(set(open("codes/eligible-ids.txt").read().split()))
seed, percentage = "<seed>", 25
k = math.ceil(len(ids) * percentage / 100)
ranked = sorted(ids, key=lambda i: (hashlib.sha256(f"{seed}:{i}".encode()).hexdigest(), i))
print("\n".join(sorted(ranked[:k])))
```

Both print the same ids as `is_selected = true` in the database. This was checked against a live selection during development.

---

## Design decisions and assumptions

- **Eligible vehicle** = every vehicle the company still has (`is_deleted = false`), **including inactive ones**. Otherwise a company could avoid a surprise inspection by marking a vehicle inactive just before the pick. Only soft-deleted vehicles are left out. Previous selections are ignored, so a vehicle picked last quarter is still eligible.
- **One selection per company per quarter.** Once made, it can't be changed through the API.
- **No future quarters.** A selection can't be made before the quarter starts. Past quarters are allowed, so a missed quarter can be caught up.
- **`min_surprise_inspection_threshold`** is treated as the minimum allowed percentage for that company.
- **Inactive companies** can't get a new selection, but their existing selections can still be read.
- **The seed is shown in API responses.** That's safe because the pick is already fixed when the seed is revealed, and auditors need it.
- **Only admins** can trigger, read and verify selections, through one fixed account for now. Admins have no `company_id`.
- **Inspections:** each picked vehicle gets an `inspections` row with `status = pending` and no `result`. The `result` (pass/fail), garage and booking reference are filled in later, when the inspection is booked and done.
- **Out of scope for Part 4:** booking the inspections with garages through the vendor API and recording their results, a vehicles CRUD API, real user accounts and roles, and AWS deployment. The `deployments/` folder is reserved for that and currently only holds a `.gitignore`.

---

## Project structure

```
.
├── Makefile                     # all commands, run from the repo root
├── docker/                      # local development environment
│   ├── docker-compose.yml       # Postgres 16 + API
│   ├── api.Dockerfile           # dev image
│   ├── api-entrypoint.sh        # installs npm packages, builds DATABASE_URL from db.env
│   ├── postgres/create-test-db.sh  # creates the <POSTGRES_DB>_test database
│   ├── .envs/db.env.example     # template for .envs/db.env: Postgres credentials (git-ignored)
│   ├── .envs/app.env.example    # template for .envs/app.env (git-ignored)
│   └── .env.example             # template for docker/.env: host ports (git-ignored)
├── codes/                       # NestJS application
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── auth/                # fixed-admin Basic auth guard, @Public, @CurrentUser
│   │   │   └── interfaces/      # AuthUser
│   │   ├── common/
│   │   │   ├── quarter.ts       # quarter parsing and comparison
│   │   │   ├── response/        # ResponseHandler.json(...) + the interceptor that sends it
│   │   │   └── interfaces/      # Quarter
│   │   ├── prisma/              # PrismaService
│   │   ├── health/
│   │   └── surprise-inspections/
│   │       ├── selection/select-vehicles.ts   # the pure algorithm
│   │       ├── dto/                           # request validation (class-validator)
│   │       ├── interfaces/                    # one interface per file, e.g. selection-view.interface.ts
│   │       ├── surprise-inspections.controller.ts
│   │       ├── surprise-inspections.service.ts
│   │       └── surprise-inspections.repository.ts
│   ├── scripts/verify-selection.ts            # auditor CLI
│   └── test/                    # e2e tests
└── deployments/                 # reserved for AWS deployment (empty for now)
```
