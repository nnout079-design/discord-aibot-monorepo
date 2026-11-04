/**
 * Content scanner for the moderation bot.
 *
 * Tiers, escalation handled in index.ts:
 *   CRITICAL - sexual/minor references  -> delete + 1h timeout + alert
 *   HIGH     - slurs, "gay" as insult   -> delete + warn; 2nd -> 10m timeout
 *   MEDIUM   - profanity and bypasses   -> delete + warn; 3rd -> 10m timeout
 *   LOW      - soliciting/begging, mod disrespect -> flag only
 */

export type OffenceTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

const LEET: Record<string, string> = {
  '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '|': 'i',
  '0': 'o', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b',
};

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[4@31!|05$7+8]/g, c => LEET[c] ?? c);
}

const CRITICAL: RegExp[] = [
  /j+ai+l+\s*-?\s*b+ai+t+/i,         // jailbait / jail bait / j4ilbait
  /\bl+o+l+i+\w*\b/i,                // loli, lolicon
  /\bp+edo+\w*\b/i,                  // pedo, pedophile
  /\bpdf\s*file\b/i,                 // "pdf file" euphemism
  /\bc+\s*p+\b/i,                    // "cp"
];

const HIGH: RegExp[] = [
  /\bf+ag{1,2}o?t+\b/i,              // fag, faggot
  /\br+et+a+rd+e?d?\b/i,             // retard(ed)
  /\bn+[i1!]+g+[g4e3r]+[a4e3r]*\b/i, // n-word variants
  /\b(?:ur|u r|you'?re?|you are|ya'?ll|yall)\b(?:\s+\w+){0,4}\s+(?:gay|fag)\b/i,
                                     // "ur gay", "ur ugly and gay", "you are so gay"
  /\b(?:that'?s|thats)\s+(?:so\s+|fucking\s+)?(?:gay|fag)\b/i,
                                     // "that's gay", "thats so gay"
];

const MEDIUM: RegExp[] = [
  /f+u+c+k+\w*/i,                    // fuck, fucker, fucking
  /\bf+c+k+\b/i,                     // fck
  /\bf+u+k+\b/i,                     // fuk
  /\bf+o+n+k+\b/i,                   // fonk (observed bypass)
  /\bf+u+c+c+\b/i,                   // fucc
  /\bp+h+u+c+k+\w*\b/i,              // phuck
  /\bf+udg+e+\b/i,                   // fudge (minced oath)
  /\bs+h+i+t+\w*\b/i,                // shit, shitty
  /\bb+i+t+c+h+\w*\b/i,              // bitch
  /\bc+u+n+t+\b/i,
  /\bd+i+c+k+\w*\b/i,
  /\bp+u+s{2}y+\b/i,
  /\bs+t+f+u+\b/i,
  /\bg+t+f+o+\b/i,
  /🖕/,                              // middle-finger emoji
];

const LOW: RegExp[] = [
  /(?:gimme|give me|send me|buy me|donate(?:\s+me)?)\b.{0,40}\b(?:money|cash|\$|ticket|nitro|gift|paypal|cash ?app|venmo)/i,
  /\b(?:cash ?app|venmo|paypal)\b.{0,20}\$/i,
  /\b(?:useless|trash|shitty|corrupt|garbage)\s+(?:mods?|admins?|staff)\b/i,
];

const TIERS: Record<OffenceTier, RegExp[]> = { CRITICAL, HIGH, MEDIUM, LOW };

export function scan(text: string): OffenceTier | null {
  const norm = normalize(text);
  for (const tier of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const) {
    if (TIERS[tier].some(p => p.test(norm))) return tier;
  }
  return null;
}
