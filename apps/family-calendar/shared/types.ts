export interface Member {
  id: number;
  name: string;
  color: string;
  emoji: string;
  createdAt: string;
}

export interface CalendarEvent {
  id: number;
  title: string;
  startTime: string;
  endTime: string;
  memberId: number | null;
  memberName?: string;
  memberColor?: string;
  memberEmoji?: string;
  category: "school" | "work" | "social" | "medical" | "household" | "other";
  status: "confirmed" | "tentative" | "done";
  notes: string;
  createdAt: string;
}

export interface Reminder {
  id: number;
  title: string;
  dueTime: string;
  eventId: number | null;
  status: "pending" | "done";
  createdAt: string;
}

export type ViewMode = "week" | "day";
