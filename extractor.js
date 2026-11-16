/*
 * BehindTheDoor — Facebook Marketplace listing reader.
 *
 * btdExtractListing() is injected into the active tab with
 * chrome.scripting.executeScript({ func }), so it MUST be self-contained:
 * no references to anything outside its own body.
 *
 * Facebook's class names are obfuscated and change often, so this relies only
 * on ARIA roles, headings and the visible text.
 */
async function btdExtractListing() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const PRICE_LINE = /^(?:[A-Z]{1,3})?\s?([$£€₱₹])\s?(\d[\d,]*(?:\.\d+)?)(?:[^\/\n]*?\/\s*([A-Za-z]+))?/;
  const HAS_PRICE = /[$£€₱₹]\s?\d/;
  const END_OF_LISTING = /^(today's picks|similar listings|similar items|related listings|more rentals.*|you may also like|more from this seller|sponsored)$/i;
  const END_OF_DESCRIPTION = /^(see less|see translation|seller information|seller details|rental location|location is approximate|message|send seller a message|today's picks|sponsored)$/i;

  // 1. Find the listing container: an open listing dialog, else the main region.
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
    (el) => isVisible(el) && el.innerText.length > 300 && HAS_PRICE.test(el.innerText)
  );
  const mains = [...document.querySelectorAll('[role="main"]')]
    .filter(isVisible)
    .sort((a, b) => b.innerText.length - a.innerText.length);
  const root = dialogs[0] || mains[0] || document.body;

  // 2. Expand a truncated description ("See more").
  let expanded = 0;
  for (const btn of root.querySelectorAll('[role="button"]')) {
    if (expanded >= 3) break;
    if (btn.textContent.trim().toLowerCase() === 'see more' && !btn.closest('a[href]') && isVisible(btn)) {
      btn.click();
      expanded++;
    }
  }
  if (expanded) await sleep(300);

  // 3. Visible text, line by line, cut where unrelated listings start.
  let lines = root.innerText
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const cut = lines.findIndex((l, i) => i > 5 && END_OF_LISTING.test(l));
  if (cut !== -1) lines = lines.slice(0, cut);

  // 4. Title.
  let title = '';
  for (const h of root.querySelectorAll('h1')) {
    const t = h.innerText.replace(/\s+/g, ' ').trim();
    if (t && isVisible(h) && !/^(marketplace|notifications|chats?|facebook)$/i.test(t)) {
      title = t;
      break;
    }
  }
  if (!title) {
    title = document.title
      .replace(/^\(\d+\+?\)\s*/, '')
      .replace(/^Marketplace\s*[–-]\s*/i, '')
      .replace(/\s*\|\s*Facebook$/i, '')
      .trim();
    if (/^(facebook|marketplace)$/i.test(title)) title = '';
  }

  // 5. Price.
  let priceText = '';
  let priceAmount = null;
  let pricePeriod = '';
  const priceIdx = lines.findIndex((l) => PRICE_LINE.test(l));
  if (priceIdx !== -1) {
    const m = lines[priceIdx].match(PRICE_LINE);
    priceAmount = parseFloat(m[2].replace(/,/g, ''));
    pricePeriod = (m[3] || '').toLowerCase();
    priceText = m[1] + m[2] + (pricePeriod ? ' / ' + m[3] : '');
  }

  // 6. Location.
  let location = '';
  let listedText = '';
  const listedLine = lines.find((l) => /^listed\b/i.test(l));
  if (listedLine) {
    listedText = listedLine;
    const m = listedLine.match(/\bin\s+(.+)$/i);
    if (m) location = m[1].trim();
  }
  const looksLikePlace = (l) => /,\s*[A-Z]{2}\b/.test(l) && l.length < 90 && !/^listed\b/i.test(l);
  if (priceIdx !== -1) {
    // On rental listings the street address sits right under the price.
    const near = lines.slice(priceIdx + 1, priceIdx + 5).find(looksLikePlace);
    if (near) location = near;
  }
  if (!location) {
    const approxIdx = lines.findIndex((l) => /^location is approximate$/i.test(l));
    if (approxIdx > 0) location = lines[approxIdx - 1];
  }

  // 7. Description.
  let description = '';
  const descIdx = lines.findIndex((l) => /^description$/i.test(l));
  if (descIdx !== -1) {
    const out = [];
    for (let i = descIdx + 1; i < lines.length; i++) {
      if (END_OF_DESCRIPTION.test(lines[i])) break;
      out.push(lines[i]);
    }
    description = out.join('\n');
  }
  if (!description) {
    // Fallback: the longest paragraph on the page is almost always the description.
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (longest.length >= 80) description = longest;
  }
  description = description.replace(/\s*…?\s*see (more|less)$/i, '').trim();

  // 8. Seller + unit details.
  let sellerJoinedYear = null;
  const joined = lines.join('\n').match(/joined facebook in (\d{4})/i);
  if (joined) sellerJoinedYear = parseInt(joined[1], 10);

  let beds = null;
  const bedMatch = (title + '\n' + lines.join('\n')).match(/(\d+)\s*(?:beds?|bedrooms?|bd|br)\b/i);
  if (bedMatch) beds = parseInt(bedMatch[1], 10);

  return {
    source: 'facebook',
    url: window.location.href,
    title,
    priceText,
    priceAmount,
    pricePeriod,
    location,
    listedText,
    description,
    sellerJoinedYear,
    beds,
    fullText: lines.join('\n').slice(0, 20000),
  };
}
