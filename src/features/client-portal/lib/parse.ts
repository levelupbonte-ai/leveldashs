// Plain-text helpers of the publish form: one checklist item per line, and
// itinerary steps as "YYYY-MM-DD Title — details" (date and details optional).

export function parseChecklist(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((line) => line.slice(0, 160));
}

export function parseSteps(
  text: string
): { date: string | null; title: string; detail: string | null }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => {
      const m = /^(\d{4}-\d{2}-\d{2})\s*[:·-]?\s*(.*)$/.exec(line);
      const date = m ? m[1] : null;
      const rest = (m ? m[2] : line).trim();
      const [title, ...detail] = rest.split(/\s+[—–]\s+|\s+-\s+/);
      return {
        date,
        title: (title || rest).slice(0, 160),
        detail: detail.length ? detail.join(' — ').slice(0, 1000) : null
      };
    })
    .filter((s) => s.title);
}
