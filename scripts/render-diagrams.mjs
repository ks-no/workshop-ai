import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const sourceDir = resolve(root, 'docs/diagrams');
const outputDir = resolve(root, 'public/diagrams');
const diagramIds = ['architecture', 'workflow', 'sequence', 'data-flow', 'lifecycle'];
const candidates = [
  process.env.MERMAID_JS_PATH,
  resolve(homedir(), '.agents/skills/ak-diagram/assets/mermaid.min.js'),
].filter(Boolean);

let mermaidPath;
for (const candidate of candidates) {
  try { await access(candidate); mermaidPath = candidate; break; } catch { /* try the next configured location */ }
}
if (!mermaidPath) throw new Error('Mermaid runtime not found. Set MERMAID_JS_PATH to a pinned mermaid.min.js file.');

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const id of diagramIds) {
    const sourcePath = resolve(sourceDir, `agentic-${id}.mmd`);
    const publicSourcePath = resolve(outputDir, `agentic-${id}.mmd`);
    const source = await readFile(sourcePath, 'utf8');
    await copyFile(sourcePath, publicSourcePath);

    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
    await page.setContent('<!doctype html><html><body><div id="frame"><div id="diagram"></div></div></body></html>');
    await page.addScriptTag({ path: mermaidPath });
    const svg = await page.evaluate(async ({ source, id }) => {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        flowchart: { htmlLabels: true, useMaxWidth: false, curve: 'basis' },
        sequence: { useMaxWidth: false, mirrorActors: true },
        themeVariables: {
          fontFamily: 'Arial, sans-serif',
          fontSize: '16px',
          primaryColor: '#edf3f7',
          primaryTextColor: '#162f3e',
          primaryBorderColor: '#365e76',
          lineColor: '#637c88',
          secondaryColor: '#e2f2ec',
          tertiaryColor: '#f7f9fa',
          clusterBkg: '#f7f9fa',
          clusterBorder: '#a7bbc4',
          edgeLabelBackground: '#e2f2ec',
        },
      });
      const rendered = await window.mermaid.render(`diagram-${id}`, source);
      document.querySelector('#diagram').innerHTML = rendered.svg;
      return rendered.svg;
    }, { source, id });
    await writeFile(resolve(outputDir, `agentic-${id}.svg`), svg);

    await page.evaluate(() => {
      const frame = document.querySelector('#frame');
      const diagram = document.querySelector('#diagram');
      const svgElement = diagram.querySelector('svg');
      const viewBox = svgElement.viewBox.baseVal;
      document.body.style.margin = '0';
      document.body.style.background = '#ffffff';
      frame.style.display = 'inline-block';
      frame.style.padding = '32px';
      frame.style.background = '#ffffff';
      diagram.style.width = `${viewBox.width}px`;
      diagram.style.height = `${viewBox.height}px`;
      svgElement.style.maxWidth = 'none';
      svgElement.setAttribute('width', String(viewBox.width));
      svgElement.setAttribute('height', String(viewBox.height));
    });
    await page.locator('#frame').screenshot({ path: resolve(outputDir, `agentic-${id}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}

