import { db, now } from './src/db.js';

const ARTICLES = [
  {
    slug: 'best-value-gpus-verified-performance-per-dollar',
    title: 'Best Value GPUs Right Now: Verified Performance Per Dollar',
    excerpt: 'Using verified performance indices and estimated street prices from our catalog, here is the real performance-per-dollar ranking of modern graphics cards.',
    tags: ['gpu', 'buying-guide', 'value'],
    content: `Every number below is computed from our verified catalog. GPU performance indices come from the TechPowerUp relative performance database and prices are estimated street-price aggregates — they change over time, so treat the ratio as a guide, not a promise.

## The ranking method

We divide each GPU's verified performance index by its estimated street price. A higher score means more frames per dollar. We only include current, in-stock cards.

## Top value GPUs

- **NVIDIA GeForce RTX 4060** — a performance index near 145 at roughly $299 makes it the best price-to-performance 1080p card we track.
- **NVIDIA GeForce RTX 3060 Ti** — older, but its 152 index at around $329 still beats many newer cards on value.
- **AMD Radeon RX 6700 XT** — 150 index at about $329, with 12GB VRAM that helps at 1440p.
- **AMD Radeon RX 7600** — budget king for 1080p esports: 120 index at about $269.
- **NVIDIA GeForce RTX 3080 10GB** — a 213 index near $499 is the best upper-midrange value for 1440p.

## Why not just buy the cheapest card?

> A cheap GPU with a low performance index can cost more per frame than a midrange card. Always compare the ratio, not the sticker price.

## Honest notes

- Prices are **estimates** with a date, sourced from aggregate street-price tracking. They fluctuate.
- Performance indices are **relative**, not absolute FPS. Use our FPS calculator with your exact CPU + GPU + resolution for a projected estimate.
- Newer cards (RTX 50 series, RX 9070 series) are marked **estimated** in our FPS engine until independent benchmark rows exist.

## Bottom line

For 1080p gaming the RTX 4060 and RX 7600 are hard to beat on value. For 1440p, the RTX 3080's used-market price and the RX 6700 XT's VRAM stand out. Recheck the catalog before you buy — prices move every week.`,
  },
  {
    slug: 'how-to-choose-a-gaming-cpu-sockets-cores-budget',
    title: 'How to Choose a Gaming CPU: Sockets, Cores and Budgets',
    excerpt: 'Socket compatibility, core counts, X3D cache, and which CPUs we actually track as the best value in our verified catalog.',
    tags: ['cpu', 'buying-guide', 'pc-build'],
    content: `Your CPU must match your motherboard socket — nothing else matters if those two disagree. Here is what we verify from our catalog before recommending anything.

## Step 1: Pick a platform (socket)

- **AM4** — older but affordable (Ryzen 5000 series). End-of-life, but cheap and still strong for 1080p.
- **AM5** — current AMD platform: Ryzen 7000/9000, supports DDR5 and future upgrades.
- **LGA1700** — Intel 12th to 14th gen. Good value right now, end-of-life.
- **LGA1851** — Intel's newest platform for Arrow Lake (Core Ultra 200 series) with DDR5.

> The socket rule is enforced by our compatibility engine: an AM4 CPU with an AM5 board returns \`incompatible\` before you waste money.

## Step 2: Cores and threads for games

Most games use 6–8 cores. Our catalog tracks CPUs from 4 to 16 cores:

- **Entry (4–6 cores)**: Intel Core i3, Ryzen 5 5600 — fine for esports and 1080p.
- **Mid (6–8 cores)**: Ryzen 5 7600/9600, Core i5 — the sweet spot for modern titles.
- **High (8+ cores + 3D cache)**: Ryzen 7 7800X3D/9800X3D — the best gaming performance we track, plus strong multi-threading.

## Step 3: The budget math

Using verified performance ÷ estimated price, the current best-value CPUs in our catalog are:

- **AMD Ryzen 5 5600** — ~$129 with a 68 index: the best value entry CPU.
- **Intel Core i3-12100F** — ~$99 at 48 index: cheapest respectable gaming CPU.
- **AMD Ryzen 5 7600** — ~$199 at 78 index: best AM5 entry point.
- **AMD Ryzen 7 5700X3D** — ~$239 at 80 index: 3D cache on a budget.

## Honest notes

- Power draw matters: a Core Ultra 9 285K draws far more than a Ryzen 5 5600. Budget for the PSU too.
- Integrated graphics: many Intel chips include one, which is useful for troubleshooting — our catalog lists it per CPU.
- These rankings update from verified data; always re-check prices and release dates in the catalog before buying.`,
  },
  {
    slug: '1080p-vs-1440p-vs-4k-what-your-gpu-actually-needs',
    title: '1080p vs 1440p vs 4K: What Your GPU Actually Needs',
    excerpt: 'Resolution roughly quadruples pixel count from 1080p to 4K. We explain what that means for GPU tiers using our verified catalog and estimated FPS model.',
    tags: ['resolution', 'fps', 'monitor', 'gpu'],
    content: `Going from 1080p to 4K is not a small jump — it is roughly **four times the pixels**. That is why the same GPU that runs 200 FPS at 1080p may only manage ~50 FPS at 4K Ultra.

## The resolution math

- **1080p (1920×1080)**: ~2.07M pixels. Entry GPUs (RTX 4060, RX 7600) are comfortable here.
- **1440p (2560×1440)**: ~3.69M pixels. This is the value sweet spot — midrange cards like the RX 6700 XT or RTX 3080 shine.
- **4K (3840×2160)**: ~8.29M pixels. Only top-tier cards (RTX 4080/4090, RTX 5090) deliver high FPS at Ultra.

## What our FPS engine reports

For the newest GPUs (RTX 50 series, RX 9070 series) there are no independent benchmark rows yet, so the engine:

- Interpolates from the verified performance index.
- Returns the result marked **estimated** with the exact basis shown.
- Never pretends an estimate is a measured benchmark.

> \`status: "estimated"\` is a feature, not a bug — you always know the confidence of the number.

## Choosing by target

- **Esports at 240Hz** → buy for 1080p, run High/Ultra, focus on the fastest value GPU.
- **Balanced 1440p/144Hz** → midrange tier; this is where most players should spend.
- **4K/60+ with ray tracing** → top tier only, and expect to use DLSS/FSR upscaling.

## Honest notes

- Upscaling (DLSS, FSR, XeSS) genuinely helps at 1440p/4K — our catalog tracks which cards support it.
- VRAM matters at 4K: 8GB cards can run out of memory in modern titles.
- Use our FPS calculator with your exact CPU + GPU combination for a per-game estimate, and treat all estimated results accordingly.`,
  },
];

const count = db.prepare('SELECT COUNT(*) c FROM articles').get().c;
if (count > 0) {
  console.log(`[seed-blog] articles table already has ${count} rows — skipping (preserves admin edits).`);
  process.exit(0);
}

const nowStr = now();
const insert = db.transaction(() => {
  for (const a of ARTICLES) {
    db.prepare(`
      INSERT INTO articles (slug, title, excerpt, content, cover_color, tags, author_name, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'LevelCore', 'published', ?, ?, ?)
    `).run(a.slug, a.title, a.excerpt, a.content, '#7c5cff', JSON.stringify(a.tags), nowStr, nowStr, nowStr);
    console.log(`[seed-blog] + ${a.slug}`);
  }
});
insert();
console.log(`[seed-blog] seeded ${ARTICLES.length} articles.`);
