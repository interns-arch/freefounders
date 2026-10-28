// Suggested first questions for "Ask Kaampilot", picked by the page the person is on (PLAN.md §24.3 UI v2).

const BY_AREA: [prefix: string, questions: string[]][] = [
  ['/attendance', ['How do I punch in?', 'How do I fix a missed punch?', 'How do I apply for leave?', 'How is late coming counted?', 'Where do I see my attendance for the month?']],
  ['/tasks', ['How do I add a task?', 'How do I set a task that repeats every week?', 'How does task approval work?', 'How do I give a task to someone else?', 'Where do I see overdue tasks?']],
  ['/assets', ['How do I add an asset?', 'How do I give an asset to a person?', 'How do I raise a ticket for a broken item?', 'How do I print asset labels?', 'How do I download the asset list?']],
  ['/visitors', ['How does the gate register work?', 'How does a guard sign in?', 'How do I pre-approve a visitor?', 'Where do I see who is inside right now?']],
  ['/team', ['What does Team 360 show?', "How do I see one person's attendance and tasks?", 'Who can open Team 360?', 'How do I add a new employee?']],
  ['/billing', ['What does Kaampilot cost?', 'How do I add more users?', 'How do I pay and get a GST invoice?', 'What happens when the free trial ends?']],
  ['/admin', ['How do I add a new employee?', 'How do I set up roles and permissions?', 'How do I switch a module on or off?', 'How do I change the company colour and logo?']],
];

const HOME = ['How do I punch in?', 'How do I add a task?', 'How do I fix a missed punch?', 'How do I install the phone app?', 'What does Kaampilot cost?'];
const SITE = ['What is Kaampilot?', 'What does Kaampilot cost?', 'How does the free trial work?', 'Does it work on Android phones?', 'How does selfie + GPS attendance work?', 'Kya isme salary bhi ban jaati hai?'];

export function suggestionsFor(pathname: string, site: boolean): string[] {
  if (site) return SITE;
  return BY_AREA.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? HOME;
}
