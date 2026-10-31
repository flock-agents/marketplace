---
name: zepp
description: Read Zepp / Amazfit watch data - daily activity, workouts, sleep, heart rate and body composition
tags: [fitness, health, zepp, amazfit, wearable]
category: integration
requiresInstance: true
tier: installable
---

# Zepp

Reads one person's Zepp (Amazfit) data through the zepp-mcp server. Each Zepp account is one person; an agent uses the account it was given. Read-only.

## When to use

- Steps, distance, calories or sleep for a date range
- Workouts and workout detail (laps, streams), training thresholds
- Heart rate for a day, sleep stages for a night
- Weight / body composition readings

## Tools

| Tool | Purpose |
|------|---------|
| `zepp_daily_summary` | Daily steps, distance, calories, sleep for `from_date`..`to_date` |
| `zepp_heart_rate` | Per-minute heart rate for one `date`, with summary |
| `zepp_sleep` | Sleep breakdown for one night (`date`) |
| `zepp_list_workouts` | Workouts across sports for a date range |
| `zepp_workout_detail` | Full detail for one workout |
| `zepp_body_composition` | Scale readings (weight, BMI, body fat...) |
| `zepp_training_thresholds` | Lactate threshold HR / pace and trend |
| `zepp_describe_schema` | Sport codes and fields the server understands |
| `zepp_raw_request` | Arbitrary GET to the Zepp API for data the others don't cover |
| `zepp_auth_status` | Whether the account is signed in and when the token expires |

Dates are `YYYY-MM-DD`.

## Notes

- If a tool reports a login error, run `zepp_auth_status` and ask the owner to re-check that account's credentials in Flock.
- Never mix accounts: report data only for the person whose account the agent is bound to.
