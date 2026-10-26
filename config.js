// ============================================================
// YAK-TAG — shared Supabase config
//
// WHEN YOU CHANGE THIS FILE (or offline.js): bump the ?v= number in
// the <script src="config.js?v=..."> tags of admin/index.html,
// cow.html, t.html and index.html. Browsers keep the old file for a
// while otherwise, and a new page with an old config.js shows old
// behaviour (e.g. English month names).
// Used by admin/index.html and cow.html
//
// This key is the PUBLISHABLE key. It is safe in public code:
// it respects Row Level Security, so a farm admin still only
// sees their own farm. Never put the sb_secret_... key here.
// ============================================================

const SUPABASE_URL = 'https://mjijgxfmkgtxmpbmshtl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_npSJ3ZAWO_ODx_cXbvORoQ__t-_1GiJ';

// ============================================================
// OPTIONAL: Google Maps satellite key.
//
// Leave EMPTY and the map uses Sentinel-2 satellite imagery (ESA
// open data via EOX) — free forever, no key, no quota, licensed
// for commercial use. Resolution is ~10m: enough to read terrain,
// rivers and grazing ground, not enough to see an individual animal.
//
// Set a key here to ADD a Google satellite layer to the switcher
// for sharper imagery.
//
// COST (verified 2026): Google scrapped the old $200/month credit
// in March 2025. Dynamic Maps now gives 10,000 free map loads per
// month, then $7 per 1,000. One "load" = one user opening the map
// tab. A billing account with a card is required even to use the
// free tier.
//   ~6,000 loads/month  -> $0
//   ~30,000 loads/month -> ~$140/month
//   ~120,000            -> ~$770/month
// Always restrict the key to your domain (HTTP referrers) or
// someone else can run up your bill.
// ============================================================
const GOOGLE_MAPS_KEY = '';

// ============================================================
// OPTIONAL: Mapbox token for high-resolution satellite.
//
// Free tier: 50,000 map loads/month, no credit card to start,
// commercial use allowed. Sign up at mapbox.com, copy the default
// public token (starts pk.), paste it here. It adds a
// "Нарийвчилсан хиймэл дагуул" option to the layer switcher with
// sub-meter imagery in many areas.
//
// Leave empty and the map uses free Sentinel-2 only.
// Restrict the token to your domain in the Mapbox dashboard.
// ============================================================
const MAPBOX_TOKEN = '';

// ============================================================
// ⚠️  TESTING ONLY — REMOVE BEFORE COMMERCIAL LAUNCH
//
// Loads Google's satellite tiles directly from mt1.google.com.
// No key, no billing, unlimited zoom, best imagery available.
//
// THE CATCH: Google's Terms of Service require their tiles be
// served through the Maps JavaScript API. Pulling them from the
// tile endpoint is undocumented and unlicensed. It works today.
// It can stop working any day, without notice, and using it in a
// product you charge for is a licensing exposure.
//
// Acceptable while you are testing on a github.io domain with
// five tags. Set this to false and configure MAPBOX_TOKEN above
// before you take money from a customer.
//
// When the layer is active the map shows a visible warning badge,
// so nobody demos this to an investor without noticing.
// ============================================================
const USE_GOOGLE_TILES_TESTING = true;

// Bars but no data: a request can hang for minutes before the browser
// gives up, keeping buttons disabled and the offline queue waiting.
// Give up after 20 s instead — the "aborted" error counts as no network
// everywhere (isOffline / the queue), so the offline paths take over.
// Photo uploads (storage) may legitimately take longer and are left alone.
function ytFetch(input, init) {
  init = init || {};
  const url = String((input && input.url) || input || '');
  if (init.signal || /\/storage\/v1\//.test(url) || typeof AbortController === 'undefined') {
    return fetch(input, init);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { global: { fetch: ytFetch } });

// ---------- signing out (app, animal page, dashboard) ----------
// The login AND what this person's work left on the phone go, so the next
// person using the phone sees nothing of it (security review 2026-10-25):
//  · with no signal supabase-js keeps the login (it cannot reach the
//    server) and the next person would be signed in as this one once the
//    signal is back — so its stored session is removed by hand as well;
//  · our cached animals, herds, profile, refused entries, the horse switch;
//  · unsent entries (milk, scans, herd pins…): sent later they would be
//    saved under the next person's login. The pages warn before this.
// Public data stays: the website contacts, strangers' tag pages (yt-tag:*)
// and strangers' unsent taps (public_scan).
async function ytSignOut() {
  try { await sb.auth.signOut(); } catch (e) {}
  try {
    const k = sb.auth.storageKey;
    if (k) [k, k + '-user', k + '-code-verifier'].forEach(x => localStorage.removeItem(x));
  } catch (e) {}
  try {
    Object.keys(localStorage).filter(k => /^yt-/.test(k) && !/^yt-(contacts|tag:)/.test(k))
      .forEach(k => localStorage.removeItem(k));
  } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  await new Promise(done => {
    try {
      const r = indexedDB.open('yaktag-offline', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id' });
      r.onerror = () => done();
      r.onsuccess = () => {
        try {
          const db = r.result, t = db.transaction('queue', 'readwrite'), s = t.objectStore('queue');
          const all = s.getAll();
          all.onsuccess = () => (all.result || []).forEach(it => { if (it.kind !== 'public_scan') s.delete(it.id); });
          t.oncomplete = t.onerror = t.onabort = () => { db.close(); done(); };
        } catch (e) { done(); }
      };
    } catch (e) { done(); }
  });
}

// ---------- shared helpers ----------

async function requireLogin(redirectTo = 'index.html') {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

async function myProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from('profiles')
    .select('id, full_name, role, farm_id')
    .eq('id', user.id)
    .single();
  return data;
}

// ---------- login by phone ----------
// Every login is a phone number (supabase/functions/admin-users creates
// them), stored as the internal login <digits>@yaktag.invalid — a
// reserved domain that never receives mail. MUST match the Edge
// Functions (admin-users, password-reset) exactly.
const HERDER_EMAIL_DOMAIN = 'yaktag.invalid';

function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('976')) d = d.slice(3);   // +976 prefix
  return d;
}

// Phone number only (owner, 2026-10-23): every login is a phone number,
// typed on the number keypad. No e-mail logins any more.
function loginEmail(input) {
  return `${normPhone(input)}@${HERDER_EMAIL_DOMAIN}`;
}

// The check every login / reset box uses before sending anything.
// Returns the message to show, or null when the number looks right.
function loginPhoneError(input) {
  const s = String(input || '').trim();
  if (!s) return 'Утасны дугаараа оруулна уу.';
  if (/[^\d\s+()-]/.test(s)) return 'Зөвхөн утасны дугаараа оруулна уу (жишээ: 9911 2233).';
  if (normPhone(s).length < 6) return 'Утасны дугаараа бүтэн оруулна уу.';
  return null;
}

// Calendar date in Mongolia as YYYY-MM-DD. toISOString() gives the UTC
// date, which is still "yesterday" here until 08:00 — milk logged at
// dawn landed on the wrong day. Pass a Date to convert that moment.
function mnDate(d = new Date()) {
  mnDate.fmt = mnDate.fmt || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' });
  return mnDate.fmt.format(d);
}

// Dates as YYYY/MM/DD (Ulaanbaatar time). The old
// toLocaleDateString('mn-MN') printed "May 12" in English on phones
// without Mongolian locale data. Always shown in Ulaanbaatar time; a
// plain 'YYYY-MM-DD' date is taken as-is (no timezone shift).
function mnParts(ts) {
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)) {
    const [y, m, d] = ts.split('-').map(Number);
    return { y, m, d, h: null, mi: null };
  }
  // One formatter, built once: creating it per date was the slowest
  // part of drawing a large herd table.
  mnParts.fmt = mnParts.fmt || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const p = Object.fromEntries(mnParts.fmt.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: p.hour, mi: p.minute };
}

// One format everywhere: YYYY/MM/DD, and YYYY/MM/DD HH:MM with a time.
function fmtDate(ts) {
  if (!ts) return '—';
  const p = mnParts(ts);
  return `${p.y}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`;
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const p = mnParts(ts);
  return p.h == null ? fmtDate(ts) : `${fmtDate(ts)} ${p.h}:${p.mi}`;
}

// Error text for people. Older database functions and the network
// layer answer in English (and some mention developer options such as
// "pass force"); every toast / confirmation passes through this.
const MN_ERRORS = [
  [/Farm has (\d+) animals and (\d+) users\. Archive it, or pass force\./, 'Энэ фермд $1 мал, $2 хэрэглэгч бүртгэлтэй. Устгахын оронд "Түр хаах" нь аюулгүй.'],
  [/Farm has (\d+) animals, (\d+) users and (\d+) tags\. Archive it, or pass force\./,
     'Энэ фермд $1 мал, $2 хэрэглэгч, $3 таг бүртгэлтэй — устгавал бүгд устна (түүхтэй хэрэглэгчийг хаана). Устгахын оронд "Түр хаах" нь аюулгүй.'],
  [/Animal has records \((\d+) milk, (\d+) photos, (\d+) public scans\)\. Archive it, or pass force\./,
     'Энэ малд $1 сүүний, $2 зургийн, $3 уншуулалтын бүртгэл бий. Устгахын оронд төлөвийг "Зарагдсан" эсвэл "Үхсэн" болгох нь аюулгүй.'],
  [/User owns (\d+) animals\. Reassign them first, or pass force\./, 'Энэ хэрэглэгч $1 малтай. Эхлээд малыг өөр эзэмшигчид шилжүүлнэ үү.'],
  [/You cannot delete yourself/, 'Өөрийгөө устгах боломжгүй.'],
  [/This number is locked\. Ask a farm admin to change it\./, 'Энэ дугаар түгжээтэй. Өөрчлөх бол ферм админд хандана уу.'],
  [/Only the super admin can delete a photo/, 'Зургийг зөвхөн ерөнхий админ устгана.'],
  [/Super admin only/, 'Зөвхөн ерөнхий админ.'],
  [/Only a farm admin can \w+ (a )?tags?/i, 'Зөвхөн ферм админ.'],
  [/Not allowed/, 'Энэ үйлдлийг хийх эрхгүй.'],
  [/(Animal|Cattle) not found/, 'Мал олдсонгүй.'],
  [/Farm not found/, 'Ферм олдсонгүй.'],
  [/User not found/, 'Хэрэглэгч олдсонгүй.'],
  [/Photo not found/, 'Зураг олдсонгүй.'],
  [/Tag (\S+) not found/, 'Таг олдсонгүй: $1'],
  [/Invalid phone number[^.]*\./, 'Утасны дугаар буруу. Зөвхөн тоо оруулна уу.'],
  [/new row violates row-level security policy.*|permission denied.*/i, 'Энэ үйлдлийг хийх эрхгүй.'],
  [/duplicate key value.*/i, 'Ийм бүртгэл аль хэдийн байна.'],
  [/JWT expired|invalid JWT|Auth session missing!?/i, 'Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.'],
  [/TypeError: Failed to fetch|Failed to fetch|NetworkError.*|Load failed/i, 'Сүлжээ байхгүй байна. Дахин оролдоно уу.'],
];
// Milk (schema_v54): after the first save a herder may correct the
// number once; then only a farm admin can. Shown by cow.html (and so
// the app) and the dashboard.
const MILK_ONE_EDIT = 'Нэг удаа засах боломжтой.';
const MILK_CONFIRM  = 'Сүүг зөвхөн нэг удаа засах боломжтой. Үргэлжлүүлэх үү?';
const MILK_LOCKED   = 'Засагдсан — дахин засах боломжгүй. Засах бол ферм админд хандана уу.';
// ---------- horses: hidden until launch (owner, 2026-10-24) ----------
// true = everyone sees the horse section, the 🐎 buttons and check.html.
// Before that a tester turns horses on for ONE phone / browser by opening
// any page once with ?horses=1 (?horses=0 turns it off again).
const HORSES_PUBLIC = false;
let horsesOn = (() => {
  try {
    const p = new URLSearchParams(location.search).get('horses');
    if (p === '1') localStorage.setItem('yt-horses', '1');
    if (p === '0') localStorage.removeItem('yt-horses');
    return HORSES_PUBLIC || localStorage.getItem('yt-horses') === '1';
  } catch (e) { return HORSES_PUBLIC; }
})();
// A super admin always sees the horse part (owner, 2026-10-25): turned on
// at his login, and it stays on for this phone / browser. Pages call this
// once they know who is signed in, then redraw their section.
function horsesForRole(role) {
  if (role === 'super_admin' && !horsesOn) {
    horsesOn = true;
    try { localStorage.setItem('yt-horses', '1'); } catch (e) {}
  }
  return horsesOn;
}
// the horse app ("YAK-TAG Адуу"): app/?app=horse, its own icon and colour
const HORSE_APP_URL = 'app/?app=horse#horse';

// ---------- horses (schema_v55; words and lists: HORSE_RESEARCH.md) ----------
// Coat colours (зүс): the 17 basic ones + two common shades.
const HORSE_COATS = ['хээр', 'зээрд', 'хүрэн', 'хар', 'халтар', 'хул', 'халиун', 'шарга', 'хонгор',
  'цавьдар', 'саарал', 'хөх саарал', 'буурал', 'бор', 'хөх бор', 'улаан', 'цагаан', 'алаг', 'цоохор'];
const HORSE_MARKS = ['халзан', 'сартай', 'булаг'];          // face / leg markings
const HORSE_VACCINES = ['Боом', 'Адууны томуу', 'Адууны сахуу', 'Галзуу'];
// Year of life, counted as herders do: born this year = 1st (унага).
function horseYear(birthYear) {
  return birthYear ? Number(mnDate().slice(0, 4)) - birthYear + 1 : null;
}
function horseAgeName(birthYear) {
  const n = horseYear(birthYear);
  return n == null ? '' : (['', 'унага', 'даага', 'шүдлэн', 'хязаалан', 'соёолон'][n] || (n > 5 ? 'их нас' : ''));
}
// "эм унага", "эр даага", "шүдлэн гүү", "соёолон азарга", "их насны агт"
function horseLabel(c) {
  const n = horseYear(c.birth_year), age = horseAgeName(c.birth_year);
  if (n != null && n <= 2) return `${c.sex === 'female' ? 'эм' : 'эр'} ${age}`;
  const who = c.sex === 'female' ? 'гүү' : c.castrated ? 'агт' : (n == null || n >= 4) ? 'азарга' : 'үрээ';
  return age ? `${age === 'их нас' ? 'их насны' : age} ${who}` : who;
}
// The animal's page: by tag when it has one, else by id (a horse with
// no YAK-TAG tag). prefix = '../' from admin/ and app/.
function cowUrl(c, prefix = '') {
  return prefix + 'cow.html?' + (c.tag_code ? 'tag=' + encodeURIComponent(c.tag_code) : 'id=' + encodeURIComponent(c.id));
}
// What to show where a tag number goes, for a horse without a tag
function animalCode(c) {
  return c.tag_code || (c.national_id ? c.national_id : c.chip_no ? 'Чип …' + c.chip_no.slice(-6) : 'Таггүй адуу');
}

// ---------- horse herds (schema_v59): the app, the horse page, the dashboard ----------
const HERD_KINDS = { stallion: 'Азарганы сүрэг', geldings: 'Агтны сүрэг', mares: 'Гүүний зэл',
                     young: 'Унага, даага', other: 'Бусад' };
// how the herd was last seen
const HERD_SOURCES = { tap: '📍 малчин тэмдэглэсэн', scan: '📶 таг уншуулсан', public: '👤 хүн таг уншуулсан',
                       ble: '📡 BLE таг', collar: '🛰 хүзүүвч' };
const HERD_REMIND_DAYS = [1, 2, 3, 5, 7, 10, 14, 30];
// "5 минутын өмнө", "өнөөдөр 14:30", "өчигдөр 09:10", "4 хоногийн өмнө"
function agoText(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - Date.parse(ts)) / 60000);
  if (min < 1) return 'дөнгөж сая';
  if (min < 60) return `${min} минутын өмнө`;
  const day = mnDate(new Date(ts)), today = mnDate(), p = mnParts(ts);
  if (day === today) return `өнөөдөр ${p.h}:${p.mi}`;
  if (day === mnDate(new Date(Date.now() - 86400000))) return `өчигдөр ${p.h}:${p.mi}`;
  return `${Math.max(2, Math.round((Date.parse(today) - Date.parse(day)) / 86400000))} хоногийн өмнө`;
}
// whole days a herd has not been seen (since it was made, if never)
function herdDaysUnseen(h) {
  const t = h.last_seen_at || h.created_at;
  return t ? Math.max(0, Math.floor((Date.now() - Date.parse(t)) / 86400000)) : null;
}
const herdOverdue = h => h.remind_days != null && herdDaysUnseen(h) >= h.remind_days;
// a mare's foaling window's end: "06/08", with the year when it is another
// year than the start ("2026/12/20 – 2027/02/08")
function windowEnd(start, end) {
  const a = fmtDate(start), b = fmtDate(end);
  return a.slice(0, 4) === b.slice(0, 4) ? b.slice(5) : b;
}

// a refused milk save (locked, or another person's entry) in plain words
function milkError(msg) {
  return /row-level security|permission denied/i.test(String((msg && msg.message) || msg || ''))
    ? MILK_LOCKED : mnError(msg);
}

function mnError(msg) {
  let s = String((msg && msg.message) || msg || '');
  for (const [re, mn] of MN_ERRORS) s = s.replace(re, mn);
  return s;
}

// Whole days from today (Mongolia) to a YYYY-MM-DD date: 0 = today.
// new Date('YYYY-MM-DD') is midnight UTC = 08:00 here, so the old
// version counted one day too many before 08:00.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((Date.parse(String(dateStr).slice(0, 10)) - Date.parse(mnDate())) / 86400000);
}
