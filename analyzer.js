/*
 * BehindTheDoor — text analyzer.
 * Pure functions, no DOM or chrome.* access, so it can be tested on its own.
 * Exposes: BTD.analyze(listing) and BTD.DEMO_LISTING
 */
(function (root) {
  'use strict';

  // Points removed from the 100-point reliability score per warning.
  const WEIGHTS = { high: 40, medium: 20, low: 10 };
  const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

  // "G" = gap that stays inside one sentence / one line.
  const G = (n) => `[^.!?\\n]{0,${n}}`;
  const rx = (source) => new RegExp(source, 'i');

  const RULES = [
    {
      id: 'pay-before-viewing',
      severity: 'high',
      title: 'Payment requested before touring/viewing',
      advice:
        'The description appears to ask for money before an in-person or virtual tour. Do not pay to view a property.',
      patterns: [
        rx(`\\b(deposit|payment|fee|money|rent)\\b${G(60)}\\b(before|prior to|in order to|to (schedule|book|arrange|get))\\b${G(30)}\\b(view|viewing|tour|touring|showing|seeing|see|visit)`),
        rx(`\\b(before|prior to)\\b${G(30)}\\b(viewing|tour|showing|seeing|visit)\\b${G(60)}\\b(deposit|payment|pay|fee)\\b`),
        rx(`\\b(pay|send|deposit)\\b${G(40)}\\bsight unseen\\b`),
      ],
    },
    {
      id: 'untraceable-payment',
      severity: 'high',
      title: 'Hard-to-trace payment method',
      advice:
        'Wire transfers, gift cards and cryptocurrency are almost impossible to recover. Legitimate landlords do not require them.',
      patterns: [
        rx(`\\b(wire transfer|western union|money ?gram|gift ?cards?|bitcoin|btc|crypto(currency)?|usdt|steam cards?|itunes cards?|prepaid (debit )?cards?)\\b`),
        rx(`\\bwire (me |us )?(the |your )?(money|funds|payment|deposit)\\b`),
      ],
    },
    {
      id: 'keys-by-mail',
      severity: 'high',
      title: 'Keys to be mailed or shipped',
      advice:
        'Offering to mail the keys after payment is a classic rental scam. Keys should be handed over in person at the property.',
      patterns: [
        rx(`\\b(mail|ship|send|courier|fedex|dhl|overnight)\\b${G(40)}\\bkeys?\\b`),
        rx(`\\bkeys?\\b${G(40)}\\b(mailed|shipped|sent|delivered|courier|fedex|dhl)\\b`),
      ],
    },
    {
      id: 'verification-code',
      severity: 'high',
      title: 'Asks for a verification code',
      advice:
        'Never share a code that was texted to you. Scammers use it to take over accounts or create phone numbers in your name.',
      patterns: [
        rx(`\\b(verification|confirmation|security|6[- ]digit|six[- ]digit) code\\b`),
        rx(`\\bcode\\b${G(30)}\\b(sent|texted) to your (phone|number)\\b`),
      ],
    },
    {
      id: 'viewing-restrictions',
      severity: 'medium',
      title: 'Viewing restrictions',
      advice:
        'The listing suggests the property cannot be viewed. Ask for a verifiable tour before paying or sharing sensitive information.',
      patterns: [
        rx(`\\bno (in[- ]person |physical )?(showings?|viewings?|tours?|visits?)\\b`),
        rx(`\\b(can ?not|can't|unable to|won't be able to|not able to|not available to) (show|meet|be there|give (a |you a )?tours?)\\b`),
        rx(`\\b(drive by|view (it )?from (the )?outside|exterior only|outside only)\\b`),
        rx(`\\bsight unseen\\b`),
        rx(`\\b(virtual|video) (tours?|showings?) only\\b`),
        rx(`\\bdo not disturb (the )?(current )?(tenants?|occupants?|residents?)\\b`),
      ],
    },
    {
      id: 'payment-pressure',
      severity: 'medium',
      title: 'Pressure to pay quickly',
      advice:
        'Urgency linked to a payment is a warning sign. A legitimate renter should have time to verify details and review paperwork.',
      patterns: [
        rx(`\\bfirst (person|one|applicant|to)\\b${G(30)}\\b(send|sends|pay|pays|deposit|deposits|put down|puts down)\\b`),
        rx(`\\b(send|pay|deposit|wire|transfer)\\b${G(40)}\\b(today|right now|immediately|asap|right away|within \\d+ ?(hours?|hrs?))\\b`),
        rx(`\\b(many|several|lots of|a lot of|other) (people|others|applicants|renters)?\\s?(are |is )?(already )?interested\\b`),
        rx(`\\b(deposit|payment)\\b${G(30)}\\b(holds?|secures?|reserves?) (it|the (place|unit|home|house|apartment|property))\\b`),
      ],
    },
    {
      id: 'landlord-away',
      severity: 'medium',
      title: 'Landlord says they are away',
      advice:
        'Being away is not evidence of fraud, but it makes independent verification of management authority more important.',
      patterns: [
        rx(`\\b(out of (the )?(country|state|town)|overseas|abroad|missionary|mission (trip|work)|deployed|deployment|offshore|oil rig|on a (business|work) trip)\\b`),
        rx(`\\b(i|we) (have |had |just |recently )*(relocated|moved|been transferred) (to|for|out)\\b`),
      ],
    },
    {
      id: 'p2p-payment',
      severity: 'medium',
      title: 'Payment app requested',
      advice:
        'Zelle, Cash App and Venmo payments work like cash and are rarely refunded. Only use them with people you have verified.',
      patterns: [rx(`\\b(zelle|cash ?app|venmo|paypal (friends|f&f|f and f))\\b`)],
    },
    {
      id: 'sensitive-info',
      severity: 'medium',
      title: 'Asks for sensitive personal information',
      advice:
        'Do not send ID photos, bank details or your Social Security number before you have verified the landlord and seen the property.',
      patterns: [
        rx(`\\b(social security( number)?|ssn)\\b`),
        rx(`\\b(bank account|routing number|credit card (number|details|info))\\b`),
        rx(`\\b(copy|photo|picture|scan) of (your |a valid |valid )?(id\\b|i\\.d\\.|driver'?s? licen[sc]e|passport)`),
      ],
    },
    {
      id: 'off-platform-contact',
      severity: 'low',
      title: 'Unusual contact instructions',
      advice:
        'The description directs contact to an external messaging service. Confirm the contact matches the legitimate property manager.',
      patterns: [
        rx(`\\b(telegram|whats ?app|kik|google (voice|chat|hangouts)|hangouts|snapchat)\\b`),
        rx(`\\b(text|email|e-mail|contact|reach|message)\\b${G(30)}\\b(only|directly|instead)\\b`),
        rx(`\\b(do not|don't) (message|reply|respond|contact)\\b${G(20)}\\b(here|on facebook|messenger|marketplace)\\b`),
        rx(`[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}`),
      ],
    },
    {
      id: 'upfront-fee',
      severity: 'low',
      title: 'Upfront fee mentioned',
      advice:
        'Application and screening fees are common, but only pay them after a tour and through a company you can verify.',
      patterns: [rx(`\\b(application|background check|credit (check|report)|screening|processing|admin(istration)?) fees?\\b`)],
    },
    {
      id: 'external-link',
      severity: 'low',
      title: 'External link in the description',
      advice:
        'Links to outside sites are often used for fake applications or credit-report sign-ups. Do not enter personal details there.',
      patterns: [rx(`\\b(bit\\.ly|tinyurl\\.com|rb\\.gy|cutt\\.ly|is\\.gd|t\\.ly)\\/\\S+`), rx(`\\bhttps?:\\/\\/\\S+`)],
    },
    {
      id: 'no-screening',
      severity: 'low',
      title: 'No screening or paperwork',
      advice:
        'Promises of no credit check, no lease or no paperwork are used to rush renters. A real rental should come with a written lease.',
      patterns: [
        rx(`\\bno (credit|background) checks?\\b`),
        rx(`\\bno (lease|paperwork|contract)( is)?( needed| required)?\\b`),
        rx(`\\bbad credit (ok|okay|welcome|accepted)\\b`),
      ],
    },
    {
      id: 'scam-script',
      severity: 'low',
      title: 'Wording common in scam scripts',
      advice:
        'This phrasing shows up often in copy-pasted scam messages. On its own it proves nothing, but be extra careful.',
      patterns: [
        rx(`\\b(god[- ]fearing|not after the money|absolute care|as if it (were|was) your own|as your own)\\b`),
        rx(`\\bhonest (and|&) (trustworthy|responsible|reliable) (tenant|person|family)\\b`),
        rx(`\\bkindly (get back|contact|send|fill|provide|text|email|reply|reach)\\b`),
      ],
    },
  ];

  function normalize(text) {
    return String(text || '')
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  // Evidence: the matched phrase plus ~60 characters of context either side,
  // trimmed to whole words.
  function snippet(text, index, length) {
    const RADIUS = 60;
    let start = Math.max(0, index - RADIUS);
    let end = Math.min(text.length, index + length + RADIUS);
    if (start > 0) {
      const sp = text.indexOf(' ', start);
      if (sp !== -1 && sp < index) start = sp + 1;
    }
    if (end < text.length) {
      const sp = text.lastIndexOf(' ', end);
      if (sp > index + length) end = sp;
    }
    const clean = (s) => s.replace(/\n/g, ' ');
    return {
      before: (start > 0 ? '…' : '') + clean(text.slice(start, index)),
      match: clean(text.slice(index, index + length)),
      after: clean(text.slice(index + length, end)) + (end < text.length ? '…' : ''),
    };
  }

  function levelFor(score, flagCount) {
    if (flagCount === 0) return { key: 'good', label: 'No warning signs found' };
    if (score >= 70) return { key: 'low', label: 'Low concern' };
    if (score >= 40) return { key: 'medium', label: 'Moderate concern' };
    return { key: 'high', label: 'High concern' };
  }

  function summaryFor(flags) {
    const n = flags.length;
    if (n === 0) {
      return 'No scam wording was found in the text. That is not proof the listing is real — still verify the landlord and tour the property.';
    }
    const high = flags.filter((f) => f.severity === 'high').length;
    const signs = n === 1 ? '1 warning sign' : `${n} warning signs`;
    if (high > 0) {
      return `${signs} found, ${high} of them serious. Do not send money or personal details.`;
    }
    return `${signs} found. Verify the landlord and see the property before paying anything.`;
  }

  /**
   * listing: { title, description, fullText, priceAmount, pricePeriod,
   *            priceText, beds, sellerJoinedYear, ... }
   * returns: { score, stars, level, summary, flags[] }
   */
  function analyze(listing, now) {
    const text = normalize(listing.fullText || [listing.title, listing.description].filter(Boolean).join('\n'));
    const flags = [];

    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        const m = pattern.exec(text);
        if (m) {
          // Extend the highlight to the end of a partly matched word.
          let length = m[0].length;
          while (/\w/.test(text[m.index + length] || '') && /\w$/.test(m[0])) length++;
          flags.push({
            id: rule.id,
            severity: rule.severity,
            title: rule.title,
            advice: rule.advice,
            evidence: snippet(text, m.index, length),
          });
          break;
        }
      }
    }

    // Seller account age (Facebook shows "Joined Facebook in 2024").
    const year = Number(listing.sellerJoinedYear);
    const thisYear = (now || new Date()).getFullYear();
    if (year && year >= thisYear - 1 && year <= thisYear) {
      const brandNew = year === thisYear;
      flags.push({
        id: 'new-account',
        severity: brandNew ? 'medium' : 'low',
        title: brandNew ? 'Seller account is brand new' : 'Seller account is fairly new',
        advice:
          'Scam listings are often posted from recently created or hijacked profiles. Look at the seller profile, other listings and reviews.',
        evidence: { before: '', match: `Joined Facebook in ${year}`, after: '' },
      });
    }

    // Very low monthly rent. Conservative: no local market data is used.
    const amount = Number(listing.priceAmount);
    const monthly = !listing.pricePeriod || /^mo/i.test(listing.pricePeriod);
    const dollars = /\$/.test(listing.priceText || '');
    const beds = Number(listing.beds) || 0;
    if (amount > 0 && monthly && dollars && (amount < 400 || (beds >= 2 && amount < 600))) {
      flags.push({
        id: 'low-price',
        severity: 'low',
        title: 'Rent looks unusually low',
        advice:
          'A price far below similar rentals is the most common bait in rental scams. Compare with other listings in the same area.',
        evidence: { before: '', match: listing.priceText, after: '' },
      });
    }

    flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const penalty = flags.reduce((sum, f) => sum + WEIGHTS[f.severity], 0);
    const score = Math.max(0, 100 - penalty);
    // 100-point score -> 5 stars, in half-star steps.
    const stars = Math.round(score / 10) / 2;

    return {
      score,
      stars,
      level: levelFor(score, flags.length),
      summary: summaryFor(flags),
      flags,
    };
  }

  const DEMO_LISTING = {
    source: 'demo',
    title: '2 Beds 1 Bath House',
    location: '222 2nd Street, Baltimore, MD',
    priceText: '$850 / Month',
    priceAmount: 850,
    pricePeriod: 'month',
    beds: 2,
    description:
      'Cozy two bedroom home available for rent. First person to send the deposit today gets priority. ' +
      'A deposit is required before viewing the property. Contact me only on Telegram. ' +
      'I am currently out of the country. No in-person showings are available.',
  };
  DEMO_LISTING.fullText = DEMO_LISTING.description;

  root.BTD = { analyze, normalize, DEMO_LISTING, RULES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
