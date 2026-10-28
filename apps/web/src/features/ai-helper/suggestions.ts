// Suggested first questions for "Ask Kaampilot", picked by the page the person is on (PLAN.md §24.3 UI v2). Signed in, the
// first ones ask about the person's own data (answered from the apps with their own access, §24.3 "Data answers").

const BY_AREA: [prefix: string, questions: string[]][] = [
  ['/attendance', ['How many leaves do I have left?', 'How many days was I late this month?', 'How do I fix a missed punch?', 'How do I apply for leave?', 'How is late coming counted?']],
  ['/tasks', ['My overdue tasks', 'How many tasks are open for me?', 'How do I add a task?', 'How do I set a task that repeats every week?', 'How does task approval work?']],
  ['/assets', ['Which assets are with me?', 'How do I add an asset?', 'How do I give an asset to a person?', 'How do I raise a ticket for a broken item?', 'How do I print asset labels?']],
  ['/visitors', ['How many visitors came today?', 'How does the gate register work?', 'How does a guard sign in?', 'How do I pre-approve a visitor?', 'Where do I see who is inside right now?']],
  ['/team', ['Who is late today?', 'Who is on leave today?', 'Who has the most overdue tasks?', 'What does Team 360 show?', 'Who can open Team 360?']],
  ['/billing', ['Which plan are we on?', 'What does Kaampilot cost?', 'How do I add more users?', 'How do I pay and get a GST invoice?', 'What happens when the free trial ends?']],
  ['/admin', ['How do I add a new employee?', 'How do I set up roles and permissions?', 'How do I switch a module on or off?', 'How do I change the company colour and logo?']],
];

const HOME = ['How many leaves do I have left?', 'My overdue tasks', 'Who is late today?', 'How do I punch in?', 'How do I install the phone app?'];
const SITE = ['What is Kaampilot?', 'What does Kaampilot cost?', 'How does the free trial work?', 'Does it work on Android phones?', 'How does selfie + GPS attendance work?', 'Kya isme salary bhi ban jaati hai?'];

export function suggestionsFor(pathname: string, site: boolean): string[] {
  if (site) return SITE;
  return BY_AREA.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? HOME;
}
