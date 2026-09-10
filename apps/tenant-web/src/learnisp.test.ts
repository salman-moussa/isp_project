import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// LearnISP is generated from the field manual by scripts/learnisp/build.mjs and committed under
// public/learnisp so the web image serves it as static files. These checks read that output and
// run its inline script inside the test browser environment.
const root = path.resolve(__dirname, '..', 'public', 'learnisp');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const searchIndex = JSON.parse(fs.readFileSync(path.join(root, 'search-index.json'), 'utf8')) as {
  id: string;
  status: string;
  titleEn: string;
  titleAr: string;
  textEn: string;
  textAr: string;
}[];

interface LearnIspGlobals {
  setLang: (lang: string) => void;
  runSearch: () => void;
}
function mount(html: string): LearnIspGlobals {
  const body = /<body>([\s\S]*?)<\/body>/u.exec(html)?.[1] ?? '';
  const script = /<script>([\s\S]*?)<\/script>/u.exec(body)?.[1] ?? '';
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  localStorage.clear();
  document.body.innerHTML = body.replace(/<script>[\s\S]*?<\/script>/u, '');
  vi.stubGlobal('fetch', async () => ({ json: async () => searchIndex }));
  // The generated page ships plain inline script; running it here is the point of the test.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(
    `${script}\n;return { setLang: setLang, runSearch: runSearch };`,
  ) as () => LearnIspGlobals;
  return run();
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});

describe('LearnISP generated reference', () => {
  it('has a direct route per module with both languages and a status', () => {
    expect(searchIndex.length).toBeGreaterThanOrEqual(20);
    for (const module of searchIndex) {
      const page = fs.readFileSync(path.join(root, module.id, 'index.html'), 'utf8');
      expect(page).toContain(`<section class="module" id="${module.id}">`);
      expect(page).toContain('lang="ar"');
      expect(page).toContain(`<li aria-current="page"><a href="/learnisp/${module.id}/">`);
      expect(module.titleEn.length).toBeGreaterThan(0);
      expect(module.titleAr.length).toBeGreaterThan(0);
      expect(['live', 'partial', 'planned', 'human']).toContain(module.status);
    }
    expect(searchIndex.map((m) => m.id)).toEqual(
      expect.arrayContaining(['payments', 'collectors', 'regulatory', 'people', 'control']),
    );
    expect(index).not.toMatch(/demo|demonstration/iu);
  });

  it('switches to Arabic RTL and searches the Arabic text', async () => {
    const page = mount(index);
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    page.setLang('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.getElementById('lang-ar')?.getAttribute('aria-pressed')).toBe('true');
    const input = document.getElementById('ls-search') as HTMLInputElement;
    input.value = 'الصندوق';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const results = document.getElementById('ls-results') as HTMLUListElement;
    expect(results.hidden).toBe(false);
    const links = Array.from(results.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/learnisp/payments/');
    expect(results.textContent).toContain('الدفعات والصندوق');
  });

  it('searches English text, links to the module route and reports no results', async () => {
    mount(index);
    const input = document.getElementById('ls-search') as HTMLInputElement;
    input.value = 'declared cash';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const results = document.getElementById('ls-results') as HTMLUListElement;
    const links = Array.from(results.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/learnisp/collectors/');
    input.value = 'zzqx-no-such-term';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(results.textContent).toBe('No results');
  });
});
