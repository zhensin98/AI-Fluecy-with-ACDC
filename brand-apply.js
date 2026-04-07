// brand-apply.js
// Reads the active company config from sessionStorage and applies brand colors
// to all CSS variables. Include this script in <head> of every page.

(function () {
  var config = null;
  try { config = JSON.parse(sessionStorage.getItem('active_company') || 'null'); } catch (e) {}

  // DEBUG BANNER — remove once confirmed working
  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.id = '__brand_debug';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px 12px;font:12px monospace;display:flex;gap:12px;align-items:center;';
    if (!config || !config.colors) {
      bar.style.background = '#e53e3e';
      bar.style.color = 'white';
      bar.innerHTML = '&#9888; brand-apply.js: No active_company in sessionStorage — log in first';
    } else {
      bar.style.background = config.colors.primary;
      bar.style.color = 'white';
      bar.innerHTML = '&#9989; Brand applied: <b>' + config.name + '</b> &nbsp;|&nbsp; primary: ' + config.colors.primary
        + ' &nbsp;<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' + config.colors.primary + ';border:1px solid rgba(255,255,255,0.5);vertical-align:middle;"></span>';
    }
    document.body.appendChild(bar);
  });

  if (!config || !config.colors) return;

  var c = config.colors;
  var root = document.documentElement;

  function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  var rgb  = hexToRgb(c.primary)  || { r: 35,  g: 84,  b: 91  };
  var rgba = hexToRgb(c.accent)   || { r: 26,  g: 115, b: 232 };
  var r = rgb.r,  g = rgb.g,  b = rgb.b;
  var ra = rgba.r, ga = rgba.g, ba = rgba.b;

  // ── Tier 1: Base brand ────────────────────────────────────────────
  root.style.setProperty('--brand-primary',      c.primary);
  root.style.setProperty('--brand-primary-dark', c.primaryDark);
  root.style.setProperty('--brand-primary-light',c.primaryLight);
  root.style.setProperty('--brand-secondary',    c.primaryDark);
  root.style.setProperty('--brand-accent',       c.accent);
  root.style.setProperty('--brand-sidebar-bg',   c.sidebarBg);

  // ── Tier 2: Derived ───────────────────────────────────────────────
  root.style.setProperty('--color-primary',       c.primary);
  root.style.setProperty('--color-primary-dark',  c.primaryDark);
  root.style.setProperty('--color-primary-light', 'rgba('+r+','+g+','+b+',0.08)');
  root.style.setProperty('--color-primary-muted', 'rgba('+r+','+g+','+b+',0.06)');
  root.style.setProperty('--color-primary-focus', 'rgba('+r+','+g+','+b+',0.20)');
  root.style.setProperty('--color-primary-pale',  'rgba('+r+','+g+','+b+',0.08)');
  root.style.setProperty('--color-accent',        c.accent);
  root.style.setProperty('--color-accent-dark',   c.primaryDark);
  root.style.setProperty('--color-accent-light',  'rgba('+ra+','+ga+','+ba+',0.10)');
  root.style.setProperty('--color-accent-muted',  'rgba('+ra+','+ga+','+ba+',0.05)');
  root.style.setProperty('--color-accent-border', 'rgba('+ra+','+ga+','+ba+',0.30)');
  root.style.setProperty('--color-subsection-bg', 'rgba('+r+','+g+','+b+',0.04)');
  root.style.setProperty('--color-nav-hover',     'rgba('+r+','+g+','+b+',0.12)');
  root.style.setProperty('--color-sidebar-bg',    c.sidebarBg);
  root.style.setProperty('--gradient-start',      c.primary);
  root.style.setProperty('--gradient-end',        c.primaryDark);

  // ── Tier 3: Status / info that inherits brand color ────────────────
  root.style.setProperty('--color-info',          c.primary);
  root.style.setProperty('--color-info-bg',       'rgba('+r+','+g+','+b+',0.08)');
  root.style.setProperty('--color-bg-highlight',  'rgba('+r+','+g+','+b+',0.06)');

  // ── Legacy aliases ────────────────────────────────────────────────
  root.style.setProperty('--primary-color',       c.primary);
  root.style.setProperty('--secondary-color',     c.primaryDark);
  root.style.setProperty('--accent-color',        c.accent);
  root.style.setProperty('--info-box-bg',         'rgba('+r+','+g+','+b+',0.08)');

  // ── Company name & logo (for pages that display them) ─────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Logo: replace any element with data-company-logo attribute
    if (config.logoDataUrl) {
      var logos = document.querySelectorAll('[data-company-logo]');
      logos.forEach(function (el) { el.src = config.logoDataUrl; });
    }
    // Company name: replace any element with data-company-name attribute
    if (config.name) {
      var names = document.querySelectorAll('[data-company-name]');
      names.forEach(function (el) { el.textContent = config.name; });
    }
  });
})();
