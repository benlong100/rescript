/**
 * Offline smoke test for a packaged air-gapped build.
 *
 *   npm run test:e2e-offline            # uses dist/mac-arm64/Rescript.app
 *   npm run test:e2e-offline -- <app> <wav>
 *
 * Why this exists: the obvious way to "verify offline" is to turn off wifi and
 * transcribe something. That is not a valid test on a machine that has ever run
 * a build which downloaded models from the Hub, because Cache Storage keeps
 * them and the app never touches the bundled copies at all. This harness runs
 * against a *clean* Electron profile, which is the condition that actually
 * matters, and it caught the `cache.put` scheme failure that a wifi-off test
 * had passed.
 *
 * It serves the packaged asar exactly the way electron/main.ts does, hands the
 * app a WAV through its real file input via CDP, and waits for rendered words.
 * Exit 0 = transcribed, 2 = timed out (console errors are printed).
 */
import { app, protocol, net, BrowserWindow } from "electron";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const APP = process.argv[2] || join(HERE, "..", "dist", "mac-arm64", "Rescript.app");
const WAV = process.argv[3] || join(HERE, "..", "dist", "e2e-speech.wav");
const ROOT = join(APP, "Contents/Resources/app.asar", "out");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".onnx": "application/octet-stream",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

app.whenReady().then(async () => {
  protocol.handle("app", async (req) => {
    const { pathname } = new URL(req.url);
    let p = decodeURIComponent(pathname);
    if (p === "/" || p === "") p = "/index.html";
    let fp = join(ROOT, normalize(p.replace(/^\/+/, "")));
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, "index.html");
    if (!existsSync(fp) || !statSync(fp).isFile()) return new Response("nf", { status: 404 });
    const res = await net.fetch(pathToFileURL(fp).toString());
    const h = new Headers(res.headers);
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Embedder-Policy", "require-corp");
    h.set("Cache-Control", "no-store");
    const t = MIME[extname(fp).toLowerCase()];
    if (t) h.set("Content-Type", t);
    return new Response(res.body, { status: res.status, headers: h });
  });

  const win = new BrowserWindow({ width: 1280, height: 900, show: true });
  const logs = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (/error|fail|unable|unsupported|cannot|throw/i.test(message)) logs.push(`[${level}] ${message}`);
  });

  await win.loadURL("app://localhost/");
  await new Promise((r) => setTimeout(r, 2500));

  // Hand the WAV to the real hidden file input via CDP.
  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("DOM.enable");
  const { root } = await dbg.sendCommand("DOM.getDocument", { depth: -1 });
  const { nodeId } = await dbg.sendCommand("DOM.querySelector", {
    nodeId: root.nodeId, selector: 'input[type="file"]',
  });
  if (!nodeId) { console.log("RESULT: no file input found"); return app.exit(1); }
  await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [WAV] });
  console.log("RESULT: wav handed to the app, waiting for a transcript…");

  // Poll for rendered words, reporting the progress label as it changes.
  let last = "";
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const state = await win.webContents.executeJavaScript(`(() => {
      const words = [...document.querySelectorAll('[data-wid]')].map(e => e.textContent.trim());
      const body = document.body.innerText || '';
      const label = (body.match(/(Downloading[^\\n]*|Loading[^\\n]*|Transcribing[^\\n]*|Preparing[^\\n]*|error[^\\n]*|Error[^\\n]*)/) || [''])[0];
      return JSON.stringify({ n: words.length, text: words.join(' ').slice(0, 160), label });
    })()`).catch((e) => JSON.stringify({ n: 0, text: "", label: "eval: " + e.message }));
    const st = JSON.parse(state);
    if (st.label && st.label !== last) { console.log(`  [${i * 2}s] ${st.label}`); last = st.label; }
    if (st.n > 0) {
      console.log(`RESULT: TRANSCRIBED ${st.n} words after ~${i * 2}s`);
      console.log(`RESULT: "${st.text}"`);
      if (logs.length) console.log("console errors:\n" + logs.slice(0, 8).join("\n"));
      const marked = await checkHighlighting(win);
      const saved = await checkSaveProject(win);
      return app.exit(marked && saved ? 0 : 3);
    }
  }
  console.log("RESULT: TIMED OUT with no transcript");
  console.log("console errors:\n" + (logs.slice(0, 12).join("\n") || "(none captured)"));
  app.exit(2);
});

/**
 * Click the toolbar's Save button and confirm a real `.rescript` file lands on
 * disk with both of its parts. Catches a broken button or a mis-wired download
 * that unit tests on the format cannot see.
 */
async function checkSaveProject(win) {
  const dest = join(tmpdir(), `rescript-e2e-${Date.now()}.rescript`);
  const done = new Promise((resolve) => {
    win.webContents.session.once("will-download", (_e, item) => {
      item.setSavePath(dest);
      item.once("done", (_ev, state) => resolve(state));
    });
    setTimeout(() => resolve("timeout"), 30000);
  });

  const clicked = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('button[title="Save project"]');
    if (!b) return 'no-button';
    if (b.disabled) return 'disabled';
    b.click();
    return 'clicked';
  })()`);
  if (clicked !== "clicked") {
    console.log(`RESULT: save button ${clicked}`);
    return false;
  }

  const state = await done;
  if (state !== "completed") {
    console.log(`RESULT: project download ${state}`);
    return false;
  }

  const size = statSync(dest).size;
  const listing = execFileSync("unzip", ["-l", dest], { encoding: "utf8" });
  const hasManifest = /\bproject\.json\b/.test(listing);
  const hasMedia = /\bmedia\//.test(listing);
  console.log(
    `RESULT: SAVED ${(size / 1024).toFixed(0)}KB project.json=${hasManifest} media=${hasMedia}`
  );
  if (!hasManifest || !hasMedia) {
    unlinkSync(dest);
    return false;
  }

  const reopened = await checkOpenProject(win, dest);
  unlinkSync(dest);
  return reopened;
}

/**
 * Reload to a clean upload screen, hand the saved file to the project input,
 * and confirm the transcript comes back without re-transcribing.
 */
async function checkOpenProject(win, file) {
  await win.webContents.reload();
  await new Promise((r) => setTimeout(r, 3000));

  const before = await win.webContents.executeJavaScript(
    "document.querySelectorAll('[data-wid]').length"
  );
  if (before > 0) {
    // Words already on screen would make the next check meaningless.
    console.log(`RESULT: expected an empty screen after reload, saw ${before} words`);
    return false;
  }

  const dbg = win.webContents.debugger;
  await dbg.sendCommand("DOM.enable");
  const { root } = await dbg.sendCommand("DOM.getDocument", { depth: -1 });
  const { nodeId } = await dbg.sendCommand("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[accept*=".rescript"]',
  });
  if (!nodeId) {
    console.log("RESULT: no project file input on the upload screen");
    return false;
  }
  await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [file] });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = JSON.parse(
      await win.webContents.executeJavaScript(`(() => {
        const w = [...document.querySelectorAll('[data-wid]')].map(e => e.textContent.trim());
        return JSON.stringify({ n: w.length, text: w.join(' ').slice(0, 120) });
      })()`)
    );
    if (st.n > 0) {
      console.log(`RESULT: REOPENED ${st.n} words after ~${i}s`);
      console.log(`RESULT: "${st.text}"`);
      return true;
    }
  }
  console.log("RESULT: reopening the project produced no transcript");
  return false;
}

/**
 * Drive the highlight interaction: click a word, press Highlight on the
 * floating toolbar, and confirm the word is marked and the Tools menu offers
 * the unhighlighted actions. Unit tests cover the logic; only this covers the
 * wiring from button to store to rendered class.
 */
async function checkHighlighting(win) {
  const marked = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const word = document.querySelector('[data-wid]');
    if (!word) return 'no-word';
    word.click();
    await sleep(400);

    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Highlight'
    );
    if (!button) return 'no-highlight-button';
    button.click();
    await sleep(400);

    const count = document.querySelectorAll('[data-highlighted]').length;
    if (count === 0) return 'nothing-marked';

    // The Tools menu should now offer the unhighlighted actions.
    const tools = [...document.querySelectorAll('button')].find(
      (b) =>
        (b.getAttribute('title') || '').includes('Bulk transcript') ||
        b.textContent.trim() === 'Tools'
    );
    if (!tools) return 'marked:' + count + ' but no tools trigger';
    tools.click();
    await sleep(400);
    const labels = [...document.querySelectorAll('button')]
      .map((b) => b.textContent.trim())
      .filter((t) => t.includes('unhighlighted'));
    return 'marked:' + count + ' tools:[' + labels.join(' | ') + ']';
  })()`);

  console.log(`RESULT: HIGHLIGHT ${marked}`);
  return (
    typeof marked === "string" &&
    marked.startsWith("marked:") &&
    marked.includes("Remove unhighlighted")
  );
}
