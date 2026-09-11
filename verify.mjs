/*
 * Verifies dice-wallet-generator.html — the whole product, in one file.
 * Run:  node verify.mjs
 *
 * The page is the only artifact, so there is nothing to compare it against;
 * what this does is re-establish the claim "this is correct" on any machine,
 * including offline ones:
 *
 *   1. The page's own self-test, executed by loading its script into a sandbox.
 *   2. A differential test: build phrases with node:crypto (an implementation
 *      that shares no code with the page), strip the last word, and confirm the
 *      page recovers it — 300 random seeds at both 12 and 24 words.
 *   3. The dice half the same way: an independent roll → word mapping, the
 *      README's worked examples, and 300 runs of the whole procedure — rolls →
 *      23 words → 8 candidates → three more rolls → a valid 24-word mnemonic.
 *   4. The ◆ mark, driven through the render path the page actually uses.
 *
 * Nothing here is needed to *use* the tool.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';

const PAGE = path.join(import.meta.dirname, 'dice-wallet-generator.html');
if (!fs.existsSync(PAGE)) {
  console.log(`\ndice-wallet-generator.html — MISSING (it is the product; nothing to verify)`);
  process.exit(1);
}
const html = fs.readFileSync(PAGE, 'utf8');

let failed = 0;
const report = (name, pass, detail = '') => {
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) failed++;
};

/* ---------- load the page's script with a stub DOM ---------- */
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

function mkEl() {
  const el = {
    textContent: '', className: '', innerHTML: '', value: '', title: '', type: '',
    style: {}, children: [], parentElement: {},
    // A fragment is not an element: appending one puts its children in, which
    // is how render() adds the candidate rows.
    appendChild(c) { this.children.push(...(c && c.isFragment ? c.children : [c])); return c; },
    append(...c) { for (const x of c) this.appendChild(x); },
    replaceChildren(...c) { this.children = []; for (const x of c) this.appendChild(x); },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    addEventListener() {}, setAttribute() {}, focus() {},
    querySelector() { return mkEl(); },
  };
  // In a browser className and classList are two views of one thing; the ◆
  // marker uses both, so the stub has to as well.
  el.classList = {
    contains: c => (el.className || '').split(/\s+/).includes(c),
    add: c => { if (!el.classList.contains(c)) el.className = ((el.className || '') + ' ' + c).trim(); },
    remove: c => { el.className = (el.className || '').split(/\s+/).filter(x => x && x !== c).join(' '); },
  };
  return el;
}
const byId = new Map();
const ctx = {
  console, TextEncoder, Uint8Array, Uint32Array, DataView, Map, Set, Math, Array,
  String, Number, RegExp, setTimeout,
  document: {
    getElementById: id => { if (!byId.has(id)) byId.set(id, mkEl()); return byId.get(id); },
    createElement: mkEl, querySelector: mkEl,
    createDocumentFragment: () => { const f = mkEl(); f.isFragment = true; return f; },
    body: { appendChild() {}, removeChild() {} },
  },
  navigator: {},
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

console.log('\nself-test (executed from the page itself)');
const results = ctx.selfTest();
for (const r of results) report(r.name, r.pass, r.pass ? '' : `got ${r.got}, want ${r.want}`);
console.log(`  ${results.filter(r => r.pass).length}/${results.length} passed`);

// The half of this file that was once two files shows it: the dice half used to
// repeat the wordlist rows verbatim, two of them under the same name, while
// testing none of the dice arithmetic. Duplicate names are now a failure, and
// each half has to be present.
const names = results.map(r => r.name);
report('every self-test name is unique', new Set(names).size === names.length,
       names.filter((n, i) => names.indexOf(n) !== i).join(', '));
report('the self-test covers both halves (BIP39 core and dice)',
       names.some(n => /SHA-256/.test(n)) && names.some(n => /roll|candidate/.test(n)),
       `${results.length} checks`);

/* ---------- the wordlist, checked without the page's help ---------- */
const WORDLIST = JSON.parse(src.match(/const WORDLIST = (\[[\s\S]*?\]);/)[1]);
// The hash the page carries, and the hash of the words actually embedded in it,
// against the documented constant. The page's own SHA-256 is checked by its
// self-test; this is node:crypto on the same bytes.
const LIST_HASH = '187db04a869dd9bc7be80d21a86497d692c0db6abd3aa8cb6be5d618ff757fae';
const declared = (src.match(/const LIST_HASH = '([0-9a-f]{64})'/) || [])[1];
const actual = crypto.createHash('sha256').update(WORDLIST.join('\n')).digest('hex');

console.log('\nwordlist properties the algorithm depends on');
report('2048 words, all unique', WORDLIST.length === 2048 && new Set(WORDLIST).size === 2048);
// The prefix filter would silently hide the right word if two entries shared
// four leading letters, so this is a correctness property, not a nicety.
report('first 4 letters identify a word uniquely',
       new Set(WORDLIST.map(w => w.slice(0, 4))).size === WORDLIST.length);
report('lexicographically sorted', WORDLIST.every((w, i) => i === 0 || WORDLIST[i - 1] < w));
report('embedded words hash to the documented SHA-256', actual === LIST_HASH, actual);
report('the page declares that same hash', declared === LIST_HASH, declared || 'not found');
report('the README word is where the README says (#1129 = minor)', WORDLIST[1129] === 'minor');

/* ---------- the official BIP39 list, when a copy of it sits alongside ----------
 * The hash above is a constant this file asserts. This is the same claim in the
 * form a person can repeat — the published english.txt, word for word, checked
 * by shasum or by eye. The page never reads it: it has to run alone on the
 * airgapped machine, so a copy that is not here is noted, not failed.
 */
const REFERENCE = path.join(import.meta.dirname, 'bip39-english.txt');
const REFERENCE_HASH = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
console.log('\nreference list — bip39-english.txt');
if (!fs.existsSync(REFERENCE)) {
  console.log('  note  no reference copy here — the word-for-word check against the official list was skipped');
} else {
  const refBytes = fs.readFileSync(REFERENCE, 'utf8');
  const refHash = crypto.createHash('sha256').update(refBytes, 'utf8').digest('hex');
  const refWords = refBytes.replace(/\n$/, '').split('\n');
  report('the reference copy is the official BIP39 english.txt', refHash === REFERENCE_HASH, refHash);
  report('one word per line, 2048 of them', refWords.length === 2048, `${refWords.length} lines`);
  const same = refWords.length === WORDLIST.length && refWords.every((w, i) => w === WORDLIST[i]);
  report('the page embeds that list word for word', same,
         same ? '' : `the lists differ (${refWords.length} words vs ${WORDLIST.length})`);
}

/* ---------- differential test against node:crypto ---------- */
const readBits = bytes => {
  const b = [];
  for (const x of bytes) for (let i = 7; i >= 0; i--) b.push((x >> i) & 1);
  return b;
};
/** Independent BIP39 encoder, built on node:crypto rather than the page's SHA-256. */
function bip39(entBytes) {
  const h = crypto.createHash('sha256').update(entBytes).digest();
  const cs = entBytes.length * 8 / 32;
  const bits = readBits(entBytes).concat(readBits(h).slice(0, cs));
  const out = [];
  for (let i = 0; i < bits.length; i += 11) {
    out.push(WORDLIST[bits.slice(i, i + 11).reduce((a, b) => (a << 1) | b, 0)]);
  }
  return out;
}

console.log('\ndifferential test vs node:crypto (300 random seeds × 12 and 24 words)');
const TRIALS = 300;
let recovered = 0, misses = 0, prefixLoss = 0, verifyFail = 0;
const sizes = new Set();

for (let t = 0; t < TRIALS; t++) {
  for (const nBytes of [16, 32]) {
    const phrase = bip39(crypto.randomBytes(nBytes));
    const truth = phrase[phrase.length - 1];
    const known = phrase.slice(0, -1);

    if (!ctx.compute(known, '').candidates.some(c => c.word === truth)) misses++;
    else recovered++;

    if (!ctx.compute(known, truth.slice(0, 2)).candidates.some(c => c.word === truth)) prefixLoss++;
    if (!ctx.compute(phrase, '').valid) verifyFail++;
    sizes.add(ctx.compute(known, '').candidates.length);
  }
}
report(`${recovered} phrases recovered`, misses === 0, misses ? `${misses} misses` : '');
report('prefix filter never drops the true word', prefixLoss === 0, prefixLoss ? `${prefixLoss} losses` : '');
report('complete phrases verify as valid', verifyFail === 0, verifyFail ? `${verifyFail} failures` : '');
report('candidate counts match theory (8 and 128)', sizes.size === 2 && sizes.has(8) && sizes.has(128),
       [...sizes].sort((a, b) => a - b).join(', '));

/* ---------- offline guarantees ---------- */
function checkOffline() {
  console.log('\noffline guarantees');
  const CALLS = /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts)\s*\(/g;
  const calls = [...html.matchAll(CALLS)].map(m => m[1]);
  report('no network-capable APIs used', calls.length === 0, calls.join(', '));

  const urls = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\//g)];
  report('no external resources referenced', urls.length === 0, `${urls.length} found`);

  const storage = /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/;
  report('no storage writes', !storage.test(src));

  report('CSP declared', /Content-Security-Policy/.test(html) && /default-src 'none'/.test(html));
}

/* ---------- the ids the script reaches for ----------
 * The stub DOM invents whatever the script asks for, so a mistyped id — the one
 * failure that leaves a browser page dead — is invisible to every check above.
 */
function checkIds() {
  console.log('\nelement ids');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const wanted = [
    ...[...src.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)].map(m => m[1] || m[2]),
    ...[...src.matchAll(/querySelector\('#([\w-]+)/g)].map(m => m[1]),
  ];
  const missing = [...new Set(wanted)].filter(id => !ids.includes(id));
  report('every element id the script uses exists in the page', missing.length === 0, missing.join(', '));
  report('no duplicate element ids', new Set(ids).size === ids.length,
         ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
}

/* ---------- the rolls panel, as it is actually typed into ----------
 * The functions above are exercised directly, but renderRolls() — the one the
 * page runs on every keystroke — was not, and it hid a real bug for a while:
 * badDigits comes from filter(), and [] is truthy, so `if (badChars || badDigits)`
 * rejected every input, valid rolls included. Drive the render path itself: the
 * stub hands back the same element for an id, so it can be typed into.
 */
function checkRollsPanel() {
  console.log('\nrolls panel, as typed');
  const el = id => ctx.document.getElementById(id);
  const type = v => { el('rolls').value = v; ctx.renderRolls(); };
  const rows = () => el('rolls-out').children;
  const status = () => el('rolls-status').textContent;

  type('3 1 4 2 1 4');
  report('valid rolls render a word, not an error',
         rows().length === 1 && el('rolls-status').className === 'status',
         `${rows().length} row(s), status "${status()}"`);
  // row is  ['Word 1  ', <span.w>minor</span>, <span.meta>word #1129 …</span>]
  const row = rows()[0] || { children: [] };
  report('valid rolls show the README word (minor, #1129)',
         row.children[1] && row.children[1].textContent === 'minor'
         && /1129/.test((row.children[2] || {}).textContent || ''),
         row.children[1] ? `${row.children[1].textContent} / ${row.children[2].textContent}` : 'nothing rendered');

  type('3 1 4 2 1 4 3 1 4 2 1 4');
  report('two words of rolls render two words', rows().length === 2, `${rows().length} rows`);

  type('3 1 4');
  report('a part-typed word says how many rolls are missing',
         rows().length === 1 && /needs 3 more roll/.test(status()), status());

  // 5 is a legal die, just not in the five 2-bit slots — that is the row's
  // business, not parseRolls', so the word is shown with the reroll instead.
  type('5 1 4 2 1 4');
  report('a 5 in a 2-bit slot asks for a reroll on that word',
         rows().length === 1 && /reroll it/.test(JSON.stringify(rows())) && /0 words/.test(status()),
         status());

  type('1 2 7 1 2 3');
  report('a digit past 6 is refused, with a count',
         rows().length === 0 && /1 digit\(s\) outside 1–6/.test(status()), status());

  type('1 2 3x 1 2 3');
  report('non-digits are counted separately',
         rows().length === 0 && /1 character\(s\) that are not digits/.test(status()), status());

  type('1 2 7 1 2 3x');
  report('both faults are reported together',
         /1 character\(s\) that are not digits and 1 digit\(s\) outside 1–6/.test(status()), status());

  type('');
  report('clearing the box clears the status', status() === '' && rows().length === 0, status());
}

/* ---------- the dice half ---------- */
function checkDice() {
  console.log('\nrolls → words, against an independent mapping (50 words)');
  const PAIR = { 1: '00', 2: '01', 3: '10', 4: '11' };
  let rollFail = 0;
  for (let t = 0; t < 50; t++) {
    const rolls = [];
    for (let p = 0; p < 5; p++) rolls.push(crypto.randomInt(1, 5));
    rolls.push(crypto.randomInt(1, 7));
    const got = ctx.wordsFromRolls(rolls)[0];
    const bits = rolls.map((r, i) => i === 5 ? (r <= 3 ? '0' : '1') : PAIR[r]).join('');
    const idx = parseInt(bits, 2);
    if (!got || got.idx !== idx || got.word !== WORDLIST[idx]) rollFail++;
  }
  report('rolls → words matches independent mapping', rollFail === 0, `${rollFail} mismatches`);

  const ex = ctx.wordsFromRolls([3, 1, 4, 2, 1, 4])[0];
  report('worked example: rolls 3 1 4 2 1 4 → "minor"',
         ex && ex.idx === 1129 && ex.word === 'minor' && ex.bits === '10001101001',
         ex ? `got ${ex.word}` : 'no word produced');

  /* End to end, exactly as README.md describes it: 23 words of dice rolls,
   * 8 candidates for the 24th, three more rolls to choose one. */
  let e2eFail = 0;
  const candCounts = new Set();
  for (let t = 0; t < TRIALS; t++) {
    const rolls = [];
    for (let i = 0; i < 23 * 6; i++) rolls.push(i % 6 === 5 ? crypto.randomInt(1, 7) : crypto.randomInt(1, 5));
    const words = ctx.wordsFromRolls(rolls).map(w => w.word);
    const res = ctx.compute(words, '');
    candCounts.add(res.candidates.length);
    const pick = ctx.pickIndex(crypto.randomInt(1, 7), crypto.randomInt(1, 7), crypto.randomInt(1, 7));
    if (words.length !== 23 || res.candidates.length !== 8) e2eFail++;
    if (!ctx.compute(words.concat(res.candidates[pick].word), '').valid) e2eFail++;
  }
  console.log('\nwhole dice procedure, end to end (300 runs)');
  report('23 words of rolls → 8 candidates → a valid 24-word mnemonic',
         e2eFail === 0, e2eFail ? `${e2eFail} failures` : '');
  report('every dice run yields exactly 8 candidates', candCounts.size === 1 && candCounts.has(8),
         [...candCounts].join(', '));

  // 216 = 8 × 27 exactly, which is why the 24th word needs no reroll.
  const hist = new Array(8).fill(0);
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) hist[ctx.pickIndex(a, b, c)]++;
  report('all 216 roll triples split evenly over the 8 candidates',
         hist.every(n => n === 27), hist.join(', '));
  report('worked example: rolls 2 5 6 → candidate #2', ctx.pickIndex(2, 5, 6) === 1);
}

/* ---------- the ◆ mark ----------
 * It belongs to the rolls in the box right now: changing them must move it,
 * clearing them must take it off. Two marks — or one left behind by an empty
 * box — reads as two candidates both being the dice's choice.
 */
function checkMark() {
  console.log('\nthe ◆ mark follows the 24th-word rolls');
  const el = id => ctx.document.getElementById(id);
  const marked = () => ctx.candidateRows().filter(r => r.classList.contains('picked'));
  // the ◆ badge hangs off the row's body div, so walk the whole subtree
  const countBadges = e => Array.prototype.slice.call(e.children || []).reduce((n, kid) =>
    n + (kid && /\bpickmark\b/.test(kid.className || '') ? 1 : 0) + (kid && kid.children ? countBadges(kid) : 0), 0);
  const badges = () => ctx.candidateRows().reduce((n, r) => n + countBadges(r), 0);
  const markDesc = () => marked().length + ' marked, ' + badges() + ' badge(s)'
    + (marked().length ? ', at row ' + ctx.candidateRows().indexOf(marked()[0]) : '');

  el('phrase').value = Array(23).fill('abandon').join(' ');
  ctx.render();
  report('23 words give 8 rows to mark', ctx.candidateRows().length === 8,
         ctx.candidateRows().length + ' rows');

  el('pick').value = '6 5 6';
  ctx.markPicked();
  report('rolls 6 5 6 mark candidate #2 (the README example)',
         marked().length === 1 && ctx.candidateRows().indexOf(marked()[0]) === 1, markDesc());

  el('pick').value = '1 1 1';
  ctx.markPicked();
  report('changing the rolls moves the mark instead of adding a second',
         marked().length === 1 && ctx.candidateRows().indexOf(marked()[0]) === 0 && badges() === 1, markDesc());

  el('pick').value = '';
  ctx.markPicked();
  report('clearing the rolls clears the mark', marked().length === 0 && badges() === 0, markDesc());

  el('pick').value = '9';
  ctx.markPicked();
  report('a bad roll leaves no mark behind', marked().length === 0 && badges() === 0, markDesc());

  // The mark must also survive — and follow — a re-render of the list itself,
  // which is what typing in the phrase box does on every keystroke.
  el('pick').value = '6 5 6';
  ctx.render();
  ctx.markPicked();
  el('phrase').value = Array(23).fill('abandon').join(' ') + ' ';
  ctx.step2Changed();
  report('re-rendering the list keeps exactly one mark on the same candidate',
         marked().length === 1 && badges() === 1 && ctx.candidateRows().indexOf(marked()[0]) === 1, markDesc());
}

checkOffline();
checkIds();
checkRollsPanel();
checkDice();
checkMark();

console.log(failed === 0 ? '\nALL CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
