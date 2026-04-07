/**
 * color-server.js
 * Local server that fetches a company website and extracts brand colors.
 * No npm install needed — uses only Node.js built-in modules.
 *
 * Usage: node color-server.js
 * Then use admin.html normally — the "Get Colors from URL" button will call this server.
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const PORT = 3001;

// ── Profile storage ───────────────────────────────────────────────────────────
const PROFILES_DIR = path.join(__dirname, 'profiles');
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

// ── Fetch a URL (follows redirects, returns body string) ──────────────────────
function fetchUrl(targetUrl, redirects) {
  redirects = redirects || 0;
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise(function (resolve, reject) {
    var parsed;
    try { parsed = new URL(targetUrl); } catch(e) { return reject(new Error('Invalid URL')); }
    var client = parsed.protocol === 'https:' ? https : http;
    var options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept': 'text/html,text/css,*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 8000
    };
    var req = client.get(options, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var next = res.headers.location;
        if (next.startsWith('/')) next = parsed.origin + next;
        res.resume();
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end',  function ()  { resolve(Buffer.concat(chunks).toString('utf8')); });
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', function () { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ── Color math ────────────────────────────────────────────────────────────────
function hexToHsl(hex) {
  var r = parseInt(hex.slice(1,3),16)/255;
  var g = parseInt(hex.slice(3,5),16)/255;
  var b = parseInt(hex.slice(5,7),16)/255;
  var max = Math.max(r,g,b), min = Math.min(r,g,b);
  var h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    var d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6;          break;
      default:h = ((r-g)/d + 4)/6;
    }
  }
  return { h: h*360, s: s, l: l };
}

function hue2rgb(p,q,t) {
  if (t<0) t+=1; if (t>1) t-=1;
  if (t<1/6) return p+(q-p)*6*t;
  if (t<1/2) return q;
  if (t<2/3) return p+(q-p)*(2/3-t)*6;
  return p;
}
function hslToHex(h,s,l) {
  h = h/360;
  var r,g,b;
  if (s===0) { r=g=b=l; }
  else {
    var q = l<0.5 ? l*(1+s) : l+s-l*s;
    var p = 2*l-q;
    r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
  }
  function toH(x) { return ('0'+Math.round(x*255).toString(16)).slice(-2); }
  return '#'+toH(r)+toH(g)+toH(b);
}
function darken(hex, amt)  { var c=hexToHsl(hex); return hslToHex(c.h, c.s, Math.max(0,c.l-amt)); }
function lighten(hex, amt) { var c=hexToHsl(hex); return hslToHex(c.h, c.s, Math.min(1,c.l+amt)); }
function isNeutral(hex)    { var c=hexToHsl(hex); return c.s<0.12 || c.l<0.08 || c.l>0.92; }

// ── Extract all hex colors from CSS text ──────────────────────────────────────
function extractHexColors(css) {
  var out = [], m;
  var re = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;
  while ((m = re.exec(css)) !== null) {
    var h = m[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    out.push('#'+h.toUpperCase());
  }
  return out;
}

// ── Main extraction logic ────────────────────────────────────────────────────
async function extractBrandColors(websiteUrl) {
  if (!/^https?:\/\//i.test(websiteUrl)) websiteUrl = 'https://' + websiteUrl;

  var html = await fetchUrl(websiteUrl);
  var origin = new URL(websiteUrl).origin;

  var m;

  // ── Tier 1: <meta name="theme-color"> — most reliable brand signal ────────
  var tier1 = [];
  var themeRe = /<meta[^>]+(?:name=["']theme-color["'][^>]+content=["'](#[0-9A-Fa-f]{6})["']|content=["'](#[0-9A-Fa-f]{6})["'][^>]+name=["']theme-color["'])/gi;
  while ((m = themeRe.exec(html)) !== null) {
    var tc = (m[1] || m[2]).toUpperCase();
    if (!isNeutral(tc)) tier1.push(tc);
  }

  // ── Tier 2: inline styles on header/nav/button elements ──────────────────
  var tier2 = [];
  var elemRe = /<(?:header|nav|button)[^>]+style=["']([^"']*)["'][^>]*>/gi;
  while ((m = elemRe.exec(html)) !== null) {
    var hexes = m[1].match(/#[0-9A-Fa-f]{6}/g) || [];
    hexes.forEach(function(c) { if (!isNeutral(c.toUpperCase())) tier2.push(c.toUpperCase()); });
  }

  // ── Tier 3: CSS custom properties named "primary" or "brand" ─────────────
  var allCss = '';
  var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(html)) !== null) allCss += m[1] + '\n';

  var linkRe = /<link[^>]+stylesheet[^>]+href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]+stylesheet/gi;
  var cssUrls = [];
  while ((m = linkRe.exec(html)) !== null) {
    var href = m[1] || m[2];
    if (!href) continue;
    if (href.startsWith('//'))          href = 'https:' + href;
    else if (href.startsWith('/'))      href = origin + href;
    else if (!/^https?:/.test(href))    href = origin + '/' + href;
    cssUrls.push(href);
  }
  for (var i = 0; i < Math.min(cssUrls.length, 4); i++) {
    try { allCss += (await fetchUrl(cssUrls[i])) + '\n'; } catch(e) {}
  }

  var varRe = /--(primary(?:-[\w]+)?|brand(?:-[\w]+)?|[\w]+-primary|[\w]+-brand)\s*:\s*(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b/gi;
  var tier3 = [];
  while ((m = varRe.exec(allCss)) !== null) {
    var h = m[2];
    if (h.length === 4) h = '#'+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
    if (!isNeutral(h.toUpperCase())) tier3.push(h.toUpperCase());
  }

  // ── Tier 4: most frequent non-neutral colors in CSS ──────────────────────
  var allColors = extractHexColors(allCss);
  var counts = {};
  allColors.forEach(function(c) { if (!isNeutral(c)) counts[c] = (counts[c]||0)+1; });
  var tier4raw = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });

  // Filter out near-black (text colors, l<0.20) and near-white (backgrounds, l>0.85).
  // These are CSS utility colors, never brand primary colors.
  // e.g. navy #1A1446 (l=0.18) is a text color, not Liberty Mutual's brand yellow.
  var tier4 = tier4raw.filter(function(c) {
    var hsl = hexToHsl(c);
    return hsl.l >= 0.20 && hsl.l <= 0.85;
  });
  // If everything got filtered (unlikely), fall back to unfiltered list
  if (tier4.length === 0) tier4 = tier4raw;

  console.log('Tier 1 (theme-color):', tier1);
  console.log('Tier 2 (header/nav inline):', tier2);
  console.log('Tier 3 (CSS vars --primary/--brand):', tier3.slice(0, 5));
  console.log('Tier 4 (CSS frequency top 5):', tier4.slice(0, 5));

  // Merge tiers in priority order, deduplicated
  var seen = {};
  var candidates = [];
  tier1.concat(tier2).concat(tier3).concat(tier4).forEach(function(c) {
    if (!seen[c]) { seen[c]=true; candidates.push(c); }
  });

  if (candidates.length === 0) candidates = ['#4299E1'];

  // Within tier 4 (CSS frequency), combine frequency rank with darkness score.
  // This prevents a rare-but-saturated green at rank 30 from beating the navy at rank 1.
  // Formula: 65% weight on frequency rank + 35% weight on darkness (s × (1−l))
  var trustedCount = tier1.length + tier2.length + tier3.length;
  var trustedPart  = candidates.slice(0, trustedCount);
  var freqPart     = candidates.slice(trustedCount);
  freqPart = freqPart.map(function(c, idx) {
    var hsl = hexToHsl(c);
    return {
      color: c,
      score: (1 / (idx + 1)) * 0.65 + (hsl.s * (1 - hsl.l)) * 0.35
    };
  }).sort(function(a, b) { return b.score - a.score; }).map(function(x) { return x.color; });
  candidates = trustedPart.concat(freqPart);

  var primary = candidates[0];
  var primaryHsl = hexToHsl(primary);

  // Find accent: different hue (>40°), pick highest-contrast against primary
  var accent = candidates.find(function(c) {
    return Math.abs(hexToHsl(c).h - primaryHsl.h) > 40;
  }) || hslToHex((primaryHsl.h + 180) % 360, Math.min(primaryHsl.s, 0.8), Math.min(primaryHsl.l, 0.5));

  return {
    primary:      primary,
    primaryDark:  darken(primary, 0.12),
    primaryLight: lighten(primary, 0.08),
    accent:       accent,
    sidebarBg:    darken(primary, 0.22)
  };
}

// ── Strip HTML to plain text (for feeding to Claude) ─────────────────────────
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

// ── Call Claude via local CLI (uses your Claude Code subscription, no API key) ─
// Pipes the prompt to stdin of: claude --print
function callClaudeLocal(prompt) {
  var spawn = require('child_process').spawn;
  return new Promise(function(resolve, reject) {
    var proc = spawn('claude', ['--print'], { windowsHide: true, shell: true });
    var output    = '';
    var errOutput = '';
    var timedOut  = false;

    var timer = setTimeout(function() {
      timedOut = true;
      proc.kill('SIGTERM');
      reject(new Error('Claude CLI timed out after 20 minutes'));
    }, 1200000);

    proc.stdout.on('data', function(d) { output    += d.toString(); });
    proc.stderr.on('data', function(d) { errOutput += d.toString(); });

    proc.on('close', function(code) {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0 && !output.trim()) {
        return reject(new Error(
          'Claude CLI exited with code ' + code +
          (errOutput ? ': ' + errOutput.slice(0, 300) : '') +
          ' — make sure Claude Code is installed and logged in (run: claude)'
        ));
      }
      resolve(output.trim());
    });

    proc.on('error', function(err) {
      clearTimeout(timer);
      reject(new Error(
        'Cannot run "claude" CLI: ' + err.message +
        ' — install Claude Code from https://claude.ai/code'
      ));
    });

    proc.stdin.write(prompt, 'utf8');
    proc.stdin.end();
  });
}

// ── Build research prompt ─────────────────────────────────────────────────────
function buildResearchPrompt(name, url, scraped) {
  var schema = {
    client: {
      name: 'Full legal company name',
      shortName: 'Common brand abbreviation used in nav/headers',
      tagline: 'Official tagline or 1-line mission statement',
      subtitle: 'Industry | Primary function e.g. "Technology | Enterprise Software"',
      description: '2-3 sentence factual overview: what they do, scale, who they serve'
    },
    keyFacts: [
      {label:'Founded', value:'YYYY', desc:'context'},
      {label:'Employees', value:'~X,000', desc:'qualifier'},
      {label:'Revenue', value:'$X billion or key metric', desc:'context'},
      {label:'Key Business Metric', value:'...', desc:'...'},
      {label:'Workshop Focus', value:'Claude Code', desc:'AI-native engineering programme'}
    ],
    serviceAreas: [{title:'Division or BU name', desc:'One sentence on what it does'}],
    leadership: [
      {title:'CEO / MD', name:'Full Name'},
      {title:'CTO or Chief Engineer', name:'Full Name'},
      {title:'Another C-suite role', name:'Full Name'}
    ],
    locations: [{label:'Headquarters', address:'Street, City, Country'}],
    priorities: [
      {num:1, title:'Priority name 5-8 words', tagline:'Short catchy phrase', desc:'2-3 sentences on what this involves', roles:'Software Engineers, QA Engineers, DevOps & Platform', pains:'Key engineering challenges tied to this priority'}
    ],
    capabilities: [
      {role:'Department Full Name', short:'ABBR', icon:'primary', objectives:'2-3 sentences on mandate and activities', painPoints:'Specific day-to-day friction this team faces', keyActivities:'Code review, sprint planning, architecture, deployment'}
    ],
    workflows: [
      {name:'Workflow name', steps:[{t:'Step Name', d:'Who does what at this step'}], friction:'Where this workflow creates the most bottlenecks'}
    ],
    painPoints: {
      individual: [{name:'Pain name', desc:'2 sentences on friction and impact', freq:'Daily'}],
      team:       [{name:'Pain name', desc:'Team-level friction description',     freq:'Weekly'}],
      organisation:[{name:'Pain name', desc:'Structural or systemic challenge',   freq:'Structural'}]
    },
    technology: {
      m365Status: '1-2 sentences on current Microsoft 365 and AI tooling deployment',
      m365: ['Outlook','Teams','Word','Excel','PowerPoint','SharePoint','OneDrive'],
      platforms: [{name:'Platform or internal system name', desc:'What it does'}]
    },
    glossary: [{t:'Term', d:'Definition in context of this company', cat:'Organisation'}],
    brandColors: {
      primary: '#XXXXXX — the single most distinctive brand color. This is typically the logo background fill or primary button color — NOT a text color or white/light background. Example: Liberty Mutual = #FFC726 (yellow logo), not #1A1446 (navy text).',
      accent:  '#XXXXXX — secondary brand color used for headings, links, or highlights. Should have a different hue to primary.'
    }
  };

  return 'Research the company "' + name + '" (website: ' + url + ') and generate a complete operational profile JSON for an AI adoption training workshop.\n\n'
    + 'Website content (scraped from homepage):\n---\n' + scraped + '\n---\n\n'
    + 'Use your training knowledge plus the scraped content above. The profile contextualises Claude Code AI training for their software engineering team.\n\n'
    + 'Return ONLY raw JSON — no markdown code fences, no explanation text. Start directly with { and end with }.\n\n'
    + 'Fill this exact schema:\n\n'
    + JSON.stringify(schema, null, 2)
    + '\n\nRequirements:\n'
    + '- priorities: exactly 5 items\n'
    + '- capabilities: exactly 6 items, one for each of these role groups IN THIS ORDER: Software Engineers, QA Engineers, Tech Leads & Architects, Product & Planning, DevOps & Platform, Security Engineers — write objectives and painPoints specific to how that role group operates at THIS company\n'
    + '- workflows: exactly 4 items — software development and delivery workflows specific to this company (e.g. feature development, release pipeline, incident response, onboarding)\n'
    + '- painPoints.individual: 6-8 items specific to engineers and tech workers at this company; painPoints.team: 4-6; painPoints.organisation: 4-6\n'
    + '- glossary: 25-40 terms across: Organisation, Business Units, Technology, HR & Learning, Industry — include this company\'s internal tools, codebases, platforms, and engineering terminology\n'
    + '- icon values must rotate between: "primary", "secondary", "accent"\n'
    + '- All content must reflect how software engineering actually works at THIS company specifically — not generic\n'
    + '- technology.m365 should list the actual tools this company uses based on your knowledge\n'
    + '- brandColors.primary: the hex color most associated with the brand visually — typically the logo background or primary button fill. Must NOT be a near-black text color (lightness < 20%) or near-white background. If the logo sits on yellow, primary is yellow. If on blue, primary is blue.\n'
    + '- brandColors.accent: a second brand hex color with a different hue to primary — commonly used for headings or icon accents\n';
}

// ── HTTP server ───────────────────────────────────────────────────────────────
var server = http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin',          '*');
  res.setHeader('Access-Control-Allow-Methods',         'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',         'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/extract-colors') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end',  async function() {
      try {
        var data = JSON.parse(body);
        if (!data.url) throw new Error('Missing url field');
        console.log('Extracting colors from:', data.url);
        var colors = await extractBrandColors(data.url);
        console.log('Result:', colors);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify(colors));
      } catch(e) {
        console.error('Error:', e.message);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }

  // ── POST /research-company ──────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/research-company') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
      try {
        var data = JSON.parse(body);
        if (!data.id)   throw new Error('Missing id');
        if (!data.name) throw new Error('Missing company name');
        if (!data.url)  throw new Error('Missing website URL');

        console.log('Researching company:', data.name, '(' + data.url + ')');

        // Scrape homepage text
        var scraped = '';
        try {
          var targetUrl = /^https?:\/\//i.test(data.url) ? data.url : 'https://' + data.url;
          var html = await fetchUrl(targetUrl);
          scraped = htmlToText(html);
          console.log('Scraped', scraped.length, 'chars from homepage');
        } catch(e) {
          scraped = '(Could not scrape website: ' + e.message + ')';
          console.warn('Scrape warning:', e.message);
        }

        // Build prompt and call Claude via local CLI
        var prompt = buildResearchPrompt(data.name, data.url, scraped);
        console.log('Calling Claude CLI...');
        var raw = await callClaudeLocal(prompt);

        // Extract JSON from response (strip any accidental markdown fences)
        var jsonStr = raw.replace(/^```[a-z]*\n?/m, '').replace(/```\s*$/m, '').trim();
        var start = jsonStr.indexOf('{');
        var end   = jsonStr.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('Claude did not return valid JSON. Response started with: ' + raw.slice(0, 200));
        jsonStr = jsonStr.slice(start, end + 1);

        var profileData = JSON.parse(jsonStr);

        // Derive full brand color palette from Claude's identified brandColors
        var claudeColors = null;
        if (profileData.brandColors && /^#[0-9A-Fa-f]{6}$/.test(profileData.brandColors.primary)) {
          var cp = profileData.brandColors.primary;
          var ca = (profileData.brandColors.accent && /^#[0-9A-Fa-f]{6}$/.test(profileData.brandColors.accent))
            ? profileData.brandColors.accent
            : hslToHex((hexToHsl(cp).h + 180) % 360, 0.6, 0.4);
          claudeColors = {
            primary:      cp,
            primaryDark:  darken(cp, 0.12),
            primaryLight: lighten(cp, 0.08),
            accent:       ca,
            sidebarBg:    darken(cp, 0.22)
          };
          console.log('Brand colors from Claude:', claudeColors);
        }

        // Save to profiles/{id}.json
        var filePath = path.join(PROFILES_DIR, data.id + '.json');
        var saved = {
          id: data.id,
          name: data.name,
          url: data.url,
          timestamp: new Date().toISOString(),
          data: profileData
        };
        fs.writeFileSync(filePath, JSON.stringify(saved, null, 2), 'utf8');
        console.log('Profile saved to', filePath);

        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, timestamp: saved.timestamp, brandColors: claudeColors }));
      } catch(e) {
        console.error('Research error:', e.message);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GET /profile?id=&name= ─────────────────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/profile')) {
    try {
      var params = new URL('http://localhost' + req.url).searchParams;
      var id   = params.get('id')   || '';
      var name = params.get('name') || '';
      if (!id && !name) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Missing id or name'})); return; }

      // 1. Try exact ID match
      var filePath = id ? path.join(PROFILES_DIR, id + '.json') : null;
      if (filePath && !fs.existsSync(filePath)) filePath = null;

      // 2. Fallback: search all profiles for matching company name
      if (!filePath && (id || name)) {
        var searchName = (name || id).toLowerCase();
        var files = fs.readdirSync(PROFILES_DIR).filter(function(f) { return f.endsWith('.json'); });
        for (var fi = 0; fi < files.length; fi++) {
          try {
            var s = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, files[fi]), 'utf8'));
            if (s.name && s.name.toLowerCase() === searchName) {
              filePath = path.join(PROFILES_DIR, files[fi]);
              break;
            }
          } catch(e) {}
        }
      }

      if (!filePath) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ found: false }));
        return;
      }
      var saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // If the matched file has no data (config-only profile), search by name for
      // another profile that does have research data.
      if (!saved.data && (saved.name || name)) {
        var searchName = (saved.name || name).toLowerCase();
        var allFiles = fs.readdirSync(PROFILES_DIR).filter(function(f) { return f.endsWith('.json'); });
        for (var fi2 = 0; fi2 < allFiles.length; fi2++) {
          try {
            var candidate = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, allFiles[fi2]), 'utf8'));
            if (candidate.data && candidate.name && candidate.name.toLowerCase() === searchName) {
              saved = candidate;
              break;
            }
          } catch(e2) {}
        }
      }

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ found: true, name: saved.name, url: saved.url, timestamp: saved.timestamp, data: saved.data }));
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }

  // ── GET /list-profiles ─────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/list-profiles') {
    try {
      var files = fs.readdirSync(PROFILES_DIR).filter(function(f) { return f.endsWith('.json'); });
      var profiles = files.map(function(f) {
        try {
          var s = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8'));
          return { id: s.id, name: s.name, url: s.url, timestamp: s.timestamp, config: s.config || null };
        } catch(e) { return null; }
      }).filter(Boolean);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ profiles: profiles }));
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }

  // ── POST /save-company-config ───────────────────────────────────────────────
  // Saves admin config (password, colors, logoDataUrl) into the profile JSON file.
  // Creates the file if it doesn't exist yet (no research required first).
  if (req.method === 'POST' && req.url === '/save-company-config') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        if (!data.id)   throw new Error('Missing id');
        if (!data.name) throw new Error('Missing name');

        var filePath = path.join(PROFILES_DIR, data.id + '.json');
        var existing = {};
        if (fs.existsSync(filePath)) {
          try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) {}
        }

        // Merge: preserve research data, update config
        existing.id   = data.id;
        existing.name = data.name;
        existing.url  = data.url  || existing.url  || '';
        existing.config = {
          password:    data.password    || '',
          colors:      data.colors      || {},
          logoDataUrl: data.logoDataUrl || null
        };
        if (!existing.timestamp) existing.timestamp = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
        console.log('Company config saved to', filePath);

        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        console.error('Save config error:', e.message);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── POST /delete-company ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/delete-company') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        if (!data.id) throw new Error('Missing id');
        var filePath = path.join(PROFILES_DIR, data.id + '.json');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('Deleted profile:', filePath);
        }
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, function() {
  console.log('');
  console.log('  Brand Color Server running on http://localhost:' + PORT);
  console.log('  Keep this terminal open while using admin.html');
  console.log('');
});
