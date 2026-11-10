// EDIT FOR YOUR SETUP: which Google calendars the dashboard reads, and how each behaves
// (spec section 6). Calendars are matched by their name as shown in Google Calendar
// ("primary" = your own main calendar), so no calendar IDs or other people's email
// addresses need to live in the repo.
//
// role: 'mine'   shown, triggers alerts, affects the commute "home by" time
//       'family' shown dimmed; counts only if it names you, invites you, or matches a keyword
//       'other'  shown dimmed, never counts
//
// key: picks the color in site/js/config.js -> calendars (work, personal, family, ooo, holiday).
// If two calendars carry the same events (e.g. two copies of a family calendar), they're shown once.
export const CALENDARS = [
  { match: 'primary', key: 'work', role: 'mine' },
  { match: 'Family', key: 'family', role: 'family' },             // your shared family calendar's name
  { match: 'Holidays in United States', key: 'holiday', role: 'other' }
];

// A family event counts if its title contains one of these names (whole word, any case)...
export const NAME_VARIANTS = ['YourName', 'Nickname'];
// ...or one of these keywords. Empty by default; add words like 'dinner' as needed.
export const FAMILY_KEYWORDS = [];
