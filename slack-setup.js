/**
 * Self-driving Slack app setup using Puppeteer + user's Chrome.
 * Opens Chrome with the user's existing session (likely logged into Slack),
 * creates the app from manifest, generates tokens, installs to workspace,
 * and returns all credentials — user only clicks "Allow" once.
 */

import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(__dirname, "slack-manifest.json");
const ICON_PATH = resolve(__dirname, "astronaut-icon.png");

// Create a tiny base64 icon for the browser banner
function getIconDataUrl() {
  try {
    const tmpIcon = resolve(__dirname, ".banner-icon-tmp.png");
    // Use sips (macOS) or convert to resize, fall back to full image
    try {
      execSync(`sips -z 48 48 "${ICON_PATH}" --out "${tmpIcon}" 2>/dev/null`, { stdio: "ignore" });
    } catch {
      try {
        execSync(`convert "${ICON_PATH}" -resize 48x48 "${tmpIcon}" 2>/dev/null`, { stdio: "ignore" });
      } catch {
        // Use original (will be larger but still works)
        return `data:image/png;base64,${readFileSync(ICON_PATH).toString("base64")}`;
      }
    }
    const data = `data:image/png;base64,${readFileSync(tmpIcon).toString("base64")}`;
    try { unlinkSync(tmpIcon); } catch {}
    return data;
  } catch {
    return null;
  }
}

// ─── Terminal Colors ────────────────────────────────────────────────
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const CHECK = green("✓");
const WARN = yellow("!");

// ─── Find Chrome ────────────────────────────────────────────────────
function findChrome() {
  const paths = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
    ],
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
  };

  const candidates = paths[process.platform] || [];
  for (const p of candidates) {
    try {
      execSync(`test -f "${p}"`, { stdio: "ignore" });
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Find Chrome User Data Dir ──────────────────────────────────────
function findChromeUserDataDir() {
  const home = homedir();
  const paths = {
    darwin: resolve(home, "Library/Application Support/Google/Chrome"),
    linux: resolve(home, ".config/google-chrome"),
    win32: resolve(home, "AppData/Local/Google/Chrome/User Data"),
  };
  const dir = paths[process.platform];
  if (dir) {
    try {
      execSync(`test -d "${dir}"`, { stdio: "ignore" });
      return dir;
    } catch {}
  }
  return null;
}

// ─── Helper: wait and click ─────────────────────────────────────────
async function waitAndClick(page, selector, options = {}) {
  const el = await page.waitForSelector(selector, { timeout: options.timeout || 15000 });
  if (options.delay) await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), options.delay);
  await el.click();
  return el;
}

async function waitForText(page, text, timeout = 30000) {
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout },
    text
  );
}

// ─── Main: Self-driving Slack setup ─────────────────────────────────
export default async function selfDrivingSlackSetup() {
  const chromePath = findChrome();
  if (!chromePath) return null;

  const manifest = readFileSync(MANIFEST_PATH, "utf-8");
  const manifestUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`;

  console.log(`\n    ${CHECK} Chrome found`);
  console.log(`    Opening Chrome — ${bold("watch the magic")} ✨\n`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath: chromePath,
      defaultViewport: null,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1100,900",
      ],
    });

    const page = (await browser.pages())[0] || await browser.newPage();

    // ── Visual cue: inject banner on every page load ──
    const iconDataUrl = getIconDataUrl();
    const iconHtml = iconDataUrl
      ? `<img src="${iconDataUrl}" style="width: 22px; height: 22px; border-radius: 5px;" />`
      : `<span style="font-size: 16px;">🤖</span>`;

    // Banner state: "auto" (purple, Astro Claw working) or "action" (amber, user needed)
    let bannerState = { mode: "auto", text: "Astro Claw is driving this browser", sub: "do not close" };

    const THEMES = {
      auto: { bg: "linear-gradient(135deg, #6C5CE7, #A855F7)", shadow: "rgba(108, 92, 231, 0.4)" },
      action: { bg: "linear-gradient(135deg, #F59E0B, #EF6C00)", shadow: "rgba(245, 158, 11, 0.4)" },
    };

    const buildBannerHtml = () => {
      const t = THEMES[bannerState.mode];
      return `
        <div id="astro-claw-banner" style="
          position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
          height: 38px; display: flex; align-items: center; justify-content: center; gap: 10px;
          background: ${t.bg};
          color: #fff; font: 600 13px/1 -apple-system, BlinkMacSystemFont, sans-serif;
          box-shadow: 0 2px 8px ${t.shadow};
          letter-spacing: 0.3px;
          transition: background 0.3s ease;
        ">
          ${iconHtml}
          <span id="astro-claw-text">${bannerState.text}</span>
          <span id="astro-claw-sub" style="opacity: 0.7; font-weight: 400; font-size: 11px; margin-left: 4px;">— ${bannerState.sub}</span>
        </div>`;
    };

    const injectBanner = async (p) => {
      try {
        await p.evaluate((html, state, themes) => {
          const existing = document.getElementById('astro-claw-banner');
          if (!existing) {
            document.body.insertAdjacentHTML('beforeend', html);
            if (!document.body.dataset.astroClaw) {
              document.body.style.paddingTop = (parseFloat(getComputedStyle(document.body).paddingTop) + 38) + 'px';
              document.body.dataset.astroClaw = '1';
            }
          } else {
            // Update existing banner
            const t = themes[state.mode];
            existing.style.background = t.bg;
            existing.style.boxShadow = `0 2px 8px ${t.shadow}`;
            const textEl = document.getElementById('astro-claw-text');
            const subEl = document.getElementById('astro-claw-sub');
            if (textEl) textEl.textContent = state.text;
            if (subEl) subEl.textContent = `— ${state.sub}`;
          }
        }, buildBannerHtml(), bannerState, THEMES);
      } catch {}
    };

    // Switch banner to "user action needed" mode
    const setBannerAction = async (text, sub = "your turn") => {
      bannerState = { mode: "action", text, sub };
      await injectBanner(page);
    };

    // Switch banner back to autonomous mode
    const setBannerAuto = async (text = "Astro Claw is driving this browser", sub = "do not close") => {
      bannerState = { mode: "auto", text, sub };
      await injectBanner(page);
    };

    // Inject banner after every navigation and periodically
    page.on('load', () => injectBanner(page));
    page.on('domcontentloaded', () => injectBanner(page));
    page.on('framenavigated', () => setTimeout(() => injectBanner(page), 500));
    const bannerInterval = setInterval(() => injectBanner(page), 2000);

    // ── Step 1: Sign in to Slack (single tab, no interruptions) ──
    console.log(`    → Checking Slack login...`);
    await page.goto("https://api.slack.com/apps", { waitUntil: "networkidle2", timeout: 30000 });

    // Check if user needs to sign in by looking at page content
    const needsLogin = await page.evaluate(() => {
      return document.body.innerText.includes("sign in to your Slack account") ||
             document.body.innerText.includes("You'll need to sign in");
    });

    if (needsLogin) {
      // Click the "sign in" link on the page to start the login flow in this same tab
      try {
        await page.evaluate(() => {
          const links = document.querySelectorAll("a");
          for (const link of links) {
            if (link.textContent.includes("sign in")) {
              link.click();
              return;
            }
          }
          // Fallback: navigate directly
          window.location.href = "https://slack.com/signin";
        });
      } catch {}

      await setBannerAction("Human action required: Sign in to your Slack workspace");
      console.log(`    → ${bold("Sign in to your Slack workspace")} in the browser`);
      console.log(`      ${dim("Take your time — the wizard continues automatically after you log in")}`);

      // Wait for sign-in to complete — detect by URL change away from sign-in pages
      await page.waitForFunction(
        () => {
          const url = window.location.href;
          return url.includes("/ssb/redirect") ||
                 url.includes("/client/") ||
                 url.includes("app.slack.com") ||
                 url.includes("api.slack.com/apps");
        },
        { timeout: 600000 } // 10 minutes
      );

      await setBannerAuto();
      console.log(`    ${CHECK} Signed in`);
      await new Promise((r) => setTimeout(r, 3000));
      // Auth cookies are set — now redirect to api.slack.com/apps
      await page.goto("https://api.slack.com/apps", { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      console.log(`    ${CHECK} Already signed in`);
    }

    // ── Step 2: Navigate to app creation with manifest (same tab) ──
    await page.goto(manifestUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // ── Step 3: Select workspace (always user's choice) ──
    await setBannerAction("Human action required: Select your workspace and click Next");
    console.log(`    → ${bold("Select your workspace")} in the browser and click ${bold("Next")}`);
    console.log(`      ${dim("Waiting for you to pick a workspace...")}`);

    // Wait for user to select workspace and advance past the picker
    // Detect by: modal disappearing, URL changing, or "Next" being clicked and new content loading
    await page.waitForFunction(
      () => {
        // Option 1: native <select> was changed from default
        const sel = document.querySelector("select");
        if (sel) {
          const val = sel.value;
          // Still on default — keep waiting
          if (!val || val === "" || val === "0" || sel.selectedOptions?.[0]?.textContent?.trim() === "Select a workspace") {
            return false;
          }
        }
        // Option 2: modal closed (no more "Pick a workspace" text visible in a dialog)
        const modal = document.querySelector('[role="dialog"], .c-dialog, .ReactModal__Content');
        if (!modal) return true;
        // Option 3: wizard advanced to manifest review (textarea or JSON visible)
        if (document.querySelector('textarea, pre.code, [data-qa="manifest"]')) return true;
        return false;
      },
      { timeout: 300000 }
    ).catch(() => {});

    // Give a moment for any transition after workspace selection
    await new Promise((r) => setTimeout(r, 2000));
    await setBannerAuto();
    console.log(`    ${CHECK} Workspace selected`);

    // Helper: check if we've landed on the app page (creation complete)
    const isOnAppPage = () => /api\.slack\.com\/apps\/[A-Z0-9]+(?:\/|$)/.test(page.url());

    // Click through the wizard steps — Slack may have 2 or 3 steps
    // After each click, check if the app was already created
    console.log(`    → Walking through wizard...`);
    for (let step = 0; step < 3; step++) {
      if (isOnAppPage()) break;

      // Look for the primary action button (Next or Create)
      const btn = await page.$('button.c-button--primary')
        || await page.$('button[data-qa="next"]')
        || await page.$('button[type="submit"]');

      if (btn) {
        const btnText = await page.evaluate((el) => el.textContent?.trim(), btn);
        if (btnText === "Create" || btnText === "Create App") {
          console.log(`    → Creating app...`);
        } else {
          console.log(`    → ${btnText || "Next"}...`);
        }
        await btn.click();
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        break;
      }
    }

    // Wait for redirect to app page
    if (!isOnAppPage()) {
      await page.waitForFunction(
        () => /api\.slack\.com\/apps\/[A-Z0-9]+/.test(window.location.href),
        { timeout: 30000 }
      ).catch(() => {});
    }

    const appUrl = page.url();
    const appIdMatch = appUrl.match(/apps\/([A-Z0-9]+)/);
    const appId = appIdMatch?.[1];

    if (appId) {
      console.log(`    ${CHECK} App created (${appId})`);
    } else {
      console.log(`    ${CHECK} App created`);
    }

    // ── Step 3: Extract Signing Secret ──
    console.log(`    → Extracting signing secret...`);
    const basicInfoUrl = appId ? `https://api.slack.com/apps/${appId}` : appUrl;
    await page.goto(basicInfoUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    let signingSecret = null;
    try {
      // Click all "Show" buttons to reveal hidden values
      const showButtons = await page.$$('button');
      for (const btn of showButtons) {
        const text = await page.evaluate((el) => el.textContent?.trim(), btn);
        if (text === "Show" || text === "show") {
          await btn.click();
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      signingSecret = await page.evaluate(() => {
        // Check all input fields for hex strings
        const inputs = document.querySelectorAll('input[type="text"], input[type="password"], input[readonly]');
        for (const input of inputs) {
          const val = input.value;
          if (/^[0-9a-f]{20,}$/i.test(val)) return val;
        }
        // Search page text near "Signing Secret" label
        const allText = document.body.innerText;
        const sigIdx = allText.indexOf("Signing Secret");
        if (sigIdx !== -1) {
          const after = allText.substring(sigIdx, sigIdx + 200);
          const match = after.match(/[0-9a-f]{25,}/i);
          if (match) return match[0];
        }
        // Broader search for hex strings in the page
        const els = document.querySelectorAll('span, code, pre, div, p');
        for (const el of els) {
          const text = el.textContent?.trim();
          if (text && /^[0-9a-f]{25,}$/i.test(text)) return text;
        }
        return null;
      });

      if (signingSecret) {
        console.log(`    ${CHECK} Signing secret captured`);
      } else {
        console.log(`    ${WARN} Could not auto-extract signing secret`);
      }
    } catch {
      console.log(`    ${WARN} Could not auto-extract signing secret`);
    }

    // ── Step 4: Generate App-Level Token ──
    console.log(`    → Generating app-level token...`);
    let appToken = null;
    try {
      // Scroll to App-Level Tokens section and click Generate
      await page.evaluate(() => {
        const headings = document.querySelectorAll('h4, h5, h3, span');
        for (const h of headings) {
          if (h.textContent?.includes("App-Level Tokens")) {
            h.scrollIntoView({ behavior: "smooth" });
            break;
          }
        }
      });
      await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 1000);

      // Click "Generate Token and Scopes" button
      const generateBtns = await page.$$('button');
      for (const btn of generateBtns) {
        const text = await page.evaluate((el) => el.textContent?.trim(), btn);
        if (text?.includes("Generate") && text?.includes("Token")) {
          await btn.click();
          await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 2000);
          break;
        }
      }

      // Fill in token name in the modal
      const nameInput = await page.waitForSelector('input[placeholder*="token"]', { timeout: 5000 }).catch(() => null)
        || await page.waitForSelector('.c-input_text input', { timeout: 3000 }).catch(() => null)
        || await page.waitForSelector('input[type="text"]', { timeout: 3000 }).catch(() => null);

      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type("astro-claw-socket");
        await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 500);
      }

      // Add scope: connections:write
      // Look for "Add Scope" button or scope dropdown
      const addScopeBtn = await page.$$('button');
      for (const btn of addScopeBtn) {
        const text = await page.evaluate((el) => el.textContent?.trim(), btn);
        if (text?.includes("Add Scope") || text?.includes("Add scope")) {
          await btn.click();
          await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 1000);
          break;
        }
      }

      // Select connections:write from dropdown
      const scopeOptions = await page.$$('option, [role="option"], li');
      for (const opt of scopeOptions) {
        const text = await page.evaluate((el) => el.textContent, opt);
        if (text?.includes("connections:write")) {
          await opt.click();
          await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 500);
          break;
        }
      }

      // Click Generate
      const genBtns = await page.$$('button');
      for (const btn of genBtns) {
        const text = await page.evaluate((el) => el.textContent?.trim(), btn);
        if (text === "Generate" || text === "Done") {
          await btn.click();
          await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 2000);
          break;
        }
      }

      // Extract the token (xapp-...)
      appToken = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="text"], input[readonly]');
        for (const input of inputs) {
          if (input.value?.startsWith("xapp-")) return input.value;
        }
        // Check text content
        const els = document.querySelectorAll('span, code, pre, div');
        for (const el of els) {
          const text = el.textContent?.trim();
          if (text?.startsWith("xapp-") && text.length > 20) return text;
        }
        return null;
      });

      // Close modal if still open
      try {
        const closeBtns = await page.$$('button[aria-label="Close"], button.c-dialog__close');
        for (const btn of closeBtns) {
          await btn.click();
          break;
        }
      } catch {}

      if (appToken) {
        console.log(`    ${CHECK} App-level token generated`);
      } else {
        console.log(`    ${WARN} Could not auto-extract app token`);
      }
    } catch (err) {
      console.log(`    ${WARN} App-level token generation needs manual step`);
    }

    // ── Step 5: Install to workspace ──
    console.log(`    → Installing to workspace...`);
    let botToken = null;
    try {
      const installUrl = appId
        ? `https://api.slack.com/apps/${appId}/oauth`
        : `${appUrl}/oauth`;
      await page.goto(installUrl, { waitUntil: "networkidle2", timeout: 15000 });
      await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 1500);

      // Check if already installed (Bot Token visible)
      botToken = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="text"], input[readonly]');
        for (const input of inputs) {
          if (input.value?.startsWith("xoxb-")) return input.value;
        }
        return null;
      });

      if (!botToken) {
        // Click "Install to Workspace"
        const installBtns = await page.$$('a, button');
        for (const btn of installBtns) {
          const text = await page.evaluate((el) => el.textContent?.trim(), btn);
          if (text?.includes("Install to Workspace") || text?.includes("Reinstall") || text?.includes("Install App")) {
            await btn.click();
            break;
          }
        }

        // Wait for the OAuth consent page to load
        await new Promise((r) => setTimeout(r, 3000));

        // Now show the banner — user needs to click "Allow"
        await setBannerAction("Human action required: Click 'Allow' to install the app");
        console.log(`    ${WARN} ${bold("Click 'Allow' in the browser to install the app")}`);

        // Wait for redirect back to OAuth page (URL contains /oauth and app ID)
        // This only resolves AFTER the user clicks Allow and gets redirected
        await page.waitForFunction(
          (id) => {
            const url = window.location.href;
            return url.includes("/oauth") && url.includes(id);
          },
          { timeout: 300000 },  // 5 minutes for user to click Allow
          appId || ""
        ).catch(() => {});

        await setBannerAuto("Finishing up...", "almost there");
        await new Promise((r) => setTimeout(r, 2000));

        // If we're not back on the OAuth page, navigate there
        if (!page.url().includes("/oauth")) {
          await page.goto(installUrl, { waitUntil: "networkidle2", timeout: 30000 });
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Extract bot token
        botToken = await page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="text"], input[type="password"], input[readonly]');
          for (const input of inputs) {
            if (input.value?.startsWith("xoxb-")) return input.value;
          }
          // Check page text
          const match = document.body.innerText.match(/xoxb-[A-Za-z0-9-]+/);
          return match ? match[0] : null;
        });
      }

      if (botToken) {
        console.log(`    ${CHECK} Bot token captured`);
      } else {
        console.log(`    ${WARN} Could not auto-extract bot token`);
      }
    } catch {
      console.log(`    ${WARN} Installation needs manual step`);
    }

    // ── Clean up ──
    clearInterval(bannerInterval);
    await browser.close();

    // Return whatever we captured
    const result = { botToken, appToken, signingSecret };
    const captured = Object.values(result).filter(Boolean).length;

    if (captured === 3) {
      console.log(`\n    ${CHECK} ${bold("All 3 tokens captured automatically!")}\n`);
    } else if (captured > 0) {
      console.log(`\n    ${CHECK} Got ${captured}/3 tokens automatically. You'll paste the rest manually.\n`);
    }

    return result;
  } catch (err) {
    console.log(`    ${WARN} Browser automation error: ${err.message}`);
    clearInterval(bannerInterval);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

export { findChrome };
