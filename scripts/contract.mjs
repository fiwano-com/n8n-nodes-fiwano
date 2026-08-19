#!/usr/bin/env node
/**
 * Public-contract snapshot & backward-compatibility gate.
 *
 * A saved n8n workflow stores *values*, not labels: the node type name, its
 * `typeVersion`, the credential name, and a bag of parameter `name` -> value.
 * Those strings are a permanent contract with every workflow already in the
 * wild. Renaming a display label is therefore free, while removing or renaming a
 * `value`, a parameter `name`, or an option value breaks each workflow that used
 * it — the node still loads, but the field resets or the operation stops
 * resolving.
 *
 * This script extracts exactly that contract from the *compiled* nodes and
 * compares it to the committed baseline in `scripts/contract.baseline.json`.
 *
 *   node scripts/contract.mjs check     # fail on any breaking difference
 *   node scripts/contract.mjs update    # re-record the baseline (deliberate act)
 *
 * Run `npm run build` first — this reads `dist/`, because that is what n8n loads.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'contract.baseline.json');

const NODE_FILES = [
	'dist/nodes/Fiwano/Fiwano.node.js',
	'dist/nodes/Fiwano/FiwanoTrigger.node.js',
];
const CRED_FILES = ['dist/credentials/FiwanoApi.credentials.js'];

/** Option values only — labels are display-only and may change freely. */
function optionValues(prop) {
	if (!Array.isArray(prop.options)) return undefined;
	// Collections/fixedCollections nest properties under `options`; those are
	// captured by walking them as parameters instead.
	if (prop.type === 'collection' || prop.type === 'fixedCollection') return undefined;
	return prop.options.map((o) => o.value).sort();
}

/**
 * Stable discriminator for properties that share a `name`.
 *
 * `operation` and `channelId` exist once per resource — same `name`, different
 * `displayOptions`. Keying by name alone would collapse them onto a single entry
 * and miss a renamed operation value, so the visibility condition is part of the
 * key.
 */
function discriminator(prop) {
	const show = prop.displayOptions?.show;
	if (!show) return '';
	const parts = Object.entries(show)
		.map(([k, v]) => `${k}=${[].concat(v).join('|')}`)
		.sort();
	return parts.length ? `[${parts.join(',')}]` : '';
}

/** Flatten a property tree into `path -> shape`, keyed by stored `name` + visibility. */
function collectParams(props, prefix, out) {
	for (const prop of props ?? []) {
		if (!prop?.name) continue;
		const leaf = `${prop.name}${discriminator(prop)}`;
		const path = prefix ? `${prefix}.${leaf}` : leaf;
		out[path] = {
			type: prop.type,
			required: Boolean(prop.required),
			optionValues: optionValues(prop),
			// `displayOptions` decides whether a saved value stays reachable in the UI.
			displayOptions: prop.displayOptions ?? null,
		};
		if (prop.type === 'collection' && Array.isArray(prop.options)) {
			collectParams(prop.options, path, out);
		}
		if (prop.type === 'fixedCollection' && Array.isArray(prop.options)) {
			for (const group of prop.options) {
				collectParams(group.values, `${path}.${group.name}`, out);
			}
		}
	}
	return out;
}

function describeNode(relPath) {
	const mod = require(join(ROOT, relPath));
	const ClassRef = Object.values(mod).find((v) => typeof v === 'function');
	const d = new ClassRef().description;
	return {
		name: d.name,
		version: d.version,
		credentials: (d.credentials ?? []).map((c) => ({ name: c.name, required: Boolean(c.required) })),
		webhookPaths: (d.webhooks ?? []).map((w) => `${w.httpMethod} ${w.path}`),
		parameters: collectParams(d.properties, '', {}),
	};
}

function buildContract() {
	const nodes = {};
	for (const f of NODE_FILES) nodes[describeNode(f).name] = describeNode(f);
	const credentials = {};
	for (const f of CRED_FILES) {
		const mod = require(join(ROOT, f));
		const ClassRef = Object.values(mod).find((v) => typeof v === 'function');
		const c = new ClassRef();
		credentials[c.name] = { properties: (c.properties ?? []).map((p) => p.name).sort() };
	}
	return { nodes, credentials };
}

// ── comparison ───────────────────────────────────────────────────────────────

const breaking = [];
const additions = [];

function cmpNode(name, before, after) {
	if (!after) {
		breaking.push(`node "${name}" was REMOVED — every workflow using it stops resolving`);
		return;
	}
	if (before.version !== after.version) {
		// A version bump is how n8n keeps old workflows on old behaviour, so this is
		// only safe when the old version is *retained* (array form).
		const kept = Array.isArray(after.version) && [before.version].flat().every((v) => after.version.includes(v));
		(kept ? additions : breaking).push(
			`node "${name}" version ${JSON.stringify(before.version)} -> ${JSON.stringify(after.version)}` +
				(kept ? ' (old version retained — OK)' : ' — old version DROPPED, saved workflows change behaviour'),
		);
	}
	for (const c of before.credentials) {
		if (!after.credentials.some((x) => x.name === c.name)) {
			breaking.push(`node "${name}": credential "${c.name}" was REMOVED`);
		}
	}
	for (const c of after.credentials) {
		const old = before.credentials.find((x) => x.name === c.name);
		if (old && !old.required && c.required) {
			breaking.push(`node "${name}": credential "${c.name}" became REQUIRED — existing nodes without it now fail`);
		}
	}
	for (const p of before.webhookPaths) {
		if (!after.webhookPaths.includes(p)) {
			breaking.push(`node "${name}": webhook "${p}" was REMOVED or changed — live webhook URLs would move`);
		}
	}

	for (const [path, was] of Object.entries(before.parameters)) {
		const now = after.parameters[path];
		if (!now) {
			breaking.push(`node "${name}": parameter "${path}" was REMOVED or RENAMED — saved values are orphaned`);
			continue;
		}
		if (was.type !== now.type) {
			breaking.push(`node "${name}": parameter "${path}" type ${was.type} -> ${now.type} — saved values may not deserialise`);
		}
		if (!was.required && now.required) {
			breaking.push(`node "${name}": parameter "${path}" became REQUIRED — nodes saved without it now fail validation`);
		}
		if (was.optionValues && now.optionValues) {
			const dropped = was.optionValues.filter((v) => !now.optionValues.includes(v));
			if (dropped.length) {
				breaking.push(`node "${name}": parameter "${path}" dropped option value(s) ${dropped.join(', ')} — saved selections break`);
			}
			const added = now.optionValues.filter((v) => !was.optionValues.includes(v));
			if (added.length) additions.push(`node "${name}": parameter "${path}" gained option value(s) ${added.join(', ')}`);
		}
		if (JSON.stringify(was.displayOptions) !== JSON.stringify(now.displayOptions)) {
			additions.push(`node "${name}": parameter "${path}" displayOptions changed — CHECK the field is still shown for every saved combination`);
		}
	}
	for (const path of Object.keys(after.parameters)) {
		if (!before.parameters[path]) additions.push(`node "${name}": parameter "${path}" added`);
	}
}

function cmp(before, after) {
	for (const [name, node] of Object.entries(before.nodes)) cmpNode(name, node, after.nodes[name]);
	for (const name of Object.keys(after.nodes)) if (!before.nodes[name]) additions.push(`node "${name}" added`);

	for (const [name, cred] of Object.entries(before.credentials)) {
		const now = after.credentials[name];
		if (!now) {
			breaking.push(`credential "${name}" was REMOVED — every saved credential of this type is orphaned`);
			continue;
		}
		for (const p of cred.properties) {
			if (!now.properties.includes(p)) breaking.push(`credential "${name}": field "${p}" was REMOVED or RENAMED`);
		}
		for (const p of now.properties) {
			if (!cred.properties.includes(p)) additions.push(`credential "${name}": field "${p}" added`);
		}
	}
}

// ── entrypoint ───────────────────────────────────────────────────────────────

const mode = process.argv[2] ?? 'check';
if (!existsSync(join(ROOT, NODE_FILES[0]))) {
	console.error('dist/ not found — run `npm run build` first.');
	process.exit(2);
}

const current = buildContract();

if (mode === 'update') {
	writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
	console.log(`Baseline written to scripts/contract.baseline.json`);
	console.log('Commit it in the SAME commit as the change it records.');
	process.exit(0);
}

if (!existsSync(BASELINE)) {
	console.error('No baseline found. Create one with: node scripts/contract.mjs update');
	process.exit(2);
}

cmp(JSON.parse(readFileSync(BASELINE, 'utf8')), current);

if (additions.length) {
	console.log('Non-breaking changes vs baseline:');
	for (const a of additions) console.log('  +', a);
	console.log('');
}

if (breaking.length) {
	console.error('BREAKING changes vs baseline — saved user workflows would be affected:');
	for (const b of breaking) console.error('  ✗', b);
	console.error('');
	console.error('If this is intentional, it needs a node typeVersion bump (keeping the old');
	console.error('version in the `version` array), not just a baseline update.');
	console.error('Otherwise revert. To re-record deliberately: node scripts/contract.mjs update');
	process.exit(1);
}

console.log(`Contract OK — no breaking changes (${additions.length} non-breaking difference(s)).`);
