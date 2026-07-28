#!/usr/bin/env node
'use strict';

/**
 * gsd-cursor — safe Cursor runtime model profiles for GSD Core.
 * Node.js built-ins only; no network access.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DATA = require('../lib/profiles.json');
const PKG = require('../package.json');
const RUNTIME = DATA.runtime;
const PHASES = DATA.phaseKeys;
const PROFILE_NAMES = Object.keys(DATA.profiles);
const MANAGED_AGENTS = [...new Set(PROFILE_NAMES.flatMap((name) => Object.keys(DATA.profiles[name].agentOverrides || {})))];

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseArgs(argv) {
  const out = { _: [], scope: null, profile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--global' || arg === '--local') {
      const scope = arg.slice(2);
      if (out.scope && out.scope !== scope) throw new Error('Choose exactly one scope: --local or --global.');
      out.scope = scope;
    } else if (arg === '--profile') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) throw new Error('--profile requires a profile name.');
      out.profile = argv[++i];
    } else if (arg.startsWith('--profile=')) {
      out.profile = arg.slice('--profile='.length);
      if (!out.profile) throw new Error('--profile requires a profile name.');
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}".`);
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function assertProfile(name) {
  if (!DATA.profiles[name]) throw new Error(`Unknown profile "${name}". Valid profiles: ${PROFILE_NAMES.join(', ')}.`);
  return DATA.profiles[name];
}

function configPath(scope) {
  if (scope === 'global') return path.join(os.homedir(), '.gsd', 'defaults.json');
  return path.join(process.cwd(), '.planning', 'config.json');
}

// Prefer a local project when .planning exists; otherwise use the global defaults.
function resolveScope(scope) {
  if (scope) return scope;
  return fs.existsSync(path.join(process.cwd(), '.planning')) ? 'local' : 'global';
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
  try {
    const parsed = JSON.parse(source);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('the root value must be a JSON object');
    return parsed;
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error.message}. No changes were written.`);
  }
}

function writeJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(file)}.gsd-cursor-${process.pid}-${Date.now()}.tmp`);
  const backup = `${file}.gsd-cursor.bak`;
  const existed = fs.existsSync(file);
  let mode;

  try {
    if (existed) {
      mode = fs.statSync(file).mode;
      fs.copyFileSync(file, backup);
    }
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: mode || 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw new Error(`Cannot safely write ${file}: ${error.message}`);
  }

  return existed ? backup : null;
}

function snapshotEntry(object, key) {
  return hasOwn(object, key) ? { exists: true, value: clone(object[key]) } : { exists: false };
}

function captureSnapshot(config) {
  const legacyTiers = config.model_profile_overrides || {};
  const runtimeTiers = ((config.model_policy || {}).runtime_tiers) || {};
  const models = config.models || {};
  const modelOverrides = config.model_overrides || {};

  return {
    runtime: snapshotEntry(config, 'runtime'),
    modelProfile: snapshotEntry(config, 'model_profile'),
    legacyRuntimeTiers: snapshotEntry(legacyTiers, RUNTIME),
    runtimeTiers: snapshotEntry(runtimeTiers, RUNTIME),
    phases: Object.fromEntries(PHASES.map((phase) => [phase, snapshotEntry(models, phase)])),
    agents: Object.fromEntries(MANAGED_AGENTS.map((agent) => [agent, snapshotEntry(modelOverrides, agent)]))
  };
}

function restoreEntry(object, key, entry) {
  if (entry && entry.exists) object[key] = clone(entry.value);
  else delete object[key];
}

function removeEmptyContainers(config) {
  if (config.model_profile_overrides && Object.keys(config.model_profile_overrides).length === 0) delete config.model_profile_overrides;
  if (config.model_policy && config.model_policy.runtime_tiers && Object.keys(config.model_policy.runtime_tiers).length === 0) {
    delete config.model_policy.runtime_tiers;
  }
  if (config.model_policy && Object.keys(config.model_policy).length === 0) delete config.model_policy;
  if (config.models && Object.keys(config.models).length === 0) delete config.models;
  if (config.model_overrides && Object.keys(config.model_overrides).length === 0) delete config.model_overrides;
}

function toPolicyTiers(overrides) {
  return Object.fromEntries(Object.entries(overrides).map(([tier, model]) => [tier, { model }]));
}

function applyProfile(config, name) {
  const profile = assertProfile(name);
  const previousMarker = config._gsd_cursor;
  const snapshot = previousMarker && previousMarker.snapshot ? previousMarker.snapshot : captureSnapshot(config);

  config.runtime = RUNTIME;
  config.model_profile = profile.base;

  config.model_policy = config.model_policy || {};
  config.model_policy.runtime_tiers = config.model_policy.runtime_tiers || {};
  config.model_policy.runtime_tiers[RUNTIME] = toPolicyTiers(profile.overrides);

  // Compatibility for GSD releases that predate model_policy.runtime_tiers.
  config.model_profile_overrides = config.model_profile_overrides || {};
  config.model_profile_overrides[RUNTIME] = clone(profile.overrides);

  config.models = config.models || {};
  for (const phase of PHASES) config.models[phase] = profile.models[phase];

  config.model_overrides = config.model_overrides || {};
  for (const agent of MANAGED_AGENTS) delete config.model_overrides[agent];
  Object.assign(config.model_overrides, clone(profile.agentOverrides || {}));

  config._gsd_cursor = {
    profile: name,
    managedBy: 'gsd-cursor',
    version: PKG.version,
    snapshot
  };

  removeEmptyContainers(config);
  return config;
}

function restoreSnapshot(config, snapshot) {
  restoreEntry(config, 'runtime', snapshot.runtime);
  restoreEntry(config, 'model_profile', snapshot.modelProfile);

  config.model_profile_overrides = config.model_profile_overrides || {};
  restoreEntry(config.model_profile_overrides, RUNTIME, snapshot.legacyRuntimeTiers);

  config.model_policy = config.model_policy || {};
  config.model_policy.runtime_tiers = config.model_policy.runtime_tiers || {};
  restoreEntry(config.model_policy.runtime_tiers, RUNTIME, snapshot.runtimeTiers);

  config.models = config.models || {};
  for (const phase of PHASES) restoreEntry(config.models, phase, snapshot.phases && snapshot.phases[phase]);

  config.model_overrides = config.model_overrides || {};
  for (const agent of MANAGED_AGENTS) restoreEntry(config.model_overrides, agent, snapshot.agents && snapshot.agents[agent]);

  delete config._gsd_cursor;
  removeEmptyContainers(config);
  return config;
}

function removeLegacyInstall(config) {
  if (config.model_profile_overrides) delete config.model_profile_overrides[RUNTIME];
  if (config.model_policy && config.model_policy.runtime_tiers) delete config.model_policy.runtime_tiers[RUNTIME];
  if (config.models) for (const phase of PHASES) delete config.models[phase];
  if (config.model_overrides) for (const agent of MANAGED_AGENTS) delete config.model_overrides[agent];
  delete config._gsd_cursor;
  removeEmptyContainers(config);
  return config;
}

function printBackup(backup) {
  if (backup) console.log(`   Previous file backup: ${backup}`);
}

function printProfileNotes(profile) {
  for (const note of profile.notes || []) console.warn(`   Note: ${note}`);
}

function cmdInstall(args) {
  const scope = resolveScope(args.scope);
  const name = args.profile || DATA.default;
  const profile = assertProfile(name);
  const file = configPath(scope);
  const config = applyProfile(readJson(file), name);
  const backup = writeJson(file, config);
  console.log(`✓ gsd-cursor: installed "${name}" (${scope}) → ${file}`);
  printBackup(backup);
  printProfileNotes(profile);
  console.log(`   Validate availability: gsd-cursor doctor --profile ${name}`);
  console.log(`   Switch anytime:       gsd-cursor use <${PROFILE_NAMES.join('|')}>`);
}

function cmdUse(args) {
  const name = args._[1];
  if (!name || args._.length !== 2) throw new Error(`Usage: gsd-cursor use <${PROFILE_NAMES.join('|')}> [--local|--global]`);
  if (args.profile) throw new Error('Use the positional profile name with `gsd-cursor use`; do not combine it with --profile.');
  const profile = assertProfile(name);
  const scope = resolveScope(args.scope);
  const file = configPath(scope);
  const config = applyProfile(readJson(file), name);
  const backup = writeJson(file, config);
  console.log(`✓ gsd-cursor: switched to "${name}" (${scope}) → ${file}`);
  printBackup(backup);
  printProfileNotes(profile);
}

function cmdUninstall(args) {
  if (args.profile || args._.length !== 1) throw new Error('Usage: gsd-cursor uninstall [--local|--global]');
  const scope = resolveScope(args.scope);
  const file = configPath(scope);
  const config = readJson(file);
  const marker = config._gsd_cursor;

  if (!marker) {
    console.log(`gsd-cursor: not installed in ${scope} config (${file}).`);
    return;
  }

  if (marker.snapshot) restoreSnapshot(config, marker.snapshot);
  else removeLegacyInstall(config);
  const backup = writeJson(file, config);
  console.log(`✓ gsd-cursor: restored the pre-install managed settings (${scope}) → ${file}`);
  printBackup(backup);
  if (!marker.snapshot) console.warn('   Legacy installation had no snapshot; only gsd-cursor-managed nested values were removed.');
}

function cmdList(args) {
  if (args.profile || args.scope || args._.length !== 1) throw new Error('Usage: gsd-cursor list');
  console.log(`gsd-cursor v${PKG.version} — Cursor model profiles for GSD\n`);
  for (const [name, profile] of Object.entries(DATA.profiles)) {
    const defaultFlag = name === DATA.default ? ' (default)' : '';
    console.log(`  ${name.padEnd(11)} ${profile.label}${defaultFlag}`);
    console.log(`              ${profile.description}`);
    console.log(`              opus=${profile.overrides.opus}`);
    console.log(`              sonnet=${profile.overrides.sonnet}`);
    console.log(`              haiku=${profile.overrides.haiku}`);
    console.log(`              vendors: ${profile.vendors.join(' · ')}\n`);
  }
}

function cmdStatus(args) {
  if (args.profile || args._.length !== 1) throw new Error('Usage: gsd-cursor status [--local|--global]');
  const scope = resolveScope(args.scope);
  const file = configPath(scope);
  const config = readJson(file);
  if (!config._gsd_cursor) {
    console.log(`gsd-cursor: not installed in ${scope} config (${file}).`);
    return;
  }
  console.log(`gsd-cursor: profile "${config._gsd_cursor.profile}" active (${scope}) → ${file}`);
  console.log(`  version: ${config._gsd_cursor.version || 'legacy'}`);
  console.log(`  runtime tiers: ${JSON.stringify((((config.model_policy || {}).runtime_tiers || {})[RUNTIME]) || {})}`);
  console.log(`  phases: ${JSON.stringify(config.models || {})}`);
  console.log(`  agent overrides: ${JSON.stringify(config.model_overrides || {})}`);
  console.log(`  restore snapshot: ${config._gsd_cursor.snapshot ? 'available' : 'not available (legacy install)'}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function outputContainsModel(output, model) {
  return new RegExp(`(^|[\\s│|])${escapeRegExp(model)}(?=$|[\\s│|])`, 'm').test(output);
}

function selectedDoctorProfile(args) {
  if (args.profile) return args.profile;
  const scope = resolveScope(args.scope);
  const config = readJson(configPath(scope));
  return (config._gsd_cursor && config._gsd_cursor.profile) || DATA.default;
}

function cmdDoctor(args) {
  if (args._.length !== 1) throw new Error('Usage: gsd-cursor doctor [--profile <name>] [--local|--global]');
  const name = selectedDoctorProfile(args);
  const profile = assertProfile(name);
  const models = [...new Set([...Object.values(profile.overrides), ...Object.values(profile.agentOverrides || {})])].sort();
  const binary = process.env.GSD_CURSOR_AGENT_BIN || 'agent';
  const result = spawnSync(binary, ['--list-models'], { encoding: 'utf8', timeout: 30000 });

  console.log(`gsd-cursor doctor — profile "${name}"`);
  if (result.error) {
    throw new Error(`Could not run ${binary} --list-models: ${result.error.message}. Install/sign in to Cursor CLI or set GSD_CURSOR_AGENT_BIN.`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${binary} --list-models exited with status ${result.status}${detail ? `: ${detail}` : '.'}`);
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const missing = [];
  for (const model of models) {
    const available = outputContainsModel(output, model);
    console.log(`  ${available ? '✓' : '✗'} ${model}`);
    if (!available) missing.push(model);
  }

  if (missing.length) {
    console.error(`\n${missing.length} model ID(s) are unavailable in this Cursor account. Choose another profile or enable those models in Cursor Settings.`);
    process.exitCode = 1;
  } else {
    console.log(`\n✓ All ${models.length} model IDs are available.`);
  }
}

function printHelp() {
  console.log(`gsd-cursor v${PKG.version}\n`);
  console.log('Usage:');
  console.log(`  gsd-cursor install [--profile <${PROFILE_NAMES.join('|')}>] [--local|--global]`);
  console.log(`  gsd-cursor use <${PROFILE_NAMES.join('|')}> [--local|--global]`);
  console.log('  gsd-cursor uninstall [--local|--global]');
  console.log('  gsd-cursor status [--local|--global]');
  console.log(`  gsd-cursor doctor [--profile <${PROFILE_NAMES.join('|')}>] [--local|--global]`);
  console.log('  gsd-cursor list');
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const command = args._[0];
    switch (command) {
      case 'install':
        if (args._.length !== 1) throw new Error('Usage: gsd-cursor install [--profile <name>] [--local|--global]');
        return cmdInstall(args);
      case 'use': return cmdUse(args);
      case 'uninstall': return cmdUninstall(args);
      case 'list': return cmdList(args);
      case 'status': return cmdStatus(args);
      case 'doctor': return cmdDoctor(args);
      case 'help':
      case undefined:
        if (args.profile || args.scope || args._.length > 1) throw new Error('Use `gsd-cursor help` to view valid commands.');
        return printHelp();
      default:
        throw new Error(`Unknown command "${command}". Use gsd-cursor help.`);
    }
  } catch (error) {
    console.error(`gsd-cursor error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
