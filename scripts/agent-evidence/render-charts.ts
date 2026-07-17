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

function esc(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function passRateChart(summary: Summary): string {
	const width = 720;
	const height = 360;
	const margin = { top: 56, right: 24, bottom: 72, left: 56 };
	const plotW = width - margin.left - margin.right;
	const plotH = height - margin.top - margin.bottom;
	const groupW = plotW / SCENARIOS.length;
	const barW = groupW * 0.32;
	const gap = groupW * 0.08;

	const r = (n: number) => Math.round(n * 100) / 100;
	const bars = SCENARIOS.map((s, i) => {
		const row = summary.scenarios[s.key];
		if (!row) throw new Error(`Missing scenario in SUMMARY.json: ${s.key}`);
		const x0 = r(margin.left + i * groupW + groupW * 0.14);
		const cleanH = r(row.cleanPassRate * plotH);
		const messyH = r(row.messyPassRate * plotH);
		const cleanY = r(margin.top + plotH - cleanH);
		const messyY = r(margin.top + plotH - messyH);
		const labelX = r(margin.left + i * groupW + groupW / 2);
		const messyLabelY = messyH < 1 ? r(margin.top + plotH - 8) : r(Math.max(messyY - 6, margin.top + 12));
		return `
  <rect x="${x0}" y="${cleanY}" width="${r(barW)}" height="${cleanH}" fill="${CLEAN}" rx="3"/>
  <rect x="${r(x0 + barW + gap)}" y="${messyY}" width="${r(barW)}" height="${messyH}" fill="${MESSY}" rx="3"/>
  <text x="${labelX}" y="${height - 36}" text-anchor="middle" fill="${LABEL}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">${esc(s.label)}</text>
  <text x="${r(x0 + barW / 2)}" y="${r(cleanY - 6)}" text-anchor="middle" fill="${CLEAN}" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${Math.round(row.cleanPassRate * 100)}%</text>
  <text x="${r(x0 + barW + gap + barW / 2)}" y="${messyLabelY}" text-anchor="middle" fill="${MESSY}" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${Math.round(row.messyPassRate * 100)}%</text>`;
	}).join("");

	const yTicks = [0, 25, 50, 75, 100]
		.map((t) => {
			const y = margin.top + plotH - (t / 100) * plotH;
			return `
  <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${GRID}" stroke-width="1"/>
  <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="${AXIS}" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${t}%</text>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pass rate by scenario, clean vs messy">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${margin.left}" y="28" fill="${LABEL}" font-size="16" font-weight="600" font-family="ui-sans-serif, system-ui, sans-serif">Pass rate by scenario</text>
  <text x="${margin.left}" y="46" fill="${AXIS}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">N=${summary.nRuns} paired live compares · higher is better</text>
  <rect x="${width - 210}" y="18" width="12" height="12" fill="${CLEAN}" rx="2"/>
  <text x="${width - 192}" y="28" fill="${LABEL}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">skeleton-clean</text>
  <rect x="${width - 100}" y="18" width="12" height="12" fill="${MESSY}" rx="2"/>
  <text x="${width - 82}" y="28" fill="${LABEL}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">skeleton-messy</text>
  ${yTicks}
  <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}" stroke="${AXIS}" stroke-width="1.5"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="${AXIS}" stroke-width="1.5"/>
  ${bars}
</svg>
`;
}

function tokenDeltaChart(summary: Summary): string {
	const width = 720;
	const height = 360;
	const margin = { top: 56, right: 24, bottom: 72, left: 64 };
	const plotW = width - margin.left - margin.right;
	const plotH = height - margin.top - margin.bottom;
	const values = SCENARIOS.map((s) => {
		const row = summary.scenarios[s.key];
		if (!row) throw new Error(`Missing scenario in SUMMARY.json: ${s.key}`);
		return { label: s.label, value: Math.max(0, row.medianTokenDelta) };
	});
	const max = Math.max(...values.map((v) => v.value), summary.overall.groundingMedianTokenDelta);
	const niceMax = Math.ceil(max / 100_000) * 100_000;
	const barSlot = plotW / values.length;
	const barW = barSlot * 0.55;

	const r = (n: number) => Math.round(n * 100) / 100;
	const bars = values
		.map((v, i) => {
			const h = r((v.value / niceMax) * plotH);
			const x = r(margin.left + i * barSlot + (barSlot - barW) / 2);
			const y = r(margin.top + plotH - h);
			const label = v.value >= 1000 ? `${Math.round(v.value / 1000)}k` : String(Math.round(v.value));
			return `
  <rect x="${x}" y="${y}" width="${r(barW)}" height="${h}" fill="${MESSY}" rx="3"/>
  <text x="${r(x + barW / 2)}" y="${r(y - 8)}" text-anchor="middle" fill="${LABEL}" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">+${label}</text>
  <text x="${r(margin.left + i * barSlot + barSlot / 2)}" y="${height - 36}" text-anchor="middle" fill="${LABEL}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">${esc(v.label)}</text>`;
		})
		.join("");

	const tickCount = 4;
	const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
		const t = (niceMax / tickCount) * i;
		const y = margin.top + plotH - (t / niceMax) * plotH;
		const label = t === 0 ? "0" : `${Math.round(t / 1000)}k`;
		return `
  <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${GRID}" stroke-width="1"/>
  <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="${AXIS}" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>`;
	}).join("");

	const groundingK = Math.round(summary.overall.groundingMedianTokenDelta / 1000);

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Median extra tokens on messy fixture">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${margin.left}" y="28" fill="${LABEL}" font-size="16" font-weight="600" font-family="ui-sans-serif, system-ui, sans-serif">Median extra tokens on messy</text>
  <text x="${margin.left}" y="46" fill="${AXIS}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">messy − clean · grounding median +${groundingK}k overall</text>
  ${yTicks}
  <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}" stroke="${AXIS}" stroke-width="1.5"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="${AXIS}" stroke-width="1.5"/>
  ${bars}
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
