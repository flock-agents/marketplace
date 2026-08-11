# Meal Planner

Plan meals for the week and manage your shopping list.

## Features

**Meal Plan**
- 7-day or 14-day calendar view
- Four meal slots per day: Breakfast, Lunch, Dinner, Snack
- Add, edit, and delete meals with optional notes
- Navigate between weeks with arrow buttons

**Shopping List**
- Add items with optional quantities
- Tap to toggle bought/pending status
- Tap item name or quantity to edit inline
- Clear all bought items in one tap

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Hono on Bun
- **Database:** SQLite (bun:sqlite)

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/meals?from=&to=` | List meals in date range |
| POST | `/api/meals` | Create a meal |
| PUT | `/api/meals/:id` | Update a meal |
| DELETE | `/api/meals/:id` | Delete a meal |
| GET | `/api/shopping` | List shopping items |
| POST | `/api/shopping` | Add a shopping item |
| PUT | `/api/shopping/:id` | Update a shopping item |
| DELETE | `/api/shopping/:id` | Delete a shopping item |
| POST | `/api/shopping/clear-bought` | Remove all bought items |
