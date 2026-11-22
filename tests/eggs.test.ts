import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TargetEgg } from '../frontend/src/api/client.ts';
import {
  type ChangeChoices,
  changeEffects,
  defaultStartup,
  type Effect,
  filterEggs,
  nestsOf,
  switchBlocker,
} from '../frontend/src/lib/eggs.ts';

function egg(overrides: Partial<TargetEgg> = {}): TargetEgg {
  return {
    uuid: 'bedrock',
    name: 'Bedrock',
    description: 'Minecraft Bedrock Edition server',
    nest_uuid: 'minecraft',
    nest_name: 'Minecraft',
    startup_commands: [
      { name: 'Legacy', value: './bedrock_server --legacy' },
      { name: 'Default', value: './bedrock_server' },
    ],
    docker_images: [
      { name: 'Debian', value: 'ghcr.io/yolks:debian' },
      { name: 'Ubuntu', value: 'ghcr.io/yolks:ubuntu' },
    ],
    allow_custom_startup_command: false,
    deployment_allocations: 0,
    options: { force_startup_update: false, force_reinstall: false, force_truncate: false, reassign_allocations: true },
    ...overrides,
  };
}

const current = { eggName: 'Paper', image: 'ghcr.io/yolks:java_21' };

function choices(overrides: Partial<ChangeChoices> = {}): ChangeChoices {
  return {
    updateStartup: true,
    startup: './bedrock_server',
    image: 'ghcr.io/yolks:debian',
    reinstall: false,
    wipe: false,
    ...overrides,
  };
}

function effect(effects: Effect[], key: Effect['key']) {
  const found = effects.find((e) => e.key === key);
  assert.ok(found, `no ${key} effect`);
  return found;
}

test('the default startup command is the one named Default, else the first', () => {
  assert.equal(defaultStartup(egg()), './bedrock_server');
  assert.equal(defaultStartup(egg({ startup_commands: [{ name: 'Fast', value: './fast' }] })), './fast');
  assert.equal(defaultStartup(egg({ startup_commands: [] })), '');
});

test('nests keep their first-seen order and count their eggs', () => {
  const eggs = [
    egg({ uuid: 'a', nest_uuid: 'mc', nest_name: 'Minecraft' }),
    egg({ uuid: 'b', nest_uuid: 'rust', nest_name: 'Rust' }),
    egg({ uuid: 'c', nest_uuid: 'mc', nest_name: 'Minecraft' }),
  ];
  assert.deepEqual(nestsOf(eggs), [
    { uuid: 'mc', name: 'Minecraft', count: 2 },
    { uuid: 'rust', name: 'Rust', count: 1 },
  ]);
});

test('search matches every word across name, nest and description, within the picked nest', () => {
  const eggs = [
    egg({ uuid: 'bedrock' }),
    egg({ uuid: 'paper', name: 'Paper', description: 'High performance Java server' }),
    egg({ uuid: 'rust', name: 'Rust', nest_uuid: 'rust', nest_name: 'Rust', description: null }),
  ];
  const uuids = (query: string, nest: string | null = null) => filterEggs(eggs, query, nest).map((e) => e.uuid);

  assert.deepEqual(uuids(''), ['bedrock', 'paper', 'rust']);
  assert.deepEqual(uuids('  JAVA  '), ['paper']);
  assert.deepEqual(uuids('minecraft server'), ['bedrock', 'paper']);
  assert.deepEqual(uuids('minecraft rust'), []);
  assert.deepEqual(uuids('', 'rust'), ['rust']);
  assert.deepEqual(uuids('paper', 'rust'), []);
});

test('a plain switch keeps files, resets variables and names the new command and image', () => {
  const effects = changeEffects(current, egg(), choices());

  assert.equal(effect(effects, 'egg').text, 'The server switches from Paper to Bedrock.');
  assert.match(effect(effects, 'startup').text, /Bedrock's "Default" command/);
  assert.equal(effect(effects, 'image').text, 'The Docker image changes to Debian.');
  assert.equal(effect(effects, 'variables').tone, 'warning');
  assert.equal(effect(effects, 'install').tone, 'info');
  assert.match(effect(effects, 'install').text, /all files stay/);
  assert.ok(!effects.some((e) => e.key === 'allocations'));
});

test('keeping the startup command, a custom command and an unchanged image are described as such', () => {
  assert.equal(
    effect(changeEffects(current, egg(), choices({ updateStartup: false })), 'startup').text,
    'The current startup command is kept.',
  );
  assert.match(effect(changeEffects(current, egg(), choices({ startup: './custom' })), 'startup').text, /custom/);
  assert.equal(
    effect(changeEffects({ ...current, image: 'ghcr.io/yolks:ubuntu' }, egg(), choices({ image: 'ghcr.io/yolks:ubuntu' })), 'image')
      .text,
    'The Docker image stays Ubuntu.',
  );
});

test('rule options override the choices like the backend does', () => {
  const forced = egg({
    options: { force_startup_update: true, force_reinstall: true, force_truncate: true, reassign_allocations: true },
    deployment_allocations: 2,
  });
  const effects = changeEffects(current, forced, choices({ updateStartup: false, reinstall: false, wipe: false }));

  assert.match(effect(effects, 'startup').text, /replaced/);
  assert.equal(effect(effects, 'startup').forced, true);
  assert.equal(effect(effects, 'install').tone, 'danger');
  assert.equal(effect(effects, 'install').forced, true);
  assert.match(effect(effects, 'allocations').text, /Up to 2 additional ports are assigned/);
});

test('wiping only happens together with a reinstall', () => {
  const noReinstall = changeEffects(current, egg(), choices({ wipe: true }));
  assert.equal(effect(noReinstall, 'install').tone, 'info');

  const truncateRuleOnly = egg({
    options: { force_startup_update: false, force_reinstall: false, force_truncate: true, reassign_allocations: true },
  });
  assert.equal(effect(changeEffects(current, truncateRuleOnly, choices()), 'install').tone, 'info');
  assert.equal(effect(changeEffects(current, truncateRuleOnly, choices({ reinstall: true })), 'install').tone, 'danger');

  const reinstall = changeEffects(current, egg(), choices({ reinstall: true }));
  assert.equal(effect(reinstall, 'install').tone, 'warning');
  assert.match(effect(reinstall, 'install').text, /Files are kept/);
});

test('a reinstall the rule forces still needs the core reinstall permission', () => {
  const forced = egg({
    options: { force_startup_update: false, force_reinstall: true, force_truncate: false, reassign_allocations: true },
  });
  assert.match(switchBlocker(forced, false) ?? '', /reinstall permission/);
  assert.equal(switchBlocker(forced, true), null);
  assert.equal(switchBlocker(egg(), false), null);
});
