# Capstone Project Backend

This backend is built with Node.js, Express, Sequelize, and MySQL.

## Setup

1. Copy `.env.example` to `.env` and update your MySQL settings.
2. Run `npm install`.
3. Start the app with `npm run dev`.

## Environment variables

- `DB_HOST` - MySQL server host (default: `localhost`)
- `DB_PORT` - MySQL server port (default: `3306`)
- `DB_NAME` - database name (default: `capstone_db`)
- `DB_USER` - MySQL username
- `DB_PASSWORD` - MySQL password
- `PORT` - server port (default: `3000`)

## Available scripts

- `npm start` - start the server
- `npm run dev` - start the server with nodemon
- `npm run sync-db` - authenticate and sync Sequelize models to the database

## API

- `GET /` - health check
- `GET /api/v1/status` - status and model counts
- `GET /api/v1/users` - list users
- `POST /api/v1/users` - create a user
- `GET /api/v1/projects` - list projects
- `POST /api/v1/projects` - create a project

## Structure

- `index.js` - app entry point
- `config/database.js` - Sequelize MySQL connection
- `router.js/index.js` - Express router
- `controller.js/index.js` - route handlers
- `model/` - Sequelize models and associations
- `util/errorHandler.js` - 404 and error middleware
- `scripts/syncDatabase.js` - database sync utility
