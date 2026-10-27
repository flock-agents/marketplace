# Fitness Coach

A personal coach agent paired with the **Fitness** app (`apps/fitness`).

- **Coaching:** daily workout plan and weekly summary (app routines), meal logging with full nutrient estimates, water.
- **Dashboard:** Today / Yesterday / History / Exercises, goals in focus chosen by the coach.
- **Trackers (optional):** Zepp syncs steps, calories, sleep, workouts, weight and PAI hourly. Without a tracker the core
  goals (calories, protein, fiber, water, workouts, weight, waist) still work from chat.

The setup wizard asks for the person's name, time zone, health notes and food preferences; the coach writes the first
three into the app's settings (`person`, `timezone`, `exercises_note`) on its first conversation.
