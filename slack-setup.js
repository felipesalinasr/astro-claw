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

    // ── Helper: extract token-like strings from page ──
    const extractFromPage = async (prefix) => {
      return page.evaluate((pfx) => {
        // Check all inputs (text, password, hidden, readonly)
        for (const input of document.querySelectorAll('input')) {
          if (input.value?.startsWith(pfx)) return input.value;
        }
        // Check all text nodes
        const regex = new RegExp(pfx + '[A-Za-z0-9_-]{10,}');
        const match = document.body.innerText.match(regex);
        return match ? match[0] : null;
      }, prefix);
    };

    // ── Helper: click button by text (partial match, case-insensitive) ──
    const clickButton = async (textMatch, waitMs = 1500) => {
      const buttons = await page.$$('button, a[role="button"], a.c-button');
      for (const btn of buttons) {
        const text = await page.evaluate((el) => el.textContent?.trim(), btn);
        if (text && text.toLowerCase().includes(textMatch.toLowerCase())) {
          await btn.click();
          await new Promise((r) => setTimeout(r, waitMs));
          return true;
        }
      }
      return false;
    };

    // ── Step 3: Extract Signing Secret ──
    console.log(`    → Extracting signing secret...`);
    await setBannerAuto("Extracting signing secret...", "working");
    const basicInfoUrl = appId ? `https://api.slack.com/apps/${appId}` : appUrl;
    await page.goto(basicInfoUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));

    let signingSecret = null;
    try {
      // Click every "Show" button on the page to reveal hidden values
      let showClicked = true;
      while (showClicked) {
        showClicked = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button, a')];
          for (const btn of btns) {
            const t = btn.textContent?.trim().toLowerCase();
            if (t === 'show') { btn.click(); return true; }
          }
          return false;
        });
        if (showClicked) await new Promise((r) => setTimeout(r, 1000));
      }

      await new Promise((r) => setTimeout(r, 1000));

      // Try to find the signing secret
      signingSecret = await page.evaluate(() => {
        // Strategy 1: find all inputs and look for 32-char hex
        for (const input of document.querySelectorAll('input')) {
          const val = input.value;
          if (/^[0-9a-f]{20,}$/i.test(val)) return val;
        }
        // Strategy 2: find text near "Signing Secret" heading
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let foundLabel = false;
        while (walker.nextNode()) {
          const text = walker.currentNode.textContent.trim();
          if (text.includes("Signing Secret")) { foundLabel = true; continue; }
          if (foundLabel && /^[0-9a-f]{25,}$/i.test(text)) return text;
          if (foundLabel && text.length > 100) foundLabel = false; // moved too far
        }
        // Strategy 3: regex the whole page
        const allText = document.body.innerText;
        const section = allText.split("Signing Secret")[1];
        if (section) {
          const match = section.substring(0, 300).match(/[0-9a-f]{25,}/i);
          if (match) return match[0];
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
    await setBannerAuto("Generating app-level token...", "working");
    let appToken = null;
    try {
      // Make sure we're on the basic info page
      if (!page.url().includes(appId)) {
        await page.goto(basicInfoUrl, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Scroll to and click "Generate Token and Scopes"
      await page.evaluate(() => {
        const els = document.querySelectorAll('button, a');
        for (const el of els) {
          if (el.textContent?.includes("Generate") && el.textContent?.includes("Token")) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
        }
      });
      await new Promise((r) => setTimeout(r, 1000));
      await clickButton("Generate Token", 2500);

      // Wait for modal to appear
      const modalInput = await page.waitForSelector(
        'input[type="text"]:not([readonly])',
        { timeout: 5000, visible: true }
      ).catch(() => null);

      if (modalInput) {
        // Clear and type token name
        await modalInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await modalInput.type("astro-claw-socket");
        await new Promise((r) => setTimeout(r, 500));

        // Add scope — click the scope dropdown/button
        await clickButton("Add Scope", 1000) || await clickButton("add scope", 1000);

        // Select connections:write
        await new Promise((r) => setTimeout(r, 500));
        const scopeSelected = await page.evaluate(() => {
          const items = document.querySelectorAll('option, [role="option"], [role="menuitem"], li');
          for (const item of items) {
            if (item.textContent?.includes("connections:write")) {
              item.click();
              // Also try selecting via native select
              if (item.tagName === 'OPTION') {
                item.selected = true;
                item.closest('select')?.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return true;
            }
          }
          return false;
        });
        await new Promise((r) => setTimeout(r, 1000));

        // Click Generate button in the modal
        await clickButton("Generate", 3000);
      }

      // Try to extract the token
      appToken = await extractFromPage("xapp-");

      // If not found, wait a bit more and try again
      if (!appToken) {
        await new Promise((r) => setTimeout(r, 2000));
        appToken = await extractFromPage("xapp-");
      }

      // Close any open modal
      try {
        await page.evaluate(() => {
          const close = document.querySelector('button[aria-label="Close"], button[aria-label="close"], .c-dialog__close, [data-qa="close"]');
          if (close) close.click();
        });
      } catch {}

      if (appToken) {
        console.log(`    ${CHECK} App-level token generated`);
      } else {
        console.log(`    ${WARN} Could not auto-extract app token`);
      }
    } catch (err) {
      console.log(`    ${WARN} App-level token generation needs manual step`);
    }

    // ── Step 5: Install to workspace & get bot token ──
    console.log(`    → Installing to workspace...`);
    await setBannerAuto("Installing to workspace...", "working");
    let botToken = null;
    try {
      const installUrl = appId
        ? `https://api.slack.com/apps/${appId}/install-on-team`
        : `${appUrl}/install-on-team`;
      const oauthUrl = appId
        ? `https://api.slack.com/apps/${appId}/oauth`
        : `${appUrl}/oauth`;

      // Go to Install page first
      await page.goto(installUrl, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2000));

      // Check if already installed — try OAuth page for token
      botToken = await extractFromPage("xoxb-");

      if (!botToken) {
        // Click install button (could be link or button)
        const installed = await page.evaluate(() => {
          const els = document.querySelectorAll('a, button');
          for (const el of els) {
            const text = el.textContent?.trim();
            if (text?.includes("Install to Workspace") || text?.includes("Reinstall") || text?.includes("Install App")) {
              el.click();
              return true;
            }
          }
          // Also try: direct link might already be the install action
          return false;
        });

        if (installed) {
          // Wait for the consent page to load
          await new Promise((r) => setTimeout(r, 3000));
        }

        // Check if we're on the consent page (has "Allow" button)
        const hasAllow = await page.evaluate(() => {
          return !!document.querySelector('button[data-qa="oauth_submit_button"]') ||
                 document.body.innerText.includes("is requesting permission");
        }).catch(() => false);

        if (hasAllow) {
          await setBannerAction("Human action required: Click 'Allow' to install the app");
          console.log(`    ${WARN} ${bold("Click 'Allow' in the browser to install the app")}`);

          // Wait for user to click Allow — page will redirect
          await page.waitForFunction(
            () => !document.body.innerText.includes("is requesting permission"),
            { timeout: 300000 }
          ).catch(() => {});

          await setBannerAuto("Finishing up...", "almost there");
          await new Promise((r) => setTimeout(r, 3000));
        }

        // Navigate to OAuth page to get the bot token
        await page.goto(oauthUrl, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 2000));

        // Click Show buttons to reveal tokens
        await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button, a')];
          for (const btn of btns) {
            if (btn.textContent?.trim().toLowerCase() === 'show') btn.click();
          }
        });
        await new Promise((r) => setTimeout(r, 1000));

        botToken = await extractFromPage("xoxb-");
      }

      if (botToken) {
        console.log(`    ${CHECK} Bot token captured`);
      } else {
        console.log(`    ${WARN} Could not auto-extract bot token`);
      }
    } catch (err) {
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
