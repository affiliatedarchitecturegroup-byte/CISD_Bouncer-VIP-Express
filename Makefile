# Bouncer VIP Platform - Makefile
# Run make <target> to execute commands

.PHONY: help install dev build test lint format docker-up docker-down docker-logs k8s-deploy clean

help:
	@echo "Bouncer VIP Platform - Available Commands"
	@echo "===================================="
	@echo "install      Install dependencies"
	@echo "dev         Start development servers"
	@echo "build       Build all services"
	@echo "test        Run tests"
	@echo "lint        Run linter"
	@echo "format      Format code"
	@echo "docker-up   Start Docker containers"
	@echo "docker-down Stop Docker containers"
	@echo "docker-logs View Docker logs"
	@echo "k8s-deploy Deploy to Kubernetes"
	@echo "clean       Clean up containers and volumes"

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

build:all:
	npm run build:all

test:
	npm run test

lint:
	npm run lint

lint-fix:
	npm run lint:fix

format:
	npm run format

docker-build:
	docker compose build

docker-up:
	docker compose up -d
	@echo "Waiting for services..."
	@sleep 5
	@docker compose ps

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-clean:
	docker compose down -v --rmi local

k8s-deploy:
	kubectl apply -f k8s/base/

k8s-status:
	kubectl get pods -n bouncer-vip

k8s-logs:
	kubectl logs -n bouncer-vip -l app=bouncer-api-gateway -f

clean: docker-clean
	@echo "Cleaned up Docker resources"