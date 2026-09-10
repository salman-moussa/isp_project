#!/usr/bin/env node
// LearnISP: a generated, bilingual, searchable reference built only from the field manual that
// documents implemented behaviour (apps/tenant-web/public/guide.html). Every module gets a direct
// route under /learnisp/<module>/, the index carries a client-side search over both languages, and
// the output is committed so the web image serves it as static files. Run with --check to verify
// the committed output matches the manual.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const guidePath = path.join(root, 'apps', 'tenant-web', 'public', 'guide.html');
const outputDir = path.join(root, 'apps', 'tenant-web', 'public', 'learnisp');
const check = process.argv.includes('--check');

const guide = fs.readFileSync(guidePath, 'utf8');
const style = /<style>([\s\S]*?)<\/style>/u.exec(guide)?.[1];
if (!style) throw new Error('guide.html has no <style> block');
const release = /release (\d{4}-\d{2}-\d{2})/u.exec(guide)?.[1] ?? 'unknown';

function text(html, lang) {
  // Keep only the requested language's spans/items, then strip tags and collapse whitespace.
  const other = lang === 'en' ? 'ar' : 'en';
  return html
    .replace(
      new RegExp(`<(span|li|p|td|th|h[1-6])[^>]*lang="${other}"[^>]*>[\\s\\S]*?<\\/\\1>`, 'gu'),
      ' ',
    )
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&nbsp;/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
function label(html, lang) {
  const match = new RegExp(`<span lang="${lang}"[^>]*>([\\s\\S]*?)<\\/span>`, 'u').exec(html);
  return match ? text(match[1], lang).replace(/\s+/gu, ' ').trim() || text(match[0], lang) : '';
}

const sections = [];
const sectionPattern = /<section class="module" id="([a-z-]+)">([\s\S]*?)\n {8}<\/section>/gu;
let match;
while ((match = sectionPattern.exec(guide))) {
  const [, id, body] = match;
  const heading = /<h2>([\s\S]*?)<\/h2>/u.exec(body)?.[1] ?? '';
  const pill = /class="pill (live|partial|planned|human)"/u.exec(body)?.[1] ?? 'planned';
  const pillHtml =
    /<span class="pill [a-z]+"[\s\S]*?<\/span\s*>\s*<\/span>|<span class="pill [a-z]+">[\s\S]*?<\/span>\s*<\/span>|<span class="pill [a-z]+">[\s\S]*?<\/span><\/span>/u.exec(
      body,
    )?.[0];
  sections.push({
    id,
    status: pill,
    titleEn: label(heading, 'en'),
    titleAr: label(heading, 'ar'),
    statusEn: pillHtml ? label(pillHtml, 'en') : '',
    statusAr: pillHtml ? label(pillHtml, 'ar') : '',
    body,
    searchEn: text(body, 'en'),
    searchAr: text(body, 'ar'),
  });
}
if (sections.length < 10) throw new Error(`only ${sections.length} modules found in the manual`);
const lede = /<section class="lede" id="overview">([\s\S]*?)<\/section>/u.exec(guide)?.[1] ?? '';

const statusLabels = {
  live: ['Live', 'مفعّل'],
  partial: ['Partially delivered', 'منجز جزئياً'],
  planned: ['Planned', 'مخطط'],
  human: ['Needs a human step', 'يحتاج خطوة بشرية'],
};
const shellStyle = `
      .ls-bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
      .ls-search { display: grid; gap: 0.4rem; margin: 0 0 1.2rem; }
      .ls-search input { font: inherit; padding: 0.6rem 0.8rem; border: 1px solid var(--line-2); border-radius: 0.6rem; background: var(--surface); color: var(--ink); width: 100%; }
      .ls-results { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
      .ls-results li { padding: 0.6rem 0.8rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); }
      .ls-results a { font-weight: 600; }
      .ls-results small { display: block; color: var(--ink-3); }
      .ls-modules { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 0.6rem; }
      .ls-modules li { padding: 0.8rem 0.9rem; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--surface); display: grid; gap: 0.3rem; }
      .ls-modules a { font-weight: 600; text-decoration: none; }
      .ls-crumbs { font-size: 0.85rem; color: var(--ink-3); margin: 0 0 0.6rem; }
      .ls-crumbs a { color: inherit; }
      .ls-hidden { display: none !important; }
      html[lang='en'] [lang='ar'], html[lang='ar'] [lang='en'] { display: none; }
`;
const script = `
      function setLang(lang) {
        var root = document.documentElement;
        root.lang = lang;
        root.dir = lang === 'ar' ? 'rtl' : 'ltr';
        document.getElementById('lang-en').setAttribute('aria-pressed', String(lang === 'en'));
        document.getElementById('lang-ar').setAttribute('aria-pressed', String(lang === 'ar'));
        try { localStorage.setItem('orvex-guide-lang', lang); } catch (e) {}
        if (typeof runSearch === 'function') runSearch();
      }
      try {
        var saved = localStorage.getItem('orvex-guide-lang');
        if (saved === 'ar' || (!saved && /^ar\\b/.test(navigator.language || ''))) setLang('ar');
      } catch (e) {}
      var searchIndex = null;
      function runSearch() {
        var input = document.getElementById('ls-search');
        var list = document.getElementById('ls-results');
        if (!input || !list) return;
        var query = input.value.trim().toLowerCase();
        var lang = document.documentElement.lang === 'ar' ? 'ar' : 'en';
        list.innerHTML = '';
        if (!query) { list.hidden = true; return; }
        var load = searchIndex ? Promise.resolve(searchIndex) : fetch('/learnisp/search-index.json').then(function (r) { return r.json(); }).then(function (j) { searchIndex = j; return j; });
        load.then(function (index) {
          if (input.value.trim().toLowerCase() !== query) return;
          var hits = index.filter(function (m) {
            return (lang === 'ar' ? m.titleAr + ' ' + m.textAr : m.titleEn + ' ' + m.textEn).toLowerCase().indexOf(query) >= 0;
          });
          list.hidden = false;
          if (!hits.length) {
            var none = document.createElement('li');
            none.textContent = lang === 'ar' ? 'لا نتائج' : 'No results';
            list.appendChild(none);
            return;
          }
          hits.forEach(function (m) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = '/learnisp/' + m.id + '/';
            a.textContent = lang === 'ar' ? m.titleAr : m.titleEn;
            var small = document.createElement('small');
            var hay = lang === 'ar' ? m.textAr : m.textEn;
            var at = hay.toLowerCase().indexOf(query);
            small.textContent = hay.slice(Math.max(0, at - 60), at + 120);
            li.appendChild(a);
            li.appendChild(small);
            list.appendChild(li);
          });
        });
      }
      var searchInput = document.getElementById('ls-search');
      if (searchInput) searchInput.addEventListener('input', runSearch);
`;

function page({ title, description, main, current }) {
  const nav = sections
    .map(
      (s) =>
        `<li${s.id === current ? ' aria-current="page"' : ''}><a href="/learnisp/${s.id}/"><span lang="en">${s.titleEn}</span><span lang="ar">${s.titleAr}</span></a></li>`,
    )
    .join('\n          ');
  return `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
    <style>${style}${shellStyle}
    </style>
  </head>
  <body>
    <div class="bar ls-bar">
      <div>
        <strong><a href="/learnisp/" style="text-decoration:none;color:inherit">LearnISP</a></strong>
        <span class="meta"><span lang="en">Orvex ISP reference · built from release ${release}</span><span lang="ar">مرجع Orvex ISP · مبني من إصدار ${release}</span></span>
      </div>
      <div role="group" aria-label="Language">
        <button type="button" id="lang-en" aria-pressed="true" onclick="setLang('en')">English</button>
        <button type="button" id="lang-ar" aria-pressed="false" onclick="setLang('ar')">العربية</button>
      </div>
    </div>
    <div class="frame">
      <nav class="index" aria-label="Modules">
        <ol>
          <li${current ? '' : ' aria-current="page"'}><a href="/learnisp/"><span lang="en">Start here</span><span lang="ar">ابدأ هنا</span></a></li>
          <li><a href="/guide.html"><span lang="en">Full field manual</span><span lang="ar">الدليل الميداني الكامل</span></a></li>
          ${nav}
        </ol>
      </nav>
      <main>
        ${main}
      </main>
    </div>
    <script>${script}
    </script>
  </body>
</html>
`;
}

const counts = { live: 0, partial: 0, planned: 0, human: 0 };
for (const s of sections) counts[s.status] += 1;
const indexMain = `
        <section class="lede">
          <h1><span lang="en">Learn Orvex ISP</span><span lang="ar">تعلّم Orvex ISP</span></h1>
          <p class="sub">
            <span lang="en">Every module of the product, described as it exists in the current release, with what is live, what is partially delivered, and what still needs a human step. Search in English or Arabic, or open a module directly.</span>
            <span lang="ar">كل وحدة في المنتج كما هي في الإصدار الحالي، مع ما هو مفعّل وما هو منجز جزئياً وما يحتاج خطوة بشرية. ابحث بالإنجليزية أو العربية، أو افتح وحدة مباشرة.</span>
          </p>
          <p class="sub">
            <span lang="en">${counts.live} live · ${counts.partial} partially delivered · ${counts.planned} planned · ${counts.human} human steps</span>
            <span lang="ar">${counts.live} مفعّل · ${counts.partial} منجز جزئياً · ${counts.planned} مخطط · ${counts.human} خطوات بشرية</span>
          </p>
        </section>
        <form class="ls-search" role="search" onsubmit="event.preventDefault(); runSearch();">
          <label for="ls-search"><span lang="en">Search modules, screens, rules and permissions</span><span lang="ar">ابحث في الوحدات والشاشات والقواعد والصلاحيات</span></label>
          <input id="ls-search" type="search" autocomplete="off" />
          <ul id="ls-results" class="ls-results" hidden aria-live="polite"></ul>
        </form>
        <ul class="ls-modules">
          ${sections
            .map(
              (s) =>
                `<li><a href="/learnisp/${s.id}/"><span lang="en">${s.titleEn}</span><span lang="ar">${s.titleAr}</span></a><span class="pill ${s.status}"><span lang="en">${statusLabels[s.status][0]}</span><span lang="ar">${statusLabels[s.status][1]}</span></span></li>`,
            )
            .join('\n          ')}
        </ul>
        ${lede.replace(/<h1>[\s\S]*?<\/h1>/u, '')}
`;
const files = new Map();
files.set(
  'index.html',
  page({
    title: 'LearnISP · Orvex ISP',
    description:
      'Bilingual reference for every Orvex ISP module, generated from the field manual of the current release.',
    main: indexMain,
    current: '',
  }),
);
for (const s of sections) {
  const others = sections.filter((o) => o.status === s.status && o.id !== s.id).slice(0, 6);
  const main = `
        <p class="ls-crumbs"><a href="/learnisp/"><span lang="en">LearnISP</span><span lang="ar">تعلّم</span></a> / <span lang="en">${s.titleEn}</span><span lang="ar">${s.titleAr}</span></p>
        <section class="module" id="${s.id}">${s.body}
        </section>
        ${others.length ? `<section class="module"><header><h2><span lang="en">Related modules</span><span lang="ar">وحدات ذات صلة</span></h2></header><ul class="plain">${others.map((o) => `<li><a href="/learnisp/${o.id}/"><span lang="en">${o.titleEn}</span><span lang="ar">${o.titleAr}</span></a></li>`).join('')}</ul></section>` : ''}
`;
  files.set(
    `${s.id}/index.html`,
    page({
      title: `${s.titleEn} · LearnISP`,
      description: `${s.titleEn} in Orvex ISP: ${s.searchEn.slice(0, 150)}`,
      main,
      current: s.id,
    }),
  );
}
files.set(
  'search-index.json',
  JSON.stringify(
    sections.map((s) => ({
      id: s.id,
      status: s.status,
      titleEn: s.titleEn,
      titleAr: s.titleAr,
      textEn: s.searchEn,
      textAr: s.searchAr,
    })),
    null,
    0,
  ) + '\n',
);

if (check) {
  const stale = [];
  for (const [name, content] of files) {
    const target = path.join(outputDir, name);
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) stale.push(name);
  }
  if (stale.length) {
    console.error(
      `LearnISP output is stale (${stale.length} files): run npm run learnisp:build\n  ${stale.slice(0, 8).join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `LearnISP output matches the manual: ${sections.length} modules, ${files.size} files.`,
  );
} else {
  fs.rmSync(outputDir, { recursive: true, force: true });
  for (const [name, content] of files) {
    const target = path.join(outputDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  console.log(
    `LearnISP built: ${sections.length} modules, ${files.size} files in ${path.relative(root, outputDir)}.`,
  );
}
