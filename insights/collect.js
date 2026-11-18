// The arithmetic behind the Insights tab on pivotdevshop.com/shipped.
//
// Pure functions over text git already printed, so tests/insights.test.js can
// run them without a checkout. insights.js does the reading and the writing.

const TZ = 'America/New_York';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The kind of file a line of code is counted under. Anything else (images,
// fonts, lock files) isn't code and isn't counted.
const KINDS = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.css': 'CSS', '.html': 'HTML', '.md': 'Docs',
  '.json': 'Data & config', '.yml': 'Data & config', '.yaml': 'Data & config', '.csv': 'Data & config',
  '.swift': 'Swift', '.rb': 'Ruby', '.sh': 'Shell', '.py': 'Python', '.rules': 'Firestore rules',
};
// Generated files that would swamp the count without anyone having written them.
const GENERATED = /(^|\/)(package-lock\.json|Package\.resolved)$/;
const MAX_LINES = 20000;

function kindOf(file) {
  if (GENERATED.test(file)) return null;
  const m = file.toLowerCase().match(/\.[a-z0-9]+$/);
  return (m && KINDS[m[0]]) || null;
}

// Day, hour and weekday of a commit where Braden is, not where the server was.
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
});
function local(iso) {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: WEEKDAYS.indexOf(p.weekday) };
}

// `git log --no-merges --format=@@%aI|%an|%s --numstat` → one entry per commit.
function parseLog(text) {
  const commits = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('@@')) {
      const body = line.slice(2);
      const a = body.indexOf('|'), b = body.indexOf('|', a + 1);
      cur = { at: body.slice(0, a), author: body.slice(a + 1, b), subject: body.slice(b + 1), lines: 0 };
      commits.push(cur);
    } else if (cur && line.trim()) {
      const [add, del] = line.split('\t');
      if (add !== '-') cur.lines += Number(add) + Number(del); // '-' is a binary file
    }
  }
  return commits;
}

// Everything the tab shows about one project. `files` is [{ path, lines }] for
// the tree as it stands; `merges` is how many pull requests were merged.
function summarise({ id, name, commits, merges, files, claudeMd }) {
  const hours = Array(24).fill(0), weekdays = Array(7).fill(0), daily = {}, langs = {};
  let claude = 0;
  for (const c of commits) {
    const t = local(c.at);
    hours[t.hour] += 1;
    weekdays[t.weekday] += 1;
    daily[t.day] = (daily[t.day] || 0) + 1;
    if (c.author === 'Claude') claude += 1;
  }
  let loc = 0;
  for (const f of files) {
    const k = kindOf(f.path);
    if (!k || f.lines > MAX_LINES) continue;
    langs[k] = (langs[k] || 0) + f.lines;
    loc += f.lines;
  }
  const days = Object.keys(daily).sort();
  const first = days[0] || null, last = days[days.length - 1] || null;
  const span = first ? Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1 : 0;
  const biggest = commits
    .map((c) => ({ title: c.subject.slice(0, 120), day: local(c.at).day, lines: c.lines }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10);
  return {
    id, name, commits: commits.length, prs: merges, claude, first, last,
    daysWorked: days.length, calendarDays: span, loc, claudeMd, hours, weekdays, daily, langs, biggest,
  };
}

module.exports = { TZ, WEEKDAYS, kindOf, local, parseLog, summarise };
