# root-level makefile for the whole project
# makes it easy to start/stop things without remembering long commands

.PHONY: help install stage-a stage-a-api stage-a-web stage-b stage-b-down kill

help:
	@echo ""
	@echo "  make install       install stage A dependencies"
	@echo "  make stage-a       start both stage A servers"
	@echo "  make stage-a-api   start api simulator only"
	@echo "  make stage-a-web   start web dashboard only"
	@echo "  make stage-b       start stage B with docker compose"
	@echo "  make stage-b-down  stop stage B containers"
	@echo "  make kill          kill anything running on ports 3000 and 3001"
	@echo ""

install:
	cd stage-a-simulation/api-simulator && npm install
	cd stage-a-simulation/web-dashboard && npm install

stage-a-api:
	cd stage-a-simulation/api-simulator && npm start

stage-a-web:
	cd stage-a-simulation/web-dashboard && npm run dev

# run both in parallel, ctrl+c stops both
stage-a:
	@echo "starting stage A: backend on :3001, frontend on :3000"
	@(cd stage-a-simulation/api-simulator && npm start) & (cd stage-a-simulation/web-dashboard && npm run dev)

stage-b:
	cd stage-b-mvp && docker compose up --build

stage-b-down:
	cd stage-b-mvp && docker compose down

# kills whatever is occupying ports 3000 and 3001
kill:
	lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@echo "ports 3000 and 3001 cleared"
