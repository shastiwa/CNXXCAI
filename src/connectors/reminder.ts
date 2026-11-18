import { env } from "@/lib/env";

export interface Reminder {
  incidentId: string;
  to: string;
  link: string;
  number: number;
}
export interface ReminderSender {
  send(r: Reminder): Promise<void>;
}

/** Test double. Keeps reminders in memory and sends nothing. Set `failNext` to test a delivery failure. */
export const mockOutbox = { sent: [] as Reminder[], failNext: false };
const mockSender: ReminderSender = {
  async send(r) {
    if (mockOutbox.failNext) { mockOutbox.failNext = false; throw new Error("delivery failed"); }
    mockOutbox.sent.push(r);
  },
};

/** null means no delivery method is configured: the job reports what is due and sends nothing. */
export function reminderSender(): ReminderSender | null {
  return env().REMINDER_MODE === "mock" ? mockSender : null;
}
