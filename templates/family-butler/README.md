# Family Butler

A household assistant that manages groceries, meals, and family routines through Telegram.

## What It Does

- **Meals, groceries and price comparison:** through the Meal Planner app (the Flock `planner` app, installed and paired by Family Butler). It holds the week's meals, the grocery list and the family's recipe book, and compares prices across the connected services (Swiggy Instamart, Zepto, BigBasket, Zomato Blinkit) before an order, which is placed only after the family confirms the total. Family Butler fills it when you ask; the rows are yours
- **Daily briefings:** Morning summary with weather, calendar, and tasks; evening preview of tomorrow

## Skills

| Skill | Purpose |
|-------|---------|
| reminders | Time-based reminders for the family |
| google-calendar | Family calendar for briefings |
| google-sheets | Household expense tracking |
| swiggy-instamart | Grocery shopping on Swiggy |
| zepto | Grocery shopping on Zepto |
| bigbasket | Grocery shopping on BigBasket |
| zomato-blinkit | Grocery shopping on Blinkit |

## Scheduled Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| Morning Briefing | 8:00 AM daily | Weather, calendar, pending tasks |
| Evening Reminder | 9:00 PM daily | Tomorrow preview, pending items |

All times in Asia/Kolkata (IST).

## Setup

1. Choose a name and set dietary preferences in the personality wizard
2. Connect at least one grocery service (requires browser session login)
3. Create a Telegram bot via @BotFather and connect it
4. Review and customize scheduled tasks
5. Optionally add the Meal Planner app: Flock installs the `planner` app and pairs it with Family Butler (needs Flock 0.15.0 or later)
