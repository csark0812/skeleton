#!/usr/bin/env bun
/**
 * Render README charts from agent-suites/evidence/SUMMARY.json.
 *
 * Usage:
 *   bun scripts/agent-evidence/render-charts.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface ScenarioRow {
	n: number;
	cleanPassRate: number;
	messyPassRate: number;
	medianTokenDelta: number;
}

interface Summary {
	nRuns: number;
	scenarios: Record<string, ScenarioRow>;
	overall: {
		groundingMedianTokenDelta: number;
	};
}

const SCENARIOS: { key: string; label: string }[] = [
	{ key: "grounding: conflicting docs", label: "Conflicting docs" },
	{ key: "routing: docs-only change", label: "Docs routing" },
	{ key: "grounding: canonical topic", label: "Canonical topic" },
	{ key: "routing: owned skill body", label: "Owned skill" },
	{ key: "customize: project binding", label: "Customize" },
];

const CLEAN = "#2563eb";
const MESSY = "#ea580c";
const AXIS = "#64748b";
const GRID = "#e2e8f0";
const LABEL = "#0f172a";
const FONT = "ui-sans-serif, system-ui, sans-serif";

function esc(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function r(n: number): number {
	return Math.round(n * 100) / 100;
}

function passRateChart(summary: Summary): string {
	const width = 720;
	const rowH = 56;
	const margin = { top: 72, right: 72, bottom: 48, left: 148 };
	const height = margin.top + margin.bottom + SCENARIOS.length * rowH;
	const plotW = width - margin.left - margin.right;
	const barH = 16;
	const pairGap = 4;

	const rows = SCENARIOS.map((s, i) => {
		const row = summary.scenarios[s.key];
		if (!row) throw new Error(`Missing scenario in SUMMARY.json: ${s.key}`);
		const y0 = margin.top + i * rowH + 10;
		const cleanW = r(row.cleanPassRate * plotW);
		const messyW = r(row.messyPassRate * plotW);
		const cleanPct = `${Math.round(row.cleanPassRate * 100)}%`;
		const messyPct = `${Math.round(row.messyPassRate * 100)}%`;
		const cleanLabelX = cleanW < 40 ? r(margin.left + cleanW + 8) : r(margin.left + cleanW - 8);
		const messyLabelX = messyW < 40 ? r(margin.left + messyW + 8) : r(margin.left + messyW - 8);
		const cleanAnchor = cleanW < 40 ? "start" : "end";
		const messyAnchor = messyW < 40 ? "start" : "end";
		const cleanFill = cleanW < 40 ? CLEAN : "#ffffff";
		const messyFill = messyW < 40 ? MESSY : "#ffffff";

		return `
  <text x="${margin.left - 12}" y="${y0 + barH + 4}" text-anchor="end" fill="${LABEL}" font-size="13" font-family="${FONT}">${esc(s.label)}</text>
  <rect x="${margin.left}" y="${y0}" width="${cleanW}" height="${barH}" fill="${CLEAN}" rx="3"/>
  <text x="${cleanLabelX}" y="${y0 + 12}" text-anchor="${cleanAnchor}" fill="${cleanFill}" font-size="11" font-weight="600" font-family="${FONT}">${cleanPct}</text>
  <rect x="${margin.left}" y="${y0 + barH + pairGap}" width="${messyW}" height="${barH}" fill="${MESSY}" rx="3"/>
  <text x="${messyLabelX}" y="${y0 + barH + pairGap + 12}" text-anchor="${messyAnchor}" fill="${messyFill}" font-size="11" font-weight="600" font-family="${FONT}">${messyPct}</text>`;
	}).join("");

	const xTicks = [0, 25, 50, 75, 100]
		.map((t) => {
			const x = r(margin.left + (t / 100) * plotW);
			return `
  <line x1="${x}" y1="${margin.top - 4}" x2="${x}" y2="${height - margin.bottom}" stroke="${GRID}" stroke-width="1"/>
  <text x="${x}" y="${height - 22}" text-anchor="middle" fill="${AXIS}" font-size="11" font-family="${FONT}">${t}%</text>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pass rate by scenario, clean vs messy">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${margin.left}" y="28" fill="${LABEL}" font-size="16" font-weight="600" font-family="${FONT}">Pass rate by scenario</text>
  <text x="${margin.left}" y="48" fill="${AXIS}" font-size="12" font-family="${FONT}">N=${summary.nRuns} paired live compares · higher is better</text>
  <rect x="${width - 210}" y="18" width="12" height="12" fill="${CLEAN}" rx="2"/>
  <text x="${width - 192}" y="28" fill="${LABEL}" font-size="12" font-family="${FONT}">skeleton-clean</text>
  <rect x="${width - 100}" y="18" width="12" height="12" fill="${MESSY}" rx="2"/>
  <text x="${width - 82}" y="28" fill="${LABEL}" font-size="12" font-family="${FONT}">skeleton-messy</text>
  ${xTicks}
  <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="${AXIS}" stroke-width="1.5"/>
  ${rows}
</svg>
`;
}

function tokenDeltaChart(summary: Summary): string {
	const width = 720;
	const rowH = 44;
	const margin = { top: 72, right: 80, bottom: 48, left: 148 };
	const height = margin.top + margin.bottom + SCENARIOS.length * rowH;
	const plotW = width - margin.left - margin.right;
	const values = SCENARIOS.map((s) => {
		const row = summary.scenarios[s.key];
		if (!row) throw new Error(`Missing scenario in SUMMARY.json: ${s.key}`);
		return { label: s.label, value: Math.max(0, row.medianTokenDelta) };
	});
	const max = Math.max(...values.map((v) => v.value), summary.overall.groundingMedianTokenDelta);
	const niceMax = Math.ceil(max / 100_000) * 100_000;
	const barH = 22;

	const rows = values
		.map((v, i) => {
			const y = margin.top + i * rowH + 8;
			const w = r((v.value / niceMax) * plotW);
			const label = v.value >= 1000 ? `+${Math.round(v.value / 1000)}k` : `+${Math.round(v.value)}`;
			const labelInside = w >= 56;
			const labelX = labelInside ? r(margin.left + w - 8) : r(margin.left + w + 8);
			const labelAnchor = labelInside ? "end" : "start";
			const labelFill = labelInside ? "#ffffff" : LABEL;
			return `
  <text x="${margin.left - 12}" y="${y + 16}" text-anchor="end" fill="${LABEL}" font-size="13" font-family="${FONT}">${esc(v.label)}</text>
  <rect x="${margin.left}" y="${y}" width="${Math.max(w, 2)}" height="${barH}" fill="${MESSY}" rx="3"/>
  <text x="${labelX}" y="${y + 15}" text-anchor="${labelAnchor}" fill="${labelFill}" font-size="12" font-weight="600" font-family="${FONT}">${label}</text>`;
		})
		.join("");

	const tickCount = 4;
	const xTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
		const t = (niceMax / tickCount) * i;
		const x = r(margin.left + (t / niceMax) * plotW);
		const label = t === 0 ? "0" : `${Math.round(t / 1000)}k`;
		return `
  <line x1="${x}" y1="${margin.top - 4}" x2="${x}" y2="${height - margin.bottom}" stroke="${GRID}" stroke-width="1"/>
  <text x="${x}" y="${height - 22}" text-anchor="middle" fill="${AXIS}" font-size="11" font-family="${FONT}">${label}</text>`;
	}).join("");

	const groundingK = Math.round(summary.overall.groundingMedianTokenDelta / 1000);

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Median extra tokens on messy fixture">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${margin.left}" y="28" fill="${LABEL}" font-size="16" font-weight="600" font-family="${FONT}">Median extra tokens on messy</text>
  <text x="${margin.left}" y="48" fill="${AXIS}" font-size="12" font-family="${FONT}">messy − clean · grounding median +${groundingK}k overall</text>
  ${xTicks}
  <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="${AXIS}" stroke-width="1.5"/>
  ${rows}
</svg>
`;
}

async function main(): Promise<void> {
	const root = resolve(import.meta.dir, "../..");
	const summaryPath = join(root, "agent-suites/evidence/SUMMARY.json");
	const outDir = join(root, "agent-suites/evidence/charts");
	const summary = JSON.parse(await readFile(summaryPath, "utf8")) as Summary;

	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "pass-rates.svg"), passRateChart(summary));
	await writeFile(join(outDir, "token-delta.svg"), tokenDeltaChart(summary));
	console.log(`Wrote charts to ${outDir}`);
}

await main();
