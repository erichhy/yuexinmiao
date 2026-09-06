// 可选 · 自动抓取 Mochi Cat 全套 GIF（在你自己的电脑上跑，有网络）
// ---------------------------------------------------------------
// 为什么需要它：贴图站(GIFDB/Tenor)用 Cloudflare 拦爬虫，普通 curl 会被 403。
// Playwright 启动的是真实 Chromium，能正常加载，从而把图存到本地 assets/。
//
// 安装与运行：
//   npm i -D playwright
//   npx playwright install chromium
//   node download-mochi.js
// 跑完 assets/ 里就有 mochi-0_xxx.gif … 然后手动重命名/挑选 6 张对应状态，
// 或在 pet.html 的 PET.states[].src 里直接指向这些文件。
// （手动方式更稳：浏览器打开 gifdb.com/mochi-cat，逐张右键「图片另存为」即可。）

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');
const LIST_URL = 'https://gifdb.com/mochi-cat';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 60000 });

  const links = await page.$$eval(
    'a[href*="/gif/mochi-cat-"]',
    els => [...new Set(els.map(e => e.href))]
  );
  console.log(`找到 ${links.length} 个表情，开始下载到 assets/ …`);

  let i = 0;
  for (const link of links) {
    try {
      await page.goto(link, { waitUntil: 'networkidle', timeout: 60000 });
      const src = await page.$eval('img[src$=".gif"]', el => el.src)
        .catch(() => null)
        || await page.$eval('video source[src$=".gif"]', el => el.src)
        .catch(() => null);
      if (!src) continue;
      const name = path.basename(new URL(src).pathname);
      const buf = await page.goto(src).then(r => r.buffer());
      fs.writeFileSync(path.join(OUT, `mochi-${String(i).padStart(2, '0')}_${name}`), buf);
      i++;
      console.log(`  ✓ ${i}`);
    } catch (e) {
      console.error('  跳过', link, e.message);
    }
  }
  await browser.close();
  console.log(`完成，共下载 ${i} 张到 ${OUT}`);
})();
