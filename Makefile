COMPOSE = docker compose -f docker/docker-compose.yml
RUN     = $(COMPOSE) run --rm api
APP_ENV     = docker/.envs/app.env
DB_ENV      = docker/.envs/db.env
COMPOSE_ENV = docker/.env
ENV_FILES   = $(APP_ENV) $(DB_ENV) $(COMPOSE_ENV)

# Read LOCAL_PORT etc. from docker/.env (if it exists yet).
-include $(COMPOSE_ENV)

.PHONY: up down clean logs build migrate migration seed seed-large reset test test-e2e test-slow verify shell psql

up: $(ENV_FILES)            ## Start Postgres + API (hot reload, migrations applied on start)
	$(COMPOSE) up -d
	@echo "API: http://localhost:$(or $(LOCAL_PORT),3000)/health"

down: $(ENV_FILES)          ## Stop everything (data is kept)
	$(COMPOSE) down

clean: $(ENV_FILES)         ## Stop everything and DELETE the database volume (needed after changing db.env)
	$(COMPOSE) down -v

logs: $(ENV_FILES)          ## Follow API logs
	$(COMPOSE) logs -f api

build: $(ENV_FILES)         ## Build the API image (after changing docker/api.Dockerfile or api-entrypoint.sh)
	$(COMPOSE) build

migrate: $(ENV_FILES)       ## Apply pending migrations
	$(RUN) npx prisma migrate deploy

migration: $(ENV_FILES)     ## Create a new migration: make migration name=add_something
	$(RUN) npx prisma migrate dev --name $(name)

seed: $(ENV_FILES)          ## Reset data and load demo companies, users and vehicles
	$(RUN) npm run seed

seed-large: $(ENV_FILES)    ## Same as seed, plus a 200,000-vehicle company
	$(RUN) npm run seed:large

reset: $(ENV_FILES)         ## Drop the dev database, re-run migrations and seed
	$(RUN) npx prisma migrate reset --force

test: $(ENV_FILES)          ## Unit tests
	$(RUN) npm test

test-e2e: $(ENV_FILES)     ## Integration tests against the <POSTGRES_DB>_test database
	$(RUN) npm run test:e2e

test-slow: $(ENV_FILES)     ## Integration tests including the 200,000-vehicle run
	$(RUN) sh -c "RUN_SLOW_TESTS=true npm run test:e2e"

verify: $(ENV_FILES)        ## Auditor CLI: make verify args="--seed <hex> --percentage 25 --ids ids.txt"
	$(RUN) npm run verify-selection -- $(args)

shell: $(ENV_FILES)
	$(RUN) sh

psql: $(ENV_FILES)
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

# Env files are created from their templates only when missing,
# so local edits are never overwritten.
$(APP_ENV):
	cp $(APP_ENV).example $(APP_ENV)
	@echo "Created $(APP_ENV) from the example template"

$(DB_ENV):
	cp $(DB_ENV).example $(DB_ENV)
	@echo "Created $(DB_ENV) from the example template"

$(COMPOSE_ENV):
	cp $(COMPOSE_ENV).example $(COMPOSE_ENV)
	@echo "Created $(COMPOSE_ENV) from the example template"
