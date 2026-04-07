# AI Fluency Toolkit

A multi-company training platform for Microsoft 365 Copilot adoption workshops. Trainers can set up a branded experience per company, and participants access module-based learning content through a password-protected portal.

---

## Getting Started

No installation or server required. All files are plain HTML — just open them in a browser.

**To launch the platform:**
1. Open `index.html` in your browser — this is the login page
2. Enter the company password set in the admin panel
3. You'll be taken to the company's branded **Main Page**

---

## Admin Setup (Trainers)

Open `admin.html` to manage companies and branding.

### Adding a Company
1. Click **+ New Company** in the left panel
2. Fill in the company name, website, and a password for participants
3. Upload a company logo (optional)
4. Set brand colors:
   - **Brand Color** — used for headers, buttons, links, and module nav
   - **Highlight Color** — used for badges, tags, and secondary accents
   - **Sidebar Background** — used for the left sidebar and dark header bar
5. The **Live Preview** on the right updates in real time showing all pages
6. Click **Save Company**

### Switching Between Companies
Click any company name in the left sidebar to load and edit it.

---

## Pages

| File | Description |
|------|-------------|
| `index.html` | Login page — participants enter their company password here |
| `Main page.html` | Home dashboard with module cards and navigation |
| `Module 1.html` | Module 1 content |
| `Module 2.html` | Module 2 content |
| `Module 3.html` | Module 3 content |
| `Module 4.html` | Module 4 content |
| `Copilot Value.html` | Copilot value explorer |
| `Value.html` | Value use case library |
| `profile explorer.html` | Company profile and use case explorer |
| `hands-on-lab-clone.html` | Hands-on lab exercises |
| `admin.html` | Admin panel for trainers |

---

## Branding

Each company gets its own colors and logo applied across all pages automatically. Brand settings are saved in the browser's `localStorage` under the key `companies`.

To share a branded setup with another device, use the **Export / Import** options in the admin panel (if available), or manually copy the `localStorage` data.

---

## Logos

Place company logo images in the `LOGO/` folder. Logos can also be uploaded directly via the admin panel (stored as base64 data URLs in localStorage).

---

## Notes

- All data is stored locally in the browser — there is no backend or database
- Each participant device needs to have the company set up, or the trainer shares a pre-configured browser profile
- Passwords are not encrypted — this is intended for workshop use only, not for sensitive data
