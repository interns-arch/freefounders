/**
 * Weak-password warning (docs/security/platform.md R3; founder 2026-10-13: warn, never block). A pure check, run as the
 * password is typed: the Platform still accepts anything of 6+ characters. Kept small on purpose (a few KB, no list
 * download): the most common passwords and words people build them from, simple patterns, and the person's own names.
 */

/** Why a password is easy to guess. */
export type PasswordWeakness = 'common' | 'pattern' | 'personal';

/** What the password must not be built from (case does not matter). */
export interface PasswordAbout {
  fullName?: string | null;
  username?: string | null;
  email?: string | null;
  companyName?: string | null;
}

export const PASSWORD_WEAKNESS_LABELS: Record<PasswordWeakness, string> = {
  common: 'common password',
  pattern: 'simple pattern like 123456 or qwerty',
  personal: 'it contains a name, username, email or the company name',
};

// The most used passwords, and the words most of the rest are made of (a digit, year or symbol added at the end is
// stripped before looking a password up, and @→a, 0→o, 1→i, 3→e, $→s… are undone).
const COMMON = new Set(
  `password passwd pass passcode secret letmein welcome trustno1 iloveyou loveyou lovely love mylove lover admin
administrator root user username login guest test tester demo default changeme sample temp temporary access master
superman batman spiderman ironman hulk thor dragon monkey shadow sunshine princess prince king queen angel angels
football baseball basketball soccer cricket hockey tennis golf chelsea arsenal liverpool barcelona realmadrid
manchester united juventus messi ronaldo dhoni sachin virat kohli tendulkar michael jordan jennifer jessica ashley
charlie daniel thomas robert andrew george hunter ranger buster tigger ginger pepper maggie summer winter spring autumn
freedom whatever nothing something everything computer internet samsung iphone apple google facebook instagram
whatsapp twitter youtube hello hi flower sunflower butterfly chocolate cookie cookies banana orange purple yellow
silver golden gold diamond starwars pokemon naruto killer matrix mustang ferrari porsche mercedes bmw audi yamaha
honda toyota suzuki maruti hyundai mahindra tata india bharat hindustan mumbai delhi chennai kolkata bangalore
bengaluru hyderabad pune ahmedabad jaipur lucknow krishna radha ganesh ganesha ganpati shiva shivaji hanuman ram
rama sita sairam omsairam saibaba om jaimatadi jaishreeram jaishriram jaihind vandemataram lakshmi laxmi durga kali
murugan balaji tirupati allah bismillah mashallah inshallah jesus christ god blessed blessing faith family friends
friend forever happy smile money success rich lucky sweetheart sweety sweet cutie darling honey baby babygirl
babyboy mummy mommy mother daddy father papa mama brother sister home house office company business work
qwerty qwertz azerty asdf zxcv qazwsx abc abcd abcde xyz asd qwe zaq1 zaq12wsx 1qaz2wsx 1q2w3e4r 1q2w3e q1w2e3r4
a1b2c3 a1b2c3d4 aa123456 p4ssw0rd passw0rd hottie lovers jordan23 michelle nicole amanda matthew joshua anthony
william richard joseph david james john peter paul mark steven kevin jason justin brandon taylor hannah sophie
emily olivia emma grace lily daisy rose jasmine kitty kitten puppy doggy tiger lion eagle falcon phoenix cobra
viper wolf bear panda snoopy mickey minnie donald barbie elsa frozen disney marvel avengers hogwarts harrypotter
gandalf matrix neo zelda mario sonic minecraft fortnite pubg freefire gamer player legend warrior ninja samurai
soldier army navy police doctor engineer teacher student school college hostel cartrends freefounders mobile
phone laptop desktop windows linux android system server database network wifi router cisco oracle java python
coffee pizza burger biryani chicken mango paneer chai beer whisky vodka party music guitar piano rock metal
rockstar superstar star moon sun sky ocean river mountain earth fire water ice snow rain storm thunder lightning
heaven hell devil demon ghost zombie vampire magic wizard secret123 open opensesame sesame letmein1 mustang1 iloveu
ilovemyself myself mine yours ours goodluck goodbye goodday morning night midnight sunday monday tuesday wednesday
thursday friday saturday january february march april may june july august september october november december`
    .split(/\s+/)
    .filter(Boolean),
);

// Keyboard rows and columns, the alphabet and the digits: any 3+ characters along one of them (either way) is a walk.
const LINES = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwertzuiop', 'azertyuiop', '1234567890', 'abcdefghijklmnopqrstuvwxyz', 'qazwsxedcrfvtgbyhnujmikolp', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p'];
const WALKS = [...LINES, ...LINES.map((l) => [...l].reverse().join(''))];
const LEET: Record<string, string> = { '@': 'a', '4': 'a', '8': 'b', '3': 'e', '6': 'g', '1': 'i', '!': 'i', '0': 'o', $: 's', '5': 's', '7': 't', '2': 'z' };
// Words a company name often ends with; never a reason on their own.
const NOT_A_NAME = new Set(['the', 'and', 'pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'corp', 'company', 'group', 'india', 'solutions', 'services', 'technologies']);

const deleet = (s: string) => s.replace(/[@483617!0$52]/g, (c) => LEET[c] ?? c);
/** Without a prefix/suffix of digits and symbols ("Welcome@2024" -> "welcome"). */
const core = (s: string) => s.replace(/^[^a-z]+|[^a-z]+$/g, '');

function isSimple(s: string): boolean {
  if (!s) return false;
  if (/^(.)\1*$/.test(s)) return true; // aaaaaa, 111111
  if (s.length >= 3 && WALKS.some((w) => w.includes(s))) return true; // abcdef, 654321, qwerty, asdfgh, 1qaz2wsx
  return /^(.{1,4})\1+$/.test(s); // abab, 123123, a1a1a1
}

function isPattern(lower: string): boolean {
  const s = lower.replace(/[^a-z0-9]/g, '') || lower;
  if (/^\d+$/.test(s)) return true; // only digits: dates, phone numbers, 123456
  if (isSimple(s)) return true;
  // Two simple parts: qwerty123, abc123, asdf1234, aaa111.
  for (let i = 3; i < s.length; i++) if (isSimple(s.slice(0, i)) && isSimple(s.slice(i))) return true;
  return false;
}

function isCommon(lower: string): boolean {
  const tries = [lower, deleet(lower), core(lower), core(deleet(lower)), deleet(core(lower))];
  return tries.some((t) => t.length >= 2 && COMMON.has(t));
}

function personalWords(about: PasswordAbout): string[] {
  const out = new Set<string>();
  const add = (s: string | null | undefined, ignore?: Set<string>) => {
    const v = (s ?? '').toLowerCase().trim();
    if (!v) return;
    const joined = v.replace(/[^a-z0-9]/g, '');
    if (joined.length >= 3) out.add(joined);
    for (const part of v.split(/[^a-z0-9]+/)) if (part.length >= 3 && !ignore?.has(part)) out.add(part);
  };
  add(about.fullName);
  add(about.username);
  add(about.email?.split('@')[0]);
  add(about.companyName, NOT_A_NAME);
  return [...out];
}

/** Why this password is easy to guess, or null. Empty input: null. */
export function passwordWeakness(password: string, about: PasswordAbout = {}): PasswordWeakness | null {
  if (!password) return null;
  const lower = password.toLowerCase();
  const plain = deleet(lower).replace(/[^a-z0-9]/g, '');
  const words = personalWords(about);
  if (words.some((w) => lower.includes(w) || plain.includes(w))) return 'personal';
  if (isCommon(lower)) return 'common';
  if (isPattern(lower)) return 'pattern';
  return null;
}

/** The warning shown under a password field (never blocks saving), or null when the password is not weak. */
export function weakPasswordWarning(password: string, about: PasswordAbout = {}): string | null {
  const why = passwordWeakness(password, about);
  return why ? `Weak password: easy to guess (${PASSWORD_WEAKNESS_LABELS[why]}). You can still save it.` : null;
}
