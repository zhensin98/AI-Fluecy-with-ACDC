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

// ── Use case generation (mirrors Copilot Value.html logic) ───────────────────
function extractPain(text, index) {
  if (!text) return 'Manual, time-intensive tasks that slow down delivery';
  var parts = text.split(';').map(function(p){return p.trim();}).filter(Boolean);
  return parts[index % parts.length] || parts[0];
}

function extractObj(text, index) {
  if (!text) return 'Deliver high-quality outcomes efficiently';
  var parts = text.split(';').map(function(p){return p.trim();}).filter(Boolean);
  return parts[index % parts.length] || parts[0];
}

function estimateTimeSaved(base, role, pain, wf) {
  // Predict time saved for THIS specific use case based on its content, not just habit type.
  // Research baselines (per habit) are the floor. These signals scale up from there.

  // 1. Pain description length: longer = more specific & complex problem = more time currently wasted
  var painLen = Math.min(15, Math.floor((pain || '').length / 20));

  // 2. Pain keywords that signal high manual/repetitive/compliance overhead (tasks that eat real hours)
  var painLower = (pain || '').toLowerCase();
  var heavyTerms = ['manual','repetitive','recurring','every ','all ','multiple','hours','days',
    'each ','approval','compliance','classified','legacy','documentation','checklist',
    'inconsistent','training','review','coordination','approval'];
  var heavyCount = heavyTerms.filter(function(t){ return painLower.indexOf(t) !== -1; }).length;
  var heavyBonus = Math.min(25, heavyCount * 6);

  // 3. Role activity breadth: more diverse key activities = more complex tasks = bigger saving
  var actCount = ((role && role.keyActivities) || '').split(',').filter(Boolean).length;
  var actBonus = Math.min(8, Math.max(0, (actCount - 2) * 2));

  // 4. Workflow complexity: more steps + more friction text = more process overhead Claude removes
  var wfSteps = wf ? (wf.steps || []).length : 3;
  var wfFriction = wf ? (wf.friction || '').length : 0;
  var wfBonus = Math.min(12, Math.round(wfSteps * 1.2 + wfFriction / 80));

  return Math.max(15, Math.round(base + painLen + heavyBonus + actBonus + wfBonus));
}

function buildUseCaseForRole(habitIndex, role, clientInfo, workflows, ucId) {
  var coShort = (clientInfo && (clientInfo.shortName || clientInfo.name)) || 'the organisation';
  var pain0 = extractPain(role.painPoints, 0);
  var pain1 = extractPain(role.painPoints, 1);
  var pain2 = extractPain(role.painPoints, 2);
  var obj0  = extractObj(role.objectives, 0);
  var obj1  = extractObj(role.objectives, 1); // eslint-disable-line no-unused-vars
  var wf = (workflows && workflows.length) ? workflows[habitIndex % workflows.length] : null;
  var wfName = wf ? wf.name : role.role + ' workflow';

  // ── Tech context extracted from company profile ──────────────────────────────
  var platforms = (clientInfo && clientInfo.techPlatforms) || [];
  function cleanName(s) { return s.split('(')[0].split('/')[0].trim(); }
  function matchPlatform(pats) {
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i].toLowerCase();
      for (var j = 0; j < pats.length; j++) {
        if (p.indexOf(pats[j]) !== -1) return cleanName(platforms[i]);
      }
    }
    return null;
  }
  var sourceControl = matchPlatform(['gitlab','github','bitbucket','azure devops']) || 'source control';
  var ciTool        = matchPlatform(['gitlab','jenkins','circleci','github actions','bamboo','azure devops']) || 'CI pipeline';
  var observability = matchPlatform(['grafana','kibana','datadog','new relic','splunk','cloudwatch']) || 'monitoring stack';
  var ticketing     = matchPlatform(['jira','linear','azure devops','github issues','youtrack','asana']) || 'sprint tracker';
  var techStr       = platforms.length ? platforms.slice(0, 4).map(cleanName).join(', ') : 'your engineering platform';

  // Test framework: check platforms first, then role key activities
  var allActivitiesLower = (role.keyActivities || '').toLowerCase();
  var testFramework = matchPlatform(['cypress','selenium','pytest','jest','playwright','mocha','junit','xunit']) ||
    (['cypress','selenium','pytest','jest','playwright','mocha','junit'].filter(function(f){ return allActivitiesLower.indexOf(f) !== -1; })[0]) ||
    'your test framework';

  // First key activities as concrete task examples
  var activities = (role.keyActivities || '').split(',').map(function(a){ return a.trim(); }).filter(Boolean);
  var activity0 = activities[0] || role.role + ' tasks';
  var activity1 = activities[1] || activity0;

  // ── Role-type detection: drives SH2/SH3/SH7 to role-appropriate content ────
  var roleCode = (role.short || '').toUpperCase();
  var roleType = roleCode === 'PP' ? 'PP' :
    (roleCode === 'QA' || roleCode === 'QAE') ? 'QA' :
    (roleCode === 'DP' || roleCode === 'DOP') ? 'DEVOPS' :
    roleCode === 'SEC' ? 'SEC' :
    roleCode === 'TLA' ? 'TLA' : 'SWE';

  // SH2 — role-appropriate implementation habit
  var sh2def = roleType === 'PP' ? {
    id:'SH2', entry:'Claude.ai Web', baseSaved:60, highPriority:true,
    title:'Translate a ' + coShort + ' stakeholder brief into an agent-executable specification — structured, measurable, actionable',
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Transform this brief into a structured specification.\n\n[Paste the stakeholder brief or Slack message]\n\nProduce:\n1. One-sentence outcome — what must be true when done\n2. 3–5 acceptance criteria that engineering can verify and QA can test\n3. Data model or state changes required (if any)\n4. Out-of-scope boundary — what this spec does NOT cover\n5. Open questions that block sprint commitment\n6. Complexity estimate: S / M / L with one-line reasoning\n\nContext at ' + coShort + ': ' + pain0 + '\n\nFormat as a ' + ticketing + ' story description — paste-ready for sprint planning. Do not write code.',
    inputs:ticketing + ' story template; stakeholder brief or feature request; known constraints and compliance requirements at ' + coShort,
    metric:'Spec writing from ~90 minutes to ~30 minutes; engineering ambiguity questions per spec drop by ~70% (BCG/Harvard "Jagged Frontier": 25–40% speed gain on well-specified tasks)',
    guardrails:'Spec requires product owner review before sprint entry; any acceptance criterion dependent on a third party must be flagged; never commit to delivery without all "open questions" resolved'
  } : roleType === 'QA' ? {
    id:'SH2', entry:'Claude Code CLI', baseSaved:120, highPriority:true,
    title:'Build automated ' + testFramework + ' coverage for ' + coShort + ' — expand test suite to 80% branch coverage in one agent run',
    pain:pain1,
    prompt:'# In your project directory:\nclaude\n\n# Paste this task into Claude Code:\nI am a ' + role.role + ' at ' + coShort + '. Expand automated test coverage for this service.\n\nTarget: [Module or service name]\nCoverage goal: 80% branch coverage (current: [X]%)\n\nThis codebase uses ' + techStr + '. Act as my test automation agent:\n\nStep 1 — Coverage analysis: Run the existing ' + testFramework + ' suite, identify uncovered branches and edge cases. Report findings before writing anything.\n\nStep 2 — Test plan: List every test case you will write, grouped by scenario. Wait for my go-ahead.\n\nStep 3 — Implement: Write all ' + testFramework + ' tests following existing patterns. Cover happy path, error paths, and boundary conditions.\n\nStep 4 — Write the ' + sourceControl + ' MR description: coverage delta, test categories added, notes for review.\n\nConstraints:\n- Do not modify production code — test code only\n- Current blocker: ' + pain1 + '\n- Follow naming conventions in existing tests\n\nDo not write any tests until I confirm the plan in Step 2.',
    inputs:testFramework + ' test suite; coverage report (current baseline); module under test; any known edge cases or defect history at ' + coShort,
    metric:'Test coverage expanded ~55% faster than manual authoring (GitHub Copilot study: N=95, P=.0017); ' + sourceControl + ' MR ready with full coverage report; QA backlog cleared faster',
    guardrails:'Review all generated tests before raising the MR; run the full ' + ciTool + ' pipeline; confirm assertions are meaningful and not just coverage-padding'
  } : roleType === 'DEVOPS' ? {
    id:'SH2', entry:'Claude Code CLI', baseSaved:120, highPriority:true,
    title:'Build a ' + coShort + ' ' + ciTool + ' pipeline improvement — automate a deployment workflow end-to-end with Claude Code',
    pain:pain1,
    prompt:'# In your project directory:\nclaude\n\n# Paste this task into Claude Code:\nI am a ' + role.role + ' at ' + coShort + '. Build the following pipeline automation end-to-end.\n\nPipeline task: [e.g., "Add security scanning to ' + ciTool + '" or "Implement blue-green deployment for [service]"]\n\nThis stack uses ' + techStr + '. Act as my platform engineering agent:\n\nStep 1 — Explore: Examine the current ' + ciTool + ' config and deployment scripts. Report what exists before touching anything.\n\nStep 2 — Propose: File-by-file plan, new pipeline stages or IaC changes, and validation approach. Wait for my go-ahead.\n\nStep 3 — Implement: Pipeline config, IaC, runbook update, and validation commands.\n\nStep 4 — Write the ' + sourceControl + ' MR description: what changes, why, how to test, rollback procedure.\n\nConstraints:\n- Current blocker: ' + pain1 + '\n- Do not modify unrelated pipeline stages\n- All changes must pass ' + ciTool + ' dry-run before MR is raised',
    inputs:ciTool + ' pipeline config; deployment architecture; any runbook sections to update; target environment specs',
    metric:'Pipeline automation ~55% faster to build and validate (GitHub Copilot controlled study, N=95); deployment time reduced and manual intervention per release minimised',
    guardrails:'Review all pipeline config changes before merging; test in staging first; confirm rollback procedure is documented; never modify production pipelines without peer review'
  } : roleType === 'SEC' ? {
    id:'SH2', entry:'Claude Code CLI', baseSaved:120, highPriority:true,
    title:'Run an automated security code review of ' + coShort + ' services — identify vulnerabilities and generate remediation code with Claude Code',
    pain:pain1,
    prompt:'# In your project directory:\nclaude\n\n# Paste this task into Claude Code:\nI am a ' + role.role + ' at ' + coShort + '. Conduct a security code review of this service.\n\nTarget: [Service or module name]\nScope: [Authentication / input validation / secret handling / external API calls]\n\nThis codebase uses ' + techStr + '. Act as my security review agent:\n\nStep 1 — Explore: Map the attack surface — auth, authorisation, data handling, external calls, secret storage. Report before proposing changes.\n\nStep 2 — Findings: List all vulnerabilities by severity (Critical / High / Medium / Low). For each: issue description, exploitability in ' + coShort + '\'s context, and remediation. Wait for my go-ahead.\n\nStep 3 — Remediation code: Implement approved High and Critical fixes, following existing patterns.\n\nStep 4 — Write the ' + sourceControl + ' MR: vulnerability summary, fixes applied, deferred items and why.\n\nConstraints:\n- Current blocker: ' + pain1 + '\n- Do not modify business logic outside the security fix scope',
    inputs:'Service code; any known CVEs or prior findings; compliance requirements; threat model if available',
    metric:'Security review ~55% faster than manual (GitHub Copilot study); Critical and High findings remediated before production; audit trail maintained in ' + sourceControl,
    guardrails:'All findings require security lead sign-off before MR is raised; Critical findings block deployment; Medium/Low deferred items tracked in ' + ticketing
  } : roleType === 'TLA' ? {
    id:'SH2', entry:'Claude Code CLI', baseSaved:120, highPriority:true,
    title:'Prototype the ' + coShort + ' architectural approach — build a working spike and evaluate fit before the team commits',
    pain:pain1,
    prompt:'# In your project directory:\nclaude\n\n# Paste this task into Claude Code:\nI am a ' + role.role + ' at ' + coShort + '. Build a working architectural spike.\n\nArchitectural question: [e.g., "Evaluate event-driven vs. request-response for [service]" or "Prototype the proposed [data model]"]\n\nThis stack uses ' + techStr + '. Act as my architecture spike agent:\n\nStep 1 — Explore: Map the current architecture — entry points, data flows, integration contracts, constraints. Report before building.\n\nStep 2 — Spike plan: What you will build to answer the question, what to prove or disprove, how to measure fit. Wait for my go-ahead.\n\nStep 3 — Build: Minimal working prototype — no production polish, just prove the approach.\n\nStep 4 — Evaluation report: Does this fit ' + coShort + '\'s constraints? What works, what breaks, recommendation with confidence level.\n\nConstraints:\n- Constraint to validate against: ' + pain1 + '\n- Spike code goes in /spike — do not touch production code',
    inputs:'Existing architecture docs or ADRs; integration contracts; performance or scalability requirements; any prior spikes',
    metric:'Architecture decision validated in days not weeks; team commits with working code evidence rather than whiteboard reasoning; reduces costly late-stage rework',
    guardrails:'Spike code must not be merged to main without a production implementation; evaluation requires engineering lead review; all trade-offs documented before team commits'
  } : { // SWE default — feature implementation
    id:'SH2', entry:'Claude Code CLI', baseSaved:120, highPriority:true,
    title:'Implement a ' + coShort + ' feature end-to-end with Claude Code — code, tests, and ' + sourceControl + ' MR in one agent run',
    pain:pain1,
    prompt:'# In your project directory:\nclaude\n\n# Paste this task into Claude Code:\nI am a ' + role.role + ' at ' + coShort + '. Implement the following feature end-to-end.\n\nFeature: [Paste your ' + ticketing + ' story title and acceptance criteria here]\n\nThis codebase uses ' + techStr + '. Act as my engineering agent:\n\nStep 1 — Explore the codebase: find the relevant modules, existing patterns for this type of change, and related tests. Report what you find before touching anything.\n\nStep 2 — Propose your approach: file-by-file plan, any new dependencies, and how you will test it. Wait for my go-ahead.\n\nStep 3 — Implement completely: feature code + unit tests + any config or migration changes. Follow the patterns from Step 1.\n\nStep 4 — Write the ' + sourceControl + ' MR description: what changed, why, how to test it locally, and review notes for the Tech Lead.\n\nConstraints:\n- Current blocker to address: ' + pain1 + '\n- Do not modify files outside the scope of this feature\n- All new logic must have unit test coverage\n\nDo not write any code until I confirm the approach in Step 2.',
    inputs:ticketing + ' story with acceptance criteria; any related existing code or API contracts; branch name',
    metric:'Feature implementation ~55% faster than solo (GitHub Copilot controlled study, N=95, P=.0017 — task time cut from 2h41m to 1h11m on comparable coding task); consistent ' + sourceControl + ' MR quality',
    guardrails:'Review all diffs before raising the MR; confirm the approach at Step 2 before Claude writes any code; run the full ' + ciTool + ' pipeline before merging'
  };

  // SH3 — parallel execution: PP→Web product comparison; all coding roles→CLI parallel worktrees
  var sh3def = roleType === 'PP' ? {
    id:'SH3', entry:'Claude.ai Web', baseSaved:60, highPriority:false,
    title:'Explore two ' + coShort + ' product approaches simultaneously — draft both independently, then compare',
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Evaluate two product approaches in parallel.\n\nApproach A: [Option A]\nApproach B: [Option B]\n\nFor each approach independently produce:\n1. 3–5 step implementation path\n2. Key risks and assumptions to validate\n3. What success looks like at 30 / 60 / 90 days\n4. Who on the ' + coShort + ' team owns each workstream\n5. The single decision that would make you abandon this path\n\nDo NOT compare yet — produce both assessments completely first.\n\nThen: recommend one approach given: ' + obj0,
    inputs:'Strategic options to evaluate; ' + coShort + '\'s stated priorities and constraints; any existing user or market signal data; team capacity',
    metric:'Two options fully evaluated in one session vs. multiple stakeholder meetings; anchoring bias reduced; decision documented and referenceable',
    guardrails:'Recommendation requires review with engineering and product lead; validate assumptions with real data before committing; document reasoning trail in ' + ticketing
  } : {
    id:'SH3', entry:'Claude Code CLI', baseSaved:85, highPriority:false,
    title:'Run parallel Claude Code worktrees at ' + coShort + ' — deliver two ' + role.role + ' tasks simultaneously in separate ' + sourceControl + ' branches',
    pain:pain0,
    prompt:'# Set up two separate git worktrees — one per task:\ngit worktree add ../' + coShort.toLowerCase().replace(/\s+/g,'-') + '-task-A <branch-name-A>\ngit worktree add ../' + coShort.toLowerCase().replace(/\s+/g,'-') + '-task-B <branch-name-B>\n\n# Open a separate terminal and start Claude Code in each worktree:\ncd ../' + coShort.toLowerCase().replace(/\s+/g,'-') + '-task-A && claude\n\n# Give each Claude Code session ONE scoped task:\nI am a ' + role.role + ' at ' + coShort + '. This session owns ONE task only — do not touch files outside its scope.\n\nTask for this worktree: [One scoped task from your ' + ticketing + ' board — one ' + (roleType === 'QA' ? testFramework + ' test suite' : roleType === 'DEVOPS' ? 'pipeline change' : roleType === 'SEC' ? 'service security audit' : roleType === 'TLA' ? 'architecture spike' : 'feature or fix') + ']\n\nI am running a parallel Claude Code session in a separate worktree for a different task.\n\nThis codebase uses ' + techStr + '. For this task:\n1. Explore the relevant files and confirm scope — report before changing anything\n2. Implement completely\n3. Write the ' + sourceControl + ' MR description and flag any cross-branch risks\n\nContext — why this matters at ' + coShort + ': ' + obj0,
    inputs:'Two scoped task briefs (one per worktree); ' + ticketing + ' story per branch; files in scope; branch names',
    metric:'Two tasks delivered in the time of one; ~23 min context-switching overhead removed per task pair (UC Irvine / Gloria Mark research); sprint throughput doubles for independent work items',
    guardrails:'Keep each Claude Code session strictly scoped to its worktree; review and merge each branch independently via ' + sourceControl + '; resolve any merge conflicts before both MRs land on main'
  };

  // SH7 — overnight autonomous run: PP→Web backlog grooming; all coding roles→CLI overnight agent
  var sh7TaskEx = roleType === 'QA' ?
    '"Run the full ' + testFramework + ' regression suite, triage failures by severity, and prepare a morning report"' :
    roleType === 'DEVOPS' ?
    '"Run infrastructure health checks across all environments and prepare an ops briefing"' :
    roleType === 'SEC' ?
    '"Scan our stack for new CVEs published this week and exposed secrets in recent commits"' :
    roleType === 'TLA' ?
    '"Audit all dependencies for CVEs and flag packages more than 2 major versions behind stable"' :
    '"Expand ' + testFramework + ' test coverage for [module] to 80% branch coverage" or "Refactor [component] to eliminate: ' + pain0 + '"';

  var sh7def = roleType === 'PP' ? {
    id:'SH7', entry:'Claude.ai Web', baseSaved:120, highPriority:false,
    title:'Queue overnight backlog grooming at ' + coShort + ' — wake up to a prioritised sprint candidate list',
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Review our backlog and prepare prioritised sprint candidates for tomorrow\'s planning.\n\nFrom this backlog:\n[Paste backlog export or ticket list]\n\nFor each item:\n1. Score against our current priorities: [list ' + coShort + '\'s priorities]\n2. Identify missing information blocking a sprint commitment\n3. Flag dependencies on other items or teams\n4. Estimate complexity: S / M / L\n5. Propose a sprint grouping that fits [X] story points\n\nOutput: proposed sprint with rationale, items needing clarification, dependency map.\n\nContext at ' + coShort + ': ' + pain0,
    inputs:'Product backlog export; sprint capacity in story points; strategic priorities this quarter; list of active dependencies or blockers',
    metric:'Sprint planning from 2 hours to 30 minutes; accuracy improves with AI-flagged missing information and dependency mapping',
    guardrails:'AI-proposed sprint is a starting point — final commitment requires team agreement; never commit to items with unresolved open questions; validate all dependency flags before sprint start'
  } : {
    id:'SH7', entry:'Claude Code CLI', baseSaved:175, highPriority:false,
    title:'Queue a ' + role.role + ' task to run autonomously in Claude Code at ' + coShort + ' — review the ' + sourceControl + ' output at morning standup',
    pain:pain0,
    prompt:'# In your project directory:\nclaude\n\n# Queue this task before end of day — Claude runs, you review tomorrow:\nI am a ' + role.role + ' at ' + coShort + '. Complete this task fully autonomously. I will not be monitoring — run to completion and leave a reviewable output.\n\nTask:\n[Describe the task in full — e.g., ' + sh7TaskEx + ']\n\nThis codebase uses ' + techStr + '.\n\nBefore starting:\n1. Explore the relevant files and confirm you have everything needed — list what you found\n2. If you hit a hard blocker requiring a decision, stop cleanly and document it; do not guess\n3. Confirm the task is self-contained before beginning\n\nExecute completely. When finished, create REVIEW.md containing:\n- What was completed and what changed\n- Files modified (list with one-line reason each)\n- Key decisions made and why\n- Items needing my review before the ' + sourceControl + ' MR is raised\n- Any risks or assumptions I should validate before merging\n\nContext — why this matters at ' + coShort + ': ' + obj0,
    inputs:'Full task description with acceptance criteria; branch name to work on; files in scope; any standards to follow',
    metric:'~75% of active engineering time converted to passive review (Salesforce/Cursor: 85% effort reduction on test coverage; Anthropic 100k conversations: 80% average time reduction on autonomous tasks); REVIEW.md ready at morning standup',
    guardrails:'Review REVIEW.md and all diffs before raising the ' + sourceControl + ' MR; run the full ' + ciTool + ' pipeline; validate key assumptions; never deploy to ' + coShort + ' production without human sign-off'
  };

  // SH1 — role-specific intent brief (what you write BEFORE starting work)
  var sh1def = roleType === 'QA' ? {
    id:'SH1', entry:'Claude.ai Web', baseSaved:25, highPriority:true,
    title:'Write the ' + coShort + ' test strategy before writing tests — QA coverage plan for ' + activity0,
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before I write a single test, help me write a test strategy for this scope.\n\nScope: [Paste the ' + ticketing + ' story or sprint release scope]\n\nChallenge: ' + pain0 + '\n\n1. Test scope — what is explicitly in scope for testing vs. out of scope?\n2. Test types — what mix of unit, integration, ' + testFramework + ' E2E, and exploratory testing is needed and why?\n3. Risk map — which areas carry the highest regression risk at ' + coShort + ' and need the most coverage?\n4. Entry and exit criteria — when is this scope considered "tested" and ready for sign-off?\n5. Blockers — what dev dependencies, test data, or environment access must exist before testing can begin?\n\nOutput: a QA strategy document I can paste into ' + ticketing + ' before development starts. Do not write test code.',
    inputs:ticketing + ' story or sprint scope; any known regression risk areas; test environment details; existing coverage baseline at ' + coShort,
    metric:'Test planning time reduced by ~30%; coverage gaps caught before development completes rather than after (BCG/Harvard: 25–40% quality improvement on well-specified work)',
    guardrails:'Strategy requires Tech Lead or QA Lead review before sprint starts; flag any area where test data or environment access is not yet confirmed'
  } : roleType === 'TLA' ? {
    id:'SH1', entry:'Claude.ai Web', baseSaved:25, highPriority:true,
    title:'Write the ' + coShort + ' ADR before the architecture decision is made — decision brief for ' + activity0,
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before this architectural decision is made in a meeting, help me write an Architecture Decision Record (ADR).\n\nDecision needed: [Describe the architectural question — e.g., "' + activity0 + '"]\n\nChallenge: ' + pain0 + '\n\n1. Context — what constraints, requirements, and team capabilities drive this decision at ' + coShort + '?\n2. Options considered — 2–3 viable approaches with one-line pros and cons each\n3. Decision criteria — what matters most: performance, maintainability, cost, team skill, or operational complexity?\n4. Consequences — what does choosing this approach make easier? What does it foreclose or make harder?\n5. Review trigger — under what circumstances should this ADR be revisited?\n\nOutput: a structured ADR I can paste into Confluence or ' + sourceControl + ' before the architecture review.',
    inputs:'Architectural question with constraints; options already under consideration; team capability context; performance or compliance requirements',
    metric:'Architecture decisions documented before the meeting, not after; undocumented assumption rework eliminated; new engineers onboard faster with an ADR trail',
    guardrails:'ADR requires sign-off from at least one peer architect before it is treated as decided; "decision" field must not be blank; revisit triggers must be specific and measurable'
  } : roleType === 'PP' ? {
    id:'SH1', entry:'Claude.ai Web', baseSaved:25, highPriority:true,
    title:'Write the ' + coShort + ' product outcome before writing the spec — initiative brief for ' + activity0,
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before I write a full spec or raise a ' + ticketing + ' story, help me write a product outcome brief.\n\nInitiative: "' + activity0 + '"\n\nChallenge: ' + pain0 + '\n\n1. The outcome — what must be true for users when this is shipped, in one sentence?\n2. Success metric — how will we know in 30 days that this worked?\n3. User impact — who exactly benefits, and what can they do now that they couldn\'t before?\n4. What we are NOT building — explicit out-of-scope boundary\n5. The biggest assumption — what belief, if wrong, would make this entire initiative pointless?\n\nOutput: a one-page outcome brief I can share with engineering before sprint planning. No implementation detail.',
    inputs:'Initiative description or stakeholder request; any existing user research or data; team capacity; strategic priorities this quarter',
    metric:'Engineering ambiguity questions per initiative drop by ~70% (BCG/Harvard "Jagged Frontier"); sprint commitments made with clarity rather than hope',
    guardrails:'Outcome brief requires stakeholder review before any spec is written; the "biggest assumption" must be validated before committing to a full sprint'
  } : roleType === 'DEVOPS' ? {
    id:'SH1', entry:'Claude.ai Web', baseSaved:25, highPriority:true,
    title:'Write the ' + coShort + ' infrastructure change proposal before touching IaC — change brief for ' + activity0,
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before I write IaC or modify ' + ciTool + ' config, help me write a change proposal.\n\nChange: "' + activity0 + '"\n\nChallenge: ' + pain0 + '\n\n1. Change scope — exactly which infrastructure components, services, or pipelines at ' + coShort + ' are affected?\n2. Risk assessment — what could break? What is the rollback plan if this goes wrong?\n3. Pre-conditions — what must be true before this change is safe to apply?\n4. Validation plan — how will I verify the change worked correctly in each environment?\n5. Stakeholder impact — who needs to know about this change before it is applied?\n\nOutput: a change proposal I can paste into ' + ticketing + ' before any IaC is written.',
    inputs:'Change description; affected infrastructure components; relevant runbook sections; environment specifications; change window constraints at ' + coShort,
    metric:'Infrastructure change incidents from insufficient planning reduced; rollback procedures documented before changes are made, not during an incident',
    guardrails:'Change proposal requires peer review before IaC is written; all rollback procedures must be tested in staging first; never apply to production without documented approval'
  } : roleType === 'SEC' ? {
    id:'SH1', entry:'Claude.ai Web', baseSaved:25, highPriority:true,
    title:'Write the ' + coShort + ' threat model before the security assessment begins — scope brief for ' + activity0,
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before conducting a security assessment, help me write a threat model brief.\n\nTarget: "' + activity0 + '"\n\nChallenge: ' + pain0 + '\n\n1. Attack surface — what are the entry points, trust boundaries, and data flows to assess?\n2. Threat actors — who are the realistic adversaries and what are their likely capabilities against ' + coShort + '?\n3. Assets at risk — what data or functionality must be protected?\n4. Relevant threat vectors — which vulnerability classes are most likely given the stack: ' + techStr + '?\n5. Assessment scope — what is explicitly in scope vs. out of scope for this engagement?\n\nOutput: a threat model brief I can share with the team before the assessment begins.',
    inputs:'System description; data classification requirements; known threat history; compliance framework; tech stack details',
    metric:'Security assessment coverage gaps caught before the engagement starts; time wasted on out-of-scope findings eliminated; findings are actionable because scope is agreed upfront',
    guardrails:'Threat model requires review by a senior security engineer before assessment begins; data classification must be confirmed with the system owner; never start without agreed scope'
  } : { // SWE default — implementation intent before coding
    id:'SH1', entry:'Claude.ai Web', baseSaved:25, highPriority:true,
    title:'Write the implementation intent before opening the codebase — feature brief in ' + ticketing + ' for ' + coShort,
    pain:pain0,
    prompt:'I am a ' + role.role + ' at ' + coShort + ' about to implement:\n\n"' + activity0 + '"\n\nChallenge: ' + pain0 + '\n\nBefore I touch the codebase or create a ' + ticketing + ' ticket, help me write a tight implementation intent brief:\n\n1. Outcome — what exactly must be true when this is done, in one sentence?\n2. Technical acceptance criteria — 3–5 conditions that automated tests can verify\n3. Scope boundary — what files, services, or APIs are IN scope vs. OUT?\n4. Likely failure point — where does this type of change typically break at ' + coShort + '?\n5. Pre-conditions — what must exist (API contracts, migrations, feature flags) before I start?\n\nOutput: a paste-ready ' + ticketing + ' story description. Do not start implementation.',
    inputs:ticketing + ' story template; stakeholder request or existing ticket; any relevant API contracts or designs; compliance constraints at ' + coShort,
    metric:'Rework from scope misalignment reduced by ~30%; implementation starts with clear acceptance criteria (BCG/Harvard "Jagged Frontier": 25–40% speed gain on well-specified tasks)',
    guardrails:'Review with product owner or Tech Lead before coding; flag any acceptance criterion that depends on a third-party decision not yet made'
  };

  // SH4 — role-specific pre-execution review (what you review BEFORE running or merging)
  var sh4def = roleType === 'QA' ? {
    id:'SH4', entry:'Claude.ai Web', baseSaved:40, highPriority:false,
    title:'Review the ' + coShort + ' test plan for coverage gaps before a single ' + testFramework + ' test runs',
    pain:pain2,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before test execution begins, review this test plan for gaps.\n\n[Paste the test plan or test case list]\n\nContext: ' + wfName + ' at ' + coShort + '. Review for:\n\n1. Missing coverage — which execution paths, edge cases, or boundary conditions are not tested?\n2. Missing negative tests — what error paths or invalid inputs are not covered?\n3. Test data gaps — what scenarios require test data that may not exist in the test environment?\n4. Environment assumptions — what assumptions about the test environment could fail in practice?\n5. Blocked scenarios related to: ' + pain2 + '\n\nDo not write tests — identify gaps only. Output a numbered gap list ordered by release risk.',
    inputs:'Test plan or test case list; feature spec or user story; known environment constraints; existing coverage report',
    metric:'Coverage gaps caught before execution rather than after release; regression escapes to production reduced (~50% rework reduction per BCG/Harvard)',
    guardrails:'Address all High-risk gaps before execution begins; loop in the developer if a gap requires new endpoints or test data; document deferred gaps in ' + ticketing
  } : roleType === 'TLA' ? {
    id:'SH4', entry:'Claude.ai Web', baseSaved:40, highPriority:false,
    title:'Review the ' + coShort + ' architecture proposal for hidden risks before the team commits',
    pain:pain2,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before this architectural proposal is committed to, review it for hidden risks.\n\n[Paste the ADR, design doc, or architecture description]\n\nContext: ' + wfName + ' at ' + coShort + '. Review for:\n\n1. Missing constraints — what operational, compliance, or team-skill constraints are not addressed?\n2. Scalability assumptions — what load, data volume, or growth assumptions could break this design?\n3. Integration risks — what dependencies on external systems or teams could block implementation?\n4. Reversibility — how hard is it to undo this decision once implemented? What is the rollback path?\n5. ' + coShort + '-specific blind spots: ' + pain2 + '\n\nDo not redesign — identify and rank risks by impact. Output a numbered risk list.',
    inputs:'ADR or design doc; system constraints and compliance requirements; team capability profile; integration dependencies',
    metric:'Architectural risks caught before implementation (~50% rework reduction per BCG/Harvard); team commits to better-understood decisions',
    guardrails:'Address all High-impact risks before architecture is finalised; loop in affected teams on integration risks; revisit this review if scope changes significantly'
  } : roleType === 'PP' ? {
    id:'SH4', entry:'Claude.ai Web', baseSaved:40, highPriority:false,
    title:'Review the ' + coShort + ' user story for missing acceptance criteria before it enters the sprint',
    pain:pain2,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before this user story enters the sprint, review it for gaps and ambiguity.\n\n[Paste the user story or ' + ticketing + ' ticket]\n\nContext: ' + wfName + ' at ' + coShort + '. Review for:\n\n1. Missing acceptance criteria — what outcomes are implied but not explicitly stated?\n2. Ambiguous terms — what words could two engineers interpret differently?\n3. Missing edge cases — what user behaviour at the boundaries is not covered?\n4. Unstated dependencies — what other stories, APIs, or decisions must be resolved first?\n5. Definition-of-done gaps related to: ' + pain2 + '\n\nDo not rewrite the story — identify and rank gaps by sprint risk. Output a numbered list.',
    inputs:ticketing + ' story with current acceptance criteria; any wireframes or designs; known dependencies; similar past stories for comparison',
    metric:'Sprint surprises and mid-sprint scope changes reduced by ~50% (BCG/Harvard); engineering back-and-forth questions per story drop from 6 to 1',
    guardrails:'Address all High-risk gaps before sprint commitment; loop in product owner if acceptance criteria need changing; never start a story with unresolved ambiguity'
  } : roleType === 'DEVOPS' ? {
    id:'SH4', entry:'Claude.ai Web', baseSaved:40, highPriority:false,
    title:'Review the ' + coShort + ' ' + ciTool + ' pipeline change for deployment risks before it runs',
    pain:pain2,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before this pipeline or infrastructure change is applied, review it for deployment risks.\n\n[Paste the pipeline config diff, IaC change, or runbook]\n\nContext: ' + wfName + ' at ' + coShort + '. Review for:\n\n1. Missing rollback — what is the revert procedure if this change needs to be undone? Is it documented?\n2. Blast radius — what downstream services or teams could be affected?\n3. Validation gaps — how will success be verified in each environment before progressing to production?\n4. Environment-specific risks that work in staging but could fail in production due to: ' + pain2 + '\n5. Missing approvals — who needs to sign off before this runs?\n\nDo not modify the config — identify and rank risks. Output a numbered checklist.',
    inputs:'Pipeline config diff or IaC change; deployment architecture; current runbook; list of dependent services',
    metric:'Deployment incidents from configuration errors reduced by ~50%; rollback procedures documented before changes are made, not during incidents',
    guardrails:'Address all High-risk items before the change is applied; verify rollback in staging; never apply to production without documented peer review'
  } : roleType === 'SEC' ? {
    id:'SH4', entry:'Claude.ai Web', baseSaved:40, highPriority:false,
    title:'Review the ' + coShort + ' feature spec for security vulnerabilities before development starts',
    pain:pain2,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before development starts on this feature, review the spec for security vulnerabilities and missing controls.\n\n[Paste the feature spec, user story, or design doc]\n\nContext: ' + wfName + ' at ' + coShort + '. Review for:\n\n1. Authentication and authorisation gaps — are there operations that should require elevated privilege but are not specified?\n2. Data exposure risks — what sensitive data is handled? Are data classification requirements addressed?\n3. Input validation — what user-supplied or external inputs are processed? Are they all validated and sanitised?\n4. Audit trail gaps — what security-relevant events should be logged but are not specified?\n5. ' + coShort + '-specific security constraints related to: ' + pain2 + '\n\nDo not fix — identify and rank by severity (Critical / High / Medium / Low). Output a security gap list.',
    inputs:'Feature spec or user story; data classification of assets involved; relevant compliance requirements; known vulnerability history for this area',
    metric:'Security vulnerabilities caught at design time (10× cheaper to fix) vs. after implementation; VAPT findings for in-flight features reduced',
    guardrails:'Critical and High gaps must be addressed before any development starts; loop in product owner if spec changes are required; track deferred items in ' + ticketing
  } : { // SWE default — review own PR before raising
    id:'SH4', entry:'Claude.ai Web', baseSaved:40, highPriority:false,
    title:'Review your own ' + coShort + ' PR before raising it to ' + sourceControl + ' — catch author blind spots before review',
    pain:pain2,
    prompt:'I am a ' + role.role + ' at ' + coShort + '. Before I raise this PR, review my own changes for issues I\'ve missed as the author.\n\n[Paste the PR diff or describe the changes]\n\nContext: ' + wfName + ' at ' + coShort + '. Review as a critical peer:\n\n1. Missing tests — which execution paths, edge cases, or error conditions have no test coverage?\n2. Scope creep — are there any changes here beyond the original ' + ticketing + ' story?\n3. Code quality — what patterns here could cause problems at scale or make future changes harder?\n4. ' + coShort + '-specific risks — what could break existing functionality given: ' + pain2 + '?\n5. MR description gaps — what would a reviewer need to understand that isn\'t clear from the diff?\n\nDo not fix — identify and rank issues by review impact. Output a numbered list I can action before raising.',
    inputs:'PR diff or description; ' + ticketing + ' story the PR addresses; any known constraints or standards at ' + coShort,
    metric:'Review round-trips reduced from 3–4 to 1–2 per feature; author blind spots caught before reviewer time is spent (~50% rework reduction per BCG/Harvard)',
    guardrails:'Address all High-impact findings before raising the MR; loop in product owner if scope changes are needed; run ' + ciTool + ' before raising'
  };

  // SH5 — role-specific draft + self-audit (what you WRITE, not what you build)
  var sh5def = roleType === 'QA' ? {
    id:'SH5', entry:'Claude.ai Web', baseSaved:40, highPriority:true,
    title:'Draft the ' + coShort + ' test report and quality metrics — self-audit before it reaches stakeholders',
    pain:pain1,
    prompt:'Draft the following QA content for ' + coShort + ':\n\n[Describe what to draft — e.g., sprint test report, regression summary, quality dashboard commentary, release go/no-go document]\n\nContext:\n- Purpose: [who will act on this and what decision it enables]\n- Audience: [Tech Lead, Product Owner, Engineering Manager]\n- Key message: [the single most important quality signal this must communicate]\n- Sprint context: ' + obj0 + '\n- Known quality challenge: ' + pain1 + '\n\nAfter drafting, self-audit:\n1. Would a developer challenged by this report know exactly what to fix and in what order?\n2. Are the quality metrics presented fairly — does anything make quality look better than it is?\n3. What assumption about test environment stability did you embed that a reader might challenge?\n4. Is any finding vague enough that the team could deprioritise it without being technically wrong?\n5. What is the single finding that, if buried, would cause the most regret after release?\n\nOutput the draft and self-audit together.',
    inputs:'Test execution results; defect log; coverage report; any known environment or test data issues; previous sprint quality trend',
    metric:'QA report time from ~90 minutes to ~40 minutes; self-audit catches data presentation issues before stakeholder review',
    guardrails:'Never publish AI-drafted QA content without reviewing all metrics against actual test data; address all self-audit flags; verify numbers before sending'
  } : roleType === 'TLA' ? {
    id:'SH5', entry:'Claude.ai Web', baseSaved:40, highPriority:true,
    title:'Draft the ' + coShort + ' architecture proposal or RFC — self-audit before team review',
    pain:pain1,
    prompt:'Draft the following architecture content for ' + coShort + ':\n\n[Describe what to draft — e.g., architecture proposal, RFC, system design doc, tech radar entry, or migration plan]\n\nContext:\n- Purpose: [what decision this document enables]\n- Audience: [engineering team, CTO, product stakeholders]\n- Key message: [the single most important technical argument this must make]\n- Architecture context: ' + obj0 + '\n- Constraint to address: ' + pain1 + '\n\nAfter drafting, self-audit:\n1. What assumptions about team capability or operational capacity did you make that a reader would challenge?\n2. Is the trade-off section honest — does it fully acknowledge the downsides of the recommended approach?\n3. What would a skeptical senior engineer attack first in this proposal?\n4. What must be verified against actual ' + coShort + ' system metrics before this goes out?\n5. What is the weakest technical argument in this document?\n\nOutput the draft and self-audit together.',
    inputs:'Architecture problem statement; constraints (performance, compliance, team size); relevant ADRs; current tech stack at ' + coShort,
    metric:'Architecture proposals ready for review in ~40% less time; self-audit catches weak arguments before peer challenge',
    guardrails:'Never treat AI-drafted architecture proposals as final; address all self-audit flags; verify all performance claims against actual ' + coShort + ' system data'
  } : roleType === 'PP' ? {
    id:'SH5', entry:'Claude.ai Web', baseSaved:40, highPriority:true,
    title:'Draft the ' + coShort + ' PRD or stakeholder update — self-audit before it reaches engineering',
    pain:pain1,
    prompt:'Draft the following product content for ' + coShort + ':\n\n[Describe what to draft — e.g., product requirements document, sprint review summary, stakeholder update, feature brief, go/no-go recommendation]\n\nContext:\n- Purpose: [what decision this document enables]\n- Audience: [engineering team, senior stakeholders, leadership]\n- Key message: [the single most important point this must land]\n- Product context: ' + obj0 + '\n- Challenge to address: ' + pain1 + '\n\nAfter drafting, self-audit:\n1. What user assumption did you embed that hasn\'t been validated with real users or data?\n2. Would an engineer reading this know what to build — or would they still have 5 questions?\n3. Is anything framed optimistically in a way that a skeptical stakeholder would push back on?\n4. What must be verified against ' + ticketing + ' data or user research before this goes out?\n5. What is the single sentence that, if wrong, invalidates the whole document?\n\nOutput the draft and self-audit together.',
    inputs:'Initiative brief or stakeholder request; any user research or data; sprint metrics; prior communications on this topic',
    metric:'Product documentation time reduced by ~40%; self-audit catches unvalidated assumptions before engineering commits to them',
    guardrails:'Never share AI-drafted product docs without human review; address all self-audit flags; verify all user or metric claims against real data before sending'
  } : roleType === 'DEVOPS' ? {
    id:'SH5', entry:'Claude.ai Web', baseSaved:40, highPriority:true,
    title:'Draft the ' + coShort + ' incident post-mortem or deployment report — self-audit before distribution',
    pain:pain1,
    prompt:'Draft the following operational content for ' + coShort + ':\n\n[Describe what to draft — e.g., incident post-mortem, deployment report, on-call handover, or infrastructure change summary]\n\nContext:\n- Purpose: [incident review, deployment sign-off, or ops handover]\n- Audience: [engineering team, management, on-call rotation]\n- Key message: [the single most important operational fact this must communicate]\n- Operational context: ' + obj0 + '\n- Known challenge: ' + pain1 + '\n\nAfter drafting, self-audit:\n1. If another engineer reads this at 2am during an incident, will they know exactly what to do?\n2. Does the post-mortem blame systems rather than people — is the language blameless?\n3. Are the action items specific, assigned, and time-bound — or vague commitments?\n4. What must be verified against ' + observability + ' data before this goes out?\n5. What would the on-call engineer most want to know that isn\'t clearly stated?\n\nOutput the draft and self-audit together.',
    inputs:'Incident timeline or deployment log; monitoring data from ' + observability + '; action items already identified; prior post-mortems for similar incidents',
    metric:'Post-mortems and deployment reports ready in ~40% less time; self-audit improves quality of action items before stakeholder review',
    guardrails:'Never publish without verifying all facts against ' + observability + ' logs; address all self-audit flags; all action items must have named owners'
  } : roleType === 'SEC' ? {
    id:'SH5', entry:'Claude.ai Web', baseSaved:40, highPriority:true,
    title:'Draft the ' + coShort + ' security assessment or compliance report — self-audit before sign-off',
    pain:pain1,
    prompt:'Draft the following security content for ' + coShort + ':\n\n[Describe what to draft — e.g., VAPT findings summary, security assessment report, compliance evidence document, or risk register update]\n\nContext:\n- Purpose: [compliance submission, management review, or engineering action]\n- Audience: [CISO, engineering team, compliance officer]\n- Key message: [the single most important security finding or status this must communicate]\n- Security context: ' + obj0 + '\n- Challenge to address: ' + pain1 + '\n\nAfter drafting, self-audit:\n1. Would a non-technical stakeholder understand the business risk behind each finding?\n2. Are severity ratings defensible — is any finding over- or under-stated?\n3. What assumptions about remediation timelines did you make that the team might challenge?\n4. What must be verified against actual scan results or VAPT evidence before this goes out?\n5. What finding, if omitted or downplayed, would cause the most reputational damage if discovered?\n\nOutput the draft and self-audit together.',
    inputs:'Security scan results or VAPT findings; compliance framework requirements; system architecture; prior security reports for trend comparison',
    metric:'Security report drafting time reduced by ~40%; self-audit catches severity mis-ratings and missing evidence before sign-off review',
    guardrails:'Never publish AI-drafted security reports without human review of all findings; verify all severity ratings against actual evidence; address all self-audit flags before submitting externally'
  } : { // SWE default — technical doc drafting
    id:'SH5', entry:'Claude.ai Web', baseSaved:40, highPriority:true,
    title:'Draft the ' + coShort + ' post-mortem, ADR, or technical runbook — self-audit before it reaches the team',
    pain:pain1,
    prompt:'Draft the following engineering content for ' + coShort + ':\n\n[Describe what to draft — e.g., incident post-mortem, architecture decision record, onboarding runbook for the ' + wfName + ' workflow, or ' + sourceControl + ' MR description template]\n\nContext:\n- Purpose: [why this document is needed]\n- Audience: [Tech Lead, new joiner, product owner, on-call engineer]\n- Key message: [the single most important point this must communicate]\n- Engineering context: ' + obj0 + '\n- Known challenge to address: ' + pain1 + '\n\nAfter drafting, self-audit:\n1. What assumptions did you make that a senior ' + coShort + ' engineer would immediately challenge?\n2. Would a new joiner following this runbook succeed without asking questions?\n3. Is any section vague enough to be misinterpreted by someone outside the team?\n4. What must be verified against ' + coShort + ' systems or ' + observability + ' data before this goes out?\n5. What is the single weakest paragraph in this draft?\n\nOutput the draft and self-audit together. I will address all flagged items before sharing.',
    inputs:'Topic, purpose, and intended audience; any source material (incident timeline, sprint data, architecture diagram); relevant standards or templates at ' + coShort,
    metric:'First-draft quality good enough to share in ~40% less writing time (Anthropic internal productivity study); review cycles drop from 3 to 1',
    guardrails:'Never share without human review; address all self-audit flags; verify factual claims against ' + coShort + ' systems or ' + observability + ' data before sending'
  };

  var habitDefs = [
    sh1def,
    // SH2 — role-appropriate implementation habit (computed above)
    sh2def,
    // SH3 — parallel execution (computed above)
    sh3def,
    sh4def,
    sh5def,
    // SH6a — Web: build a reusable prompt template for a recurring task
    { id:'SH6', entry:'Claude.ai Web', baseSaved:45, highPriority:false,
      title:'Turn the ' + coShort + ' "' + activity1 + '" process into a reusable Claude template — never start from scratch again',
      pain:pain0,
      prompt:'Help me create a reusable Claude prompt template for this recurring ' + role.role + ' task at ' + coShort + ':\n\nRecurring task: ' + activity1 + '\n\nInterview me to extract the pattern:\n1. What inputs are always needed to start this task at ' + coShort + '?\n2. What is the consistent output format — what must every output include?\n3. What ' + coShort + '-specific context should always be embedded (e.g., ' + ticketing + ' format, ' + sourceControl + ' convention, compliance requirements)?\n4. What mistakes are commonly made because of: "' + pain0 + '"?\n5. What does excellent vs. acceptable output look like?\n\nAfter the interview, generate:\n- A reusable Claude prompt template with clear [FILL IN] markers\n- A one-paragraph usage guide any new ' + role.role + ' can follow in their first sprint\n- Two example completions applied to real ' + coShort + ' tasks\n\nThis template must work for a new joiner with no prior context.',
      inputs:'Description of the recurring task; a high-quality past output example; list of common failure modes; any ' + coShort + '-specific standards that apply',
      metric:'Recurring task time reduced by ~75% per use once template is established (60% average from task automation research); institutional knowledge survives rotation without handover sessions',
      guardrails:'Validate on 3 real tasks with a senior ' + role.role + ' before sharing squad-wide; store in team wiki; review quarterly; update whenever ' + coShort + ' processes change' },
    // SH6b — CLI: encode the same pattern as a SKILL.md Agent Skill for automated execution
    { id:'SH6', entry:'Claude Code CLI', baseSaved:65, highPriority:false,
      title:'Encode the ' + coShort + ' "' + activity1 + '" workflow as a SKILL.md Agent Skill — Claude Code runs it on command',
      pain:pain0,
      prompt:'# In your project directory:\nclaude\n\n# Paste this into Claude Code:\nI am a ' + role.role + ' at ' + coShort + '. Help me encode a recurring task as a SKILL.md Agent Skill so Claude Code can execute it automatically.\n\nRecurring task: ' + activity1 + '\nPain point this solves: ' + pain0 + '\n\nInterview me to extract what makes this consistent and automatable:\n1. What inputs does this task always start with?\n2. What is the exact output format that\'s always expected?\n3. What ' + coShort + '-specific context must every run include (e.g., ' + ticketing + ' format, ' + sourceControl + ' convention, compliance constraints)?\n4. Failure modes — what should the agent stop and flag vs. handle automatically?\n5. Success criteria — how would you verify the output is correct?\n\nGenerate SKILL.md in the project root:\n- name: Short, verb-first skill name\n- description: One sentence — what it does and when to invoke it\n- inputs: The [FILL IN] variables the user provides each run\n- steps: Step-by-step agent execution plan\n- guardrails: What the agent must never do or always verify\n- output: The exact deliverable format\n\nTest it immediately by running the skill and show me the output before finalising.',
      inputs:'Description of the recurring task; a high-quality past output as the gold standard; list of failure modes; any ' + coShort + '-specific standards the skill must enforce',
      metric:'Recurring task goes from manual to one-line invocation — ~75% effort reduction per run; skill compounds in value as the whole team uses it',
      guardrails:'Validate on 3 real tasks before sharing team-wide; commit SKILL.md to ' + sourceControl + ' so the whole team benefits; review quarterly; update when ' + coShort + ' processes change' },
    // SH7 — overnight autonomous run (computed above)
    sh7def
  ];

  var hd = habitDefs[habitIndex];
  // Pass the specific pain this UC addresses + the workflow context so time prediction is use-case-specific
  var timeSaved = estimateTimeSaved(hd.baseSaved, role, hd.pain, wf);
  return {
    id: ucId, role: role.role, code: role.short,
    name: hd.title, pain: hd.pain || pain0,
    habitId: hd.id, entry: hd.entry,
    prompt: hd.prompt, inputs: hd.inputs,
    metric: hd.metric, guardrails: hd.guardrails,
    timeSaved: timeSaved,
    priority: hd.highPriority ? 'High' : 'Medium'
  };
}

function generateUseCases(profileData) {
  var roles = (profileData.capabilities || []).slice(0, 6);
  var workflows = profileData.workflows || [];
  // Merge tech platform names into clientInfo so buildUseCaseForRole can produce tool-specific prompts
  var techPlatforms = (profileData.technology && profileData.technology.platforms)
    ? profileData.technology.platforms.map(function(p) { return p.name; })
    : [];
  var clientInfo = Object.assign({}, profileData.client || {}, { techPlatforms: techPlatforms });
  var useCases = [];
  var ucNum = 1;
  roles.forEach(function(role) {
    for (var hi = 0; hi < 8; hi++) {
      var ucId = 'UC-' + String(ucNum).padStart(3, '0');
      useCases.push(buildUseCaseForRole(hi, role, clientInfo, workflows, ucId));
      ucNum++;
    }
  });
  return useCases;
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

        // Generate use cases from the researched profile data
        var useCases = generateUseCases(profileData);
        profileData.useCases = useCases;
        console.log('Generated', useCases.length, 'use cases');

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

  // ── POST /save-profile-usecases ────────────────────────────────────────────
  // Merges generated use cases into the research profile JSON (data.useCases).
  // Body: { profileId: string, useCases: array }
  if (req.method === 'POST' && req.url === '/save-profile-usecases') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var payload = JSON.parse(body);
        if (!payload.profileId) throw new Error('Missing profileId');

        // Find the profile file that has data (research profile, not config-only)
        var files = fs.readdirSync(PROFILES_DIR).filter(function(f) { return f.endsWith('.json'); });
        var targetPath = null;
        for (var i = 0; i < files.length; i++) {
          try {
            var p = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, files[i]), 'utf8'));
            if (p.data && p.id === payload.profileId) { targetPath = path.join(PROFILES_DIR, files[i]); break; }
          } catch(e) {}
        }
        // If exact match not found by ID, search by name prefix (config id → find data file)
        if (!targetPath && payload.companyName) {
          var searchName = payload.companyName.toLowerCase();
          for (var j = 0; j < files.length; j++) {
            try {
              var p2 = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, files[j]), 'utf8'));
              if (p2.data && p2.name && p2.name.toLowerCase() === searchName) {
                targetPath = path.join(PROFILES_DIR, files[j]); break;
              }
            } catch(e) {}
          }
        }

        if (!targetPath) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, reason: 'profile not found' }));
          return;
        }

        var existing = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        existing.data.useCases = payload.useCases || [];
        existing.timestamp = new Date().toISOString();
        fs.writeFileSync(targetPath, JSON.stringify(existing, null, 2), 'utf8');
        console.log('Use cases saved to', targetPath);

        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        console.error('Save use cases error:', e.message);
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
