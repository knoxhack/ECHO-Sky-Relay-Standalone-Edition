#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_EVIDENCE = 'fixtures/sky-relay/gameplay-qa/manual-evidence.json';
const DEFAULT_TEMPLATE = 'fixtures/sky-relay/gameplay-qa/manual-evidence.template.json';
const TEMPLATE_MARKER = 'ECHO_SKY_RELAY_TEMPLATE_ONLY';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08])
];

const REQUIRED_CLAIMS = [
  'realFirst30Playthrough',
  'realFirst2HourPlaythrough',
  'realSignalCrownPlaythrough',
  'freshWorldCreated',
  'saveReloadVerified',
  'noCrashEvidence'
];

const REQUIRED_GROUPS = {
  supportingFiles: {
    minItems: 4,
    patterns: [
      /(^|\/)first[-_]?30[-_]?minutes[^/]*\.md$/iu,
      /(^|\/)first[-_]?2[-_]?hours[^/]*\.md$/iu,
      /(^|\/)signal[-_]?crown[^/]*\.md$/iu,
      /(^|\/)no[-_]?crash[^/]*\.md$/iu
    ]
  },
  screenshots: {
    minItems: 3,
    patterns: [
      /(^|\/)first[-_]?30[-_]?minutes[^/]*\.png$/iu,
      /(^|\/)first[-_]?2[-_]?hours[^/]*\.png$/iu,
      /(^|\/)signal[-_]?crown[^/]*\.png$/iu
    ]
  },
  logs: {
    minItems: 2,
    patterns: [
      /(^|\/)client[^/]*\.log$/iu,
      /(^|\/)(launcher|pack)[-_]?install[^/]*\.log$/iu
    ]
  },
  saveSnapshots: {
    minItems: 3,
    patterns: [
      /(^|\/)first[-_]?30[-_]?minutes[^/]*\.zip$/iu,
      /(^|\/)first[-_]?2[-_]?hours[^/]*\.zip$/iu,
      /(^|\/)signal[-_]?crown[^/]*\.zip$/iu
    ]
  }
};

function usage() {
  return `Usage: node scripts/verify-manual-gameplay-evidence.mjs [options]

Verifies this Sky Relay edition's manual gameplay evidence. Missing real
evidence reports BLOCKED by default; --require-release-ready makes it fail.

Options:
  --root <dir>                Edition repository root. Default: current directory.
  --evidence <path>           Manual evidence JSON. Default: ${DEFAULT_EVIDENCE}
  --template <path>           Manual evidence template. Default: ${DEFAULT_TEMPLATE}
  --template-only             Validate only the template contract for CI.
  --require-release-ready     Exit non-zero unless real manual evidence passes.
  --help                      Print this help text.
`;
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    evidence: DEFAULT_EVIDENCE,
    template: DEFAULT_TEMPLATE,
    templateOnly: false,
    requireReleaseReady: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--root') args.root = path.resolve(next());
    else if (arg === '--evidence') args.evidence = next();
    else if (arg === '--template') args.template = next();
    else if (arg === '--template-only') args.templateOnly = true;
    else if (arg === '--require-release-ready') args.requireReleaseReady = true;
    else if (arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function normalizeRel(value) {
  return String(value).replace(/\\/g, '/');
}

function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || relPath.trim() === '' || path.isAbsolute(relPath)) {
    return { error: 'relative-path-required' };
  }
  const base = path.resolve(root);
  const target = path.resolve(base, relPath);
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { error: 'outside-root' };
  return { target };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function fileStartsWith(filePath, signatures) {
  const longest = Math.max(...signatures.map((signature) => signature.length));
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(longest);
    const result = await handle.read(buffer, 0, longest, 0);
    return signatures.some((signature) => result.bytesRead >= signature.length && buffer.subarray(0, signature.length).equals(signature));
  } finally {
    await handle.close();
  }
}

async function pngDimensions(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(24);
    const result = await handle.read(header, 0, header.length, 0);
    if (result.bytesRead < header.length || !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
    if (header.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

function validatePathListShape({ root, label, values, minItems, patterns, blockers }) {
  if (!Array.isArray(values)) {
    blockers.push(`${label} must be an array.`);
    return;
  }
  if (values.length < minItems) blockers.push(`${label} must contain at least ${minItems} item(s).`);
  if (new Set(values.map(normalizeRel)).size !== values.length) blockers.push(`${label} must not contain duplicate paths.`);
  for (const pattern of patterns) {
    if (!values.some((value) => pattern.test(normalizeRel(value)))) {
      blockers.push(`${label} must include a path matching ${pattern}.`);
    }
  }
  for (const [index, relPath] of values.entries()) {
    const resolved = resolveInside(root, relPath);
    if (resolved.error === 'relative-path-required') blockers.push(`${label}[${index}] must be a relative file path.`);
    if (resolved.error === 'outside-root') blockers.push(`${label}[${index}] points outside the repo: ${relPath}`);
  }
}

function validateEvidenceShape({ root, manifest, evidence, label, expectedClaimValue, blockers }) {
  if (evidence.schemaVersion !== 'echo.skyrelay.gameplay-qa.manual.v1') {
    blockers.push(`${label} schemaVersion must be echo.skyrelay.gameplay-qa.manual.v1.`);
  }
  if (evidence.packId !== manifest.packId) {
    blockers.push(`${label} packId must match manifest packId ${manifest.packId}.`);
  }
  for (const claim of REQUIRED_CLAIMS) {
    if (evidence.claims?.[claim] !== expectedClaimValue) {
      blockers.push(`${label} claim ${claim} must be ${expectedClaimValue}.`);
    }
  }
  for (const [group, rules] of Object.entries(REQUIRED_GROUPS)) {
    validatePathListShape({ root, label: `${label}.${group}`, values: evidence[group], blockers, ...rules });
  }
}

async function validateRealFiles({ root, evidence, blockers }) {
  const checked = {};
  for (const group of Object.keys(REQUIRED_GROUPS)) checked[group] = [];
  for (const [group, values] of Object.entries(evidence)) {
    if (!REQUIRED_GROUPS[group] || !Array.isArray(values)) continue;
    for (const [index, relPath] of values.entries()) {
      const resolved = resolveInside(root, relPath);
      if (resolved.error) continue;
      if (!(await fileExists(resolved.target))) {
        blockers.push(`manualEvidence.${group}[${index}] target does not exist: ${relPath}`);
        continue;
      }
      const stat = await fs.stat(resolved.target);
      if (stat.size < 1) {
        blockers.push(`manualEvidence.${group}[${index}] target must be at least 1 byte: ${relPath}`);
        continue;
      }
      const record = {
        path: normalizeRel(relPath),
        size: stat.size,
        sha256: await sha256File(resolved.target)
      };
      if (group === 'supportingFiles') {
        const text = await fs.readFile(resolved.target, 'utf8');
        if (text.includes(TEMPLATE_MARKER)) {
          blockers.push(`manualEvidence.${group}[${index}] target still contains template marker ${TEMPLATE_MARKER}: ${relPath}`);
        }
      }
      if (group === 'screenshots') {
        if (!(await fileStartsWith(resolved.target, [PNG_SIGNATURE]))) {
          blockers.push(`manualEvidence.${group}[${index}] target is not a PNG file: ${relPath}`);
          continue;
        }
        const dimensions = await pngDimensions(resolved.target);
        if (!dimensions || dimensions.width < 640 || dimensions.height < 360) {
          blockers.push(`manualEvidence.${group}[${index}] PNG dimensions must be at least 640x360: ${relPath}`);
          continue;
        }
        record.dimensions = dimensions;
      }
      if (group === 'saveSnapshots' && !(await fileStartsWith(resolved.target, ZIP_SIGNATURES))) {
        blockers.push(`manualEvidence.${group}[${index}] target is not a ZIP file: ${relPath}`);
        continue;
      }
      checked[group].push(record);
    }
  }
  return checked;
}

async function buildReport(args) {
  const root = path.resolve(args.root);
  const blockers = [];
  const manifest = await readJson(path.join(root, 'release-manifest.template.json'));
  const template = await readJson(path.join(root, args.template));

  validateEvidenceShape({ root, manifest, evidence: template, label: 'template', expectedClaimValue: false, blockers });

  let manualEvidence = null;
  if (!args.templateOnly) {
    const resolved = resolveInside(root, args.evidence);
    if (resolved.error) blockers.push(`manual evidence path must stay inside the repo: ${args.evidence}`);
    else if (!(await fileExists(resolved.target))) blockers.push(`manual evidence is missing: ${args.evidence}`);
    else {
      const evidence = await readJson(resolved.target);
      validateEvidenceShape({ root, manifest, evidence, label: 'manualEvidence', expectedClaimValue: true, blockers });
      if (typeof evidence.generatedAt !== 'string' || Number.isNaN(Date.parse(evidence.generatedAt))) {
        blockers.push('manualEvidence generatedAt must be an ISO timestamp.');
      }
      manualEvidence = {
        found: true,
        claims: Object.fromEntries(REQUIRED_CLAIMS.map((claim) => [claim, evidence.claims?.[claim] === true])),
        checked: await validateRealFiles({ root, evidence, blockers })
      };
    }
  }

  return {
    schemaVersion: 'echo.skyrelay.edition-gameplay-evidence.v1',
    status: blockers.length ? 'BLOCKED' : 'PASS',
    mode: args.templateOnly ? 'template-only' : 'manual-evidence',
    generatedAt: new Date().toISOString(),
    packId: manifest.packId,
    runtimeTarget: manifest.runtimeTarget,
    evidencePath: args.evidence,
    templatePath: args.template,
    requiredClaims: REQUIRED_CLAIMS,
    manualEvidence,
    blockers
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
} else {
  const report = await buildReport(args);
  console.log(JSON.stringify(report, null, 2));
  if ((args.requireReleaseReady || args.templateOnly) && report.status !== 'PASS') process.exitCode = 1;
}
