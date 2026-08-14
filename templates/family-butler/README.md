# Family Butler

A household assistant that manages groceries, meals, and family routines through Telegram.

## What It Does

- **Grocery comparison:** Searches and compares prices across Swiggy Instamart, Zepto, BigBasket, and Zomato Blinkit
- **Cart building:** Builds shopping carts on the chosen service (user completes checkout in the app)
- **Order tracking:** Checks delivery status when given an order ID
- **Family memory:** Learns dietary restrictions, brand preferences, ordering patterns over time
- **Daily briefings:** Morning summary with weather, calendar, and tasks; evening preview of tomorrow
- **Weekly reviews:** Grocery stock check on Saturdays, full weekly summary on Sundays with memory curation
- **Meal planning:** Companion Meal Planner app for weekly meal plans and shopping lists

## Skills

| Skill | Purpose |
|-------|---------|
| memory | Long-term family preferences and patterns |
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
| Grocery Stock Check | 10:00 AM Saturdays | Weekly grocery review and shopping list |
| Weekly Summary | 8:00 PM Sundays | Activity recap, spending, memory curation |
| Evening Reminder | 9:00 PM daily | Tomorrow preview, pending items |

All times in Asia/Kolkata (IST).

## Setup

1. Choose a name and set dietary preferences in the personality wizard
2. Connect at least one grocery service (requires browser session login)
3. Create a Telegram bot via @BotFather and connect it
4. Review and customize scheduled tasks
5. Optionally install the Meal Planner companion app
