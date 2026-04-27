# AI Fluency Toolkit

A multi-company training platform for Claude AI Fluency workshops. Trainers can set up a branded experience per company, and participants access module-based learning content through a password-protected portal.

---

## Sharing a Demo (Quick Start)

1. **Copy this entire folder** to a USB drive or shared location and send it to your colleague.
2. Your colleague installs **Node.js** from [nodejs.org](https://nodejs.org) (one-time, free).
3. They **double-click `start.bat`** — this starts the server and opens the demo guide.
4. The demo guide shows all available companies with passwords and a **Launch Demo** button.

### Demo companies included

| Company | Password | Theme |
|---|---|---|
| Yara International | `Yara2026` | Navy blue |
| Chanel | `Chanel2026` | Black & white |
| Liberty Mutual | `liberty2026` | Yellow |

---

## Getting Started

### 1. Start the local server (required)

The platform uses a local Node.js server for features like extracting brand colors from a company website and saving profile data.

> **Node.js must be installed.** Download it from [nodejs.org](https://nodejs.org) if you don't have it.

Open a terminal in the project folder and run:

```bash
node color-server.js
```

Leave this terminal running in the background. The server runs on port `3001` and requires no `npm install` — it uses only built-in Node.js modules.

### 2. Open the platform

Open `index.html` in your browser — this is the login page. Enter the company password set in the admin panel and you'll be taken to the company's branded **Main Page**.

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
