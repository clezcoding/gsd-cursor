#!/usr/bin/env node
'use strict';

/**
 * gsd-cursor — a GSD EoS that installs Cursor model tier maps + 4 profiles
 * into your GSD config, without touching gsd-core. Node built-ins only.
 *
 * Commands:
 *   gsd-cursor install [--profile <name>] [--global|--local]
 *   gsd-cursor use <max|hybrid|value|budget> [--global|--local]
 *   gsd-cursor uninstall [--global|--local]
 *   gsd-cursor list
 *   gsd-cursor status [--global|--local]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA = require('../lib/profiles.json');
const PKG = require('../package.json');
const RUNTIME = DATA.runtime;

function parseArgs(argv) {
  const out = { _: [], scope: null, profile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--global') out.scope = 'global';
    else if (a === '--local') out.scope = 'local';
    else if (a === '--profile') out.profile = argv[++i];
    else out._.push(a);
  }
  return out;
}

function configPath(scope) {
  if (scope === 'global') return path.join(os.homedir(), '.gsd', 'defaults.json');
  return path.join(process.cwd(), '.planning', 'config.json');
}

// If scope not given: prefer local .planning/ when present, else global.
function resolveScope(scope) {
  if (scope) return scope;
  return fs.existsSync(path.join(process.cwd(), '.planning')) ? 'local' : 'global';
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function applyProfile(cfg, name) {
  const pf = DATA.profiles[name];
  if (!pf) throw new Error(`Unknown profile "${name}". Valid: ${Object.keys(DATA.profiles).join(', ')}`);
  cfg.runtime = RUNTIME;
  cfg.model_profile = pf.base;
  cfg.model_profile_overrides = cfg.model_profile_overrides || {};
  cfg.model_profile_overrides[RUNTIME] = Object.assign({}, pf.overrides);
  if (pf.models) {
    cfg.models = Object.assign({}, cfg.models || {}, pf.models);
  } else if (cfg.models) {
    for (const k of ['planning', 'verification', 'execution', 'research']) delete cfg.models[k];
  }
  cfg._gsd_cursor = { profile: name, managedBy: 'gsd-cursor', version: PKG.version };
  return cfg;
}

function warnUnverified(name) {
  const pf = DATA.profiles[name];
  if (pf && pf.unverifiedIds && pf.unverifiedIds.length) {
    console.warn('\n⚠️  Verification gate: this profile uses model IDs that were NOT in Cursor\'s');
    console.warn('   Cloud-Agents API list: ' + pf.unverifiedIds.join(', '));
    console.warn('   Open Cursor > Settings > Models and confirm each appears (Gemini natively,');
    console.warn('   GLM via the OpenAI-compatible custom-model integration) BEFORE running GSD.\n');
  }
}

function cmdInstall(args) {
  const scope = resolveScope(args.scope);
  const name = args.profile || DATA.default;
  const p = configPath(scope);
  const cfg = applyProfile(readJson(p), name);
  writeJson(p, cfg);
  console.log(`✓ gsd-cursor: installed profile "${name}" (${scope}) → ${p}`);
  warnUnverified(name);
  console.log('   Switch anytime:  gsd-cursor use <max|hybrid|value|budget>');
}

function cmdUse(args) {
  const name = args._[1];
  if (!name) { console.error('Usage: gsd-cursor use <max|hybrid|value|budget>'); process.exit(1); }
  const scope = resolveScope(args.scope);
  const p = configPath(scope);
  const cfg = applyProfile(readJson(p), name);
  writeJson(p, cfg);
  console.log(`✓ gsd-cursor: switched to "${name}" (${scope}) → ${p}`);
  warnUnverified(name);
}

function cmdUninstall(args) {
  const scope = resolveScope(args.scope);
  const p = configPath(scope);
  const cfg = readJson(p);
  if (cfg.model_profile_overrides) delete cfg.model_profile_overrides[RUNTIME];
  delete cfg._gsd_cursor;
  writeJson(p, cfg);
  console.log(`✓ gsd-cursor: removed Cursor overrides (${scope}) → ${p}`);
  console.log('   (Your other GSD settings were left untouched.)');
}

function cmdList() {
  console.log(`gsd-cursor v${PKG.version} — Cursor model profiles for GSD\n`);
  for (const [name, pf] of Object.entries(DATA.profiles)) {
    const flag = pf.verified ? '✓ API-verified IDs' : '† confirm Gemini/GLM in your picker';
    console.log(`  ${name.padEnd(7)} ${pf.label}`);
    console.log(`          base=${pf.base}  opus=${pf.overrides.opus}`);
    console.log(`          sonnet=${pf.overrides.sonnet}  haiku=${pf.overrides.haiku}`);
    console.log(`          vendors: ${pf.vendors.join(' · ')}  [${flag}]\n`);
  }
  console.log(`  default: ${DATA.default}`);
}

function cmdStatus(args) {
  const scope = resolveScope(args.scope);
  const p = configPath(scope);
  const cfg = readJson(p);
  if (cfg._gsd_cursor) {
    console.log(`gsd-cursor: profile "${cfg._gsd_cursor.profile}" active (${scope}) → ${p}`);
    console.log('  overrides.cursor = ' + JSON.stringify((cfg.model_profile_overrides || {})[RUNTIME] || {}));
  } else {
    console.log(`gsd-cursor: not installed in ${scope} config (${p}).`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    switch (cmd) {
      case 'install': return cmdInstall(args);
      case 'use': return cmdUse(args);
      case 'uninstall': return cmdUninstall(args);
      case 'list': return cmdList();
      case 'status': return cmdStatus(args);
      default:
        console.log('gsd-cursor <install|use|uninstall|list|status> [--profile <name>] [--global|--local]');
        if (cmd) process.exit(1);
    }
  } catch (e) {
    console.error('gsd-cursor error: ' + e.message);
    process.exit(1);
  }
}

main();
