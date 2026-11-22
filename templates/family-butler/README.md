# Family Butler

A household assistant that manages groceries, meals, and family routines through Telegram.

The family's shared assistant: it lives in the family group chat, answers there when someone tags it or replies to it, and acts with the permissions of whoever asked.

## What It Does

- **Family plans:** Trips, birthdays and weekend outings: searches and compares the options, books once the person who asked says yes, and sets reminders
- **Shared lists and apps:** Keeps the family's shared lists, and asks the Flock Assistant to build shared apps such as a grocery list, meal planner or chore chart
- **Meals, groceries and price comparison:** through the Meal Planner app (the Flock `planner` app, installed and paired by Family Butler). It holds the week's meals, the grocery list and the family's recipe book, and compares prices across the connected services (Swiggy Instamart, Zepto, BigBasket, Zomato Blinkit) before an order, which is placed only after the family confirms the total. Family Butler fills it when you ask; the rows are yours
- **Reminders for the family:** "remind us about X" in the group becomes a group TODO (the `todos` skill), at the time asked: a day with no time is set for 9 am, and the butler says so; with no date it asks once when. Never a Family Calendar entry: the calendar holds events
- **Daily briefs in the family group:** from the Family Calendar app (installed and paired with Family Butler). At 8 AM: today's events with their notes and who drops or picks up, anything cancelled or moved, new dates imported from email or school portals, the to-dos now showing, and the weather. At 9 PM: tomorrow's events and the to-dos due tomorrow (the calendar sends no separate "evening before" reminder). A day with nothing on sends nothing

## Skills

| Skill | Purpose |
|-------|---------|
| todos | Group reminders: "remind us" in the family group becomes a group TODO; Flock pings the group at its time and anyone can tick it |
| google-sheets | Household expense tracking |
| bigbasket | Grocery shopping on BigBasket |
| zomato-blinkit | Grocery shopping on Blinkit |

Zepto and Swiggy Instamart come through their official connections (`zepto-mcp`, `swiggy-instamart-mcp`), not skills: the butler sets one up when the family asks for it.

## Scheduled Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| Morning Briefing | 8:00 AM daily | Today from the Family Calendar, plus weather, to the family group |
| Evening Reminder | 9:00 PM daily | Tomorrow from the Family Calendar, to the family group |

All times in Asia/Kolkata (IST).

## Setup

1. Choose a name and set dietary preferences in the personality wizard
2. Connect at least one grocery service: Zepto or Swiggy Instamart sign in with your phone number; BigBasket or Blinkit sign in in Flock's browser
3. Create a Telegram bot via @BotFather and connect it
4. Review and customize scheduled tasks
5. Optionally add the Meal Planner app: Flock installs the `planner` app and pairs it with Family Butler (needs Flock 0.15.0 or later)
6. The Family Calendar app is always set up: Flock installs `family-calendar` and pairs it with Family Butler; the briefs read it
