/* ============================================================
   SCRIPTS.JS — Shared Design System JavaScript
   Used by all module pages (Module 1–4) and other pages.
   ============================================================ */

(function () {

    // ============================================================
    // SECTION TOGGLE
    // Called via onclick="toggleSection(this)" on .section-header
    // ============================================================
    window.toggleSection = function (header) {
        const section = header.closest('.section');
        if (!section) return;
        section.classList.toggle('collapsed');

        // Update Collapse All / Expand All button label
        updateToggleAllBtn();
    };

    // ============================================================
    // CONTENT-BOX TOGGLE
    // Called via onclick="toggleContentBox(this)" on .content-box-header
    // ============================================================
    window.toggleContentBox = function (header) {
        const box = header.closest('.content-box');
        if (!box) return;
        box.classList.toggle('collapsed');
    };

    // ============================================================
    // TOGGLE ALL SECTIONS
    // ============================================================
    function updateToggleAllBtn() {
        const btn = document.getElementById('toggleAllBtn');
        if (!btn) return;
        const sections = document.querySelectorAll('.section');
        const allCollapsed = Array.from(sections).every(s => s.classList.contains('collapsed'));
        btn.textContent = allCollapsed ? 'Expand All' : 'Collapse All';
    }

    function initToggleAllBtn() {
        const btn = document.getElementById('toggleAllBtn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            const sections = document.querySelectorAll('.section');
            const allCollapsed = Array.from(sections).every(s => s.classList.contains('collapsed'));
            sections.forEach(s => {
                if (allCollapsed) {
                    s.classList.remove('collapsed');
                } else {
                    s.classList.add('collapsed');
                }
            });
            updateToggleAllBtn();
        });
    }

    // ============================================================
    // SIDEBAR — Mobile Toggle
    // ============================================================
    function initSidebarToggle() {
        const toggleBtn = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        if (!toggleBtn || !sidebar) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99;';
        document.body.appendChild(overlay);

        toggleBtn.addEventListener('click', function () {
            sidebar.classList.toggle('open');
            overlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
        });

        overlay.addEventListener('click', function () {
            sidebar.classList.remove('open');
            overlay.style.display = 'none';
        });
    }

    // ============================================================
    // SIDEBAR — Desktop Collapse
    // ============================================================
    function initSidebarCollapse() {
        const collapseBtn = document.querySelector('.sidebar-collapse-btn');
        const sidebar = document.getElementById('sidebar');
        if (!collapseBtn || !sidebar) return;

        collapseBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            sidebar.classList.toggle('sidebar-collapsed');
        });
    }

    // ============================================================
    // NAV MENU — Smooth scroll + active link tracking
    // ============================================================
    function initNavMenu() {
        const navLinks = document.querySelectorAll('.nav-menu a[href^="#"]');
        if (!navLinks.length) return;

        // Smooth scroll on click
        navLinks.forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(link.getAttribute('href'));
                if (!target) return;

                // Expand section if collapsed
                if (target.classList.contains('section') && target.classList.contains('collapsed')) {
                    target.classList.remove('collapsed');
                    updateToggleAllBtn();
                }

                target.scrollIntoView({ behavior: 'smooth', block: 'start' });

                // Update active state
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            });
        });

        // Scroll spy
        window.addEventListener('scroll', function () {
            const sections = document.querySelectorAll('.section[id]');
            let current = '';
            sections.forEach(function (section) {
                const rect = section.getBoundingClientRect();
                if (rect.top <= 120) current = section.id;
            });
            navLinks.forEach(function (link) {
                link.classList.remove('active');
                if (link.getAttribute('href') === '#' + current) {
                    link.classList.add('active');
                }
            });
        }, { passive: true });
    }

    // ============================================================
    // SEARCH BOX
    // ============================================================
    function initSearch() {
        const searchBox = document.getElementById('searchBox');
        const noResults = document.getElementById('noResults');
        if (!searchBox) return;

        searchBox.addEventListener('input', function () {
            const query = searchBox.value.trim().toLowerCase();
            const sections = document.querySelectorAll('.section');
            let anyVisible = false;

            if (!query) {
                sections.forEach(s => s.style.display = '');
                if (noResults) noResults.classList.add('hidden');
                return;
            }

            sections.forEach(function (section) {
                const text = section.textContent.toLowerCase();
                const match = text.includes(query);
                section.style.display = match ? '' : 'none';
                if (match) {
                    anyVisible = true;
                    section.classList.remove('collapsed');
                }
            });

            if (noResults) {
                noResults.classList.toggle('hidden', anyVisible);
            }
        });
    }

    // ============================================================
    // BACK TO TOP
    // ============================================================
    function initBackToTop() {
        const btn = document.getElementById('backToTop');
        if (!btn) return;

        window.addEventListener('scroll', function () {
            btn.classList.toggle('visible', window.scrollY > 400);
        }, { passive: true });

        btn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ============================================================
    // TOAST NOTIFICATION
    // ============================================================
    window.showToast = function (message) {
        message = message || 'Copied to clipboard!';
        let toast = document.getElementById('globalToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'globalToast';
            toast.style.cssText = [
                'position:fixed',
                'bottom:24px',
                'right:24px',
                'background:var(--color-primary,#1a73e8)',
                'color:white',
                'padding:12px 20px',
                'border-radius:8px',
                'font-size:0.9rem',
                'font-weight:500',
                'box-shadow:0 4px 16px rgba(0,0,0,0.2)',
                'z-index:9999',
                'opacity:0',
                'transform:translateY(10px)',
                'transition:opacity 0.2s,transform 0.2s',
                'pointer-events:none'
            ].join(';');
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        // Show
        requestAnimationFrame(function () {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        // Hide after 2s
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
        }, 2000);
    };

    // ============================================================
    // COPY PROMPT
    // Called via onclick="copyPrompt(this)" on copy buttons
    // ============================================================
    window.copyPrompt = function (btn) {
        const container = btn.closest('[data-prompt], .prompt-box, .try-prompt-box, .hero-prompt-box, .labeled-prompt, .bonus-prompt-box');
        if (!container) return;
        const text = container.textContent.replace(/copy/gi, '').trim();
        navigator.clipboard.writeText(text).then(function () {
            const original = btn.innerHTML;
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
            btn.classList.add('copied');
            showToast('Copied to clipboard!');
            setTimeout(function () {
                btn.innerHTML = original;
                btn.classList.remove('copied');
            }, 2000);
        }).catch(function () {
            showToast('Could not copy — please select and copy manually.');
        });
    };

    // ============================================================
    // SECTION ACCENT (visual left-border highlight on hover)
    // ============================================================
    function initSectionAccents() {
        document.querySelectorAll('.section-accent').forEach(function (accent) {
            // Already styled via CSS; no JS needed
        });
    }

    // ============================================================
    // INIT
    // ============================================================
    document.addEventListener('DOMContentLoaded', function () {
        initToggleAllBtn();
        initSidebarToggle();
        initSidebarCollapse();
        initNavMenu();
        initSearch();
        initBackToTop();
        initSectionAccents();
    });

})();
