import { callEdge } from './edge';

/**
 * Best-effort push to a field user when they're assigned area(s). Names the
 * area(s) so the notification is specific. Never throws — a push failure must
 * not break the assignment flow.
 */
export async function notifyAssignmentCreated(
  userId: string,
  areaLabels: string[],
  dateKey: string
): Promise<void> {
  const labels = areaLabels.map((l) => l.trim()).filter(Boolean);
  if (labels.length === 0) return;

  const body =
    labels.length === 1
      ? `You've been assigned ${labels[0]} for ${dateKey}.`
      : `You've been assigned ${labels.length} areas for ${dateKey}: ${labels.join(', ')}.`;

  try {
    await callEdge('notify-assignment', {
      userId,
      title: 'New assignment',
      body,
      data: { type: 'assignment' },
    });
  } catch (e) {
    console.warn('[notify] assignment push failed:', e instanceof Error ? e.message : e);
  }
}
