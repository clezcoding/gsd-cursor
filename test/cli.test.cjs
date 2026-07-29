'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'gsd-cursor.cjs');
const DATA = require(path.join(ROOT, 'lib', 'profiles.json'));

function temporaryProject() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cursor-test-'));
  fs.mkdirSync(path.join(directory, '.planning'), { recursive: true });
  return directory;
}

function run(directory, args, environment = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ...environment }
  });
}

function configFile(directory) {
  return path.join(directory, '.planning', 'config.json');
}

function readConfig(directory) {
  return JSON.parse(fs.readFileSync(configFile(directory), 'utf8'));
}

test('catalog contains six complete phase-aware profiles', () => {
  assert.deepEqual(Object.keys(DATA.profiles), ['max', 'hybrid', 'value', 'budget', 'frontier', 'openweight']);
  for (const profile of Object.values(DATA.profiles)) {
    assert.deepEqual(Object.keys(profile.models), DATA.phaseKeys);
    assert.deepEqual(Object.keys(profile.overrides), ['opus', 'sonnet', 'haiku']);
  }
  assert.equal(DATA.profiles.frontier.overrides.sonnet, 'composer-2.5');
});

test('each profile writes current and legacy GSD tier maps', (t) => {
  for (const name of Object.keys(DATA.profiles)) {
    const directory = temporaryProject();
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const result = run(directory, ['install', '--profile', name, '--local']);
    assert.equal(result.status, 0, result.stderr);
    const config = readConfig(directory);
    assert.deepEqual(
      config.model_policy.runtime_tiers.cursor,
      Object.fromEntries(Object.entries(DATA.profiles[name].overrides).map(([tier, model]) => [tier, { model }]))
    );
    assert.deepEqual(config.model_profile_overrides.cursor, DATA.profiles[name].overrides);
    assert.deepEqual(
      Object.fromEntries(DATA.phaseKeys.map((phase) => [phase, config.models[phase]])),
      DATA.profiles[name].models
    );
    assert.deepEqual(config.model_overrides || {}, DATA.profiles[name].agentOverrides);
    assert.equal(config._gsd_cursor.profile, name);
    assert.ok(config._gsd_cursor.snapshot);
  }
});

test('switch removes stale managed overrides and uninstall restores exact prior values', (t) => {
  const directory = temporaryProject();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const original = {
    runtime: 'api',
    model_profile: 'custom',
    model_profile_overrides: { cursor: { opus: 'my-cursor-model' }, api: { opus: 'api-model' } },
    model_policy: { runtime_tiers: { cursor: { opus: 'my-policy-model' }, api: { opus: 'api-policy-model' } }, routing: { enabled: true } },
    models: { planning: 'custom-planning', custom_phase: 'keep-me' },
    model_overrides: { 'gsd-verifier': 'my-verifier', 'my-agent': 'keep-me' },
    unrelated: { preserved: true }
  };
  fs.writeFileSync(configFile(directory), `${JSON.stringify(original, null, 2)}\n`);

  let result = run(directory, ['install', '--profile', 'hybrid', '--local']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${configFile(directory)}.gsd-cursor.bak`, 'utf8')), original);
  assert.equal(readConfig(directory).model_overrides['gsd-verifier'], 'gpt-5.6-sol-high');

  result = run(directory, ['use', 'frontier', '--local']);
  assert.equal(result.status, 0, result.stderr);
  const frontier = readConfig(directory);
  assert.equal(frontier.model_policy.runtime_tiers.cursor.sonnet.model, 'composer-2.5');
  assert.equal(frontier.model_overrides['gsd-executor'], 'cursor-grok-4.5-medium');
  assert.equal(frontier.model_overrides['gsd-verifier'], undefined);

  result = run(directory, ['uninstall', '--local']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readConfig(directory), original);
});

test('invalid JSON is rejected without modifying the file', (t) => {
  const directory = temporaryProject();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const invalid = '{ "runtime": "cursor",';
  fs.writeFileSync(configFile(directory), invalid);
  const result = run(directory, ['install', '--local']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON/);
  assert.equal(fs.readFileSync(configFile(directory), 'utf8'), invalid);
  assert.equal(fs.existsSync(`${configFile(directory)}.gsd-cursor.bak`), false);
});

test('doctor validates exact model IDs with the local Cursor catalog', (t) => {
  const directory = temporaryProject();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fakeAgent = path.join(directory, 'agent-fixture.cjs');
  const models = [...new Set([
    ...Object.values(DATA.profiles.frontier.overrides),
    ...Object.values(DATA.profiles.frontier.agentOverrides)
  ])];
  fs.writeFileSync(fakeAgent, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(models.join('\n'))});\n`);
  fs.chmodSync(fakeAgent, 0o755);

  const result = run(directory, ['doctor', '--profile', 'frontier'], { GSD_CURSOR_AGENT_BIN: fakeAgent });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All 5 model IDs are available/);
});

test('unknown options fail instead of being treated as commands', (t) => {
  const directory = temporaryProject();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = run(directory, ['install', '--locla']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option/);
});
