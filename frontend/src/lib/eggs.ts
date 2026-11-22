// Browsing and switching logic shared by the settings section and the page. Kept free of React and
// panel imports so it can be tested with `node --test`.
import type { TargetEgg } from '../api/client.ts';

/** Same default as the backend: the command named "Default", else the first one. */
export function defaultStartup(egg: Pick<TargetEgg, 'startup_commands'>): string {
  const command = egg.startup_commands.find((c) => c.name === 'Default') ?? egg.startup_commands[0];
  return command?.value ?? '';
}

export interface NestOption {
  uuid: string;
  name: string;
  count: number;
}

/** The nests of `eggs` in the order they first appear, with how many eggs each has. */
export function nestsOf(eggs: Pick<TargetEgg, 'nest_uuid' | 'nest_name'>[]): NestOption[] {
  const nests = new Map<string, NestOption>();
  for (const egg of eggs) {
    const nest = nests.get(egg.nest_uuid);
    if (nest) {
      nest.count += 1;
    } else {
      nests.set(egg.nest_uuid, { uuid: egg.nest_uuid, name: egg.nest_name, count: 1 });
    }
  }
  return [...nests.values()];
}

type Searchable = Pick<TargetEgg, 'name' | 'nest_uuid' | 'nest_name' | 'description'>;

/** Eggs in `nest` (all when null) whose name, nest or description contains every word of `query`. */
export function filterEggs<T extends Searchable>(eggs: T[], query: string, nest: string | null): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return eggs.filter((egg) => {
    if (nest && egg.nest_uuid !== nest) return false;
    const haystack = `${egg.name} ${egg.nest_name} ${egg.description ?? ''}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export interface ChangeChoices {
  /** False keeps the current startup command. */
  updateStartup: boolean;
  startup: string;
  image: string;
  reinstall: boolean;
  wipe: boolean;
  /** Create a backup first; only honoured when the backup is available. */
  backup: boolean;
}

/** The choices after the options of the egg's rules are applied, as the backend applies them. */
export function effectiveChoices(egg: Pick<TargetEgg, 'options'>, choices: ChangeChoices) {
  const updatingStartup = choices.updateStartup || egg.options.force_startup_update;
  const reinstalling = choices.reinstall || egg.options.force_reinstall;
  const wiping = reinstalling && (choices.wipe || egg.options.force_truncate);
  const backingUp = choices.backup || egg.options.force_backup;
  return { updatingStartup, reinstalling, wiping, backingUp };
}

/**
 * Why the user can't switch to `egg` at all, or null when they can. Like the backend, a reinstall
 * the rule forces still needs the core `settings.install` permission, and a forced backup needs a
 * backup the user can create (`backupUnavailable` says why not).
 */
export function switchBlocker(
  egg: Pick<TargetEgg, 'options'>,
  canReinstall: boolean,
  backupUnavailable: string | null,
): string | null {
  if (egg.options.force_reinstall && !canReinstall) {
    return 'This switch always reinstalls the server, which needs the reinstall permission.';
  }
  if (egg.options.force_backup && backupUnavailable) {
    return `This switch always creates a backup first. ${backupUnavailable}`;
  }
  return null;
}

/** Name of the backup made before switching to `eggName`, e.g. "Before egg change to Paper (2026-11-22 14:05)". */
export function backupName(eggName: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const suffix = ` (${stamp})`;
  // core allows 255 characters
  return `Before egg change to ${eggName}`.slice(0, 255 - suffix.length) + suffix;
}

export type EffectTone = 'info' | 'warning' | 'danger';

export interface Effect {
  key: 'egg' | 'backup' | 'startup' | 'image' | 'variables' | 'allocations' | 'install';
  tone: EffectTone;
  text: string;
  /** Set by the host's rule, the user can't change it. */
  forced: boolean;
}

/** Plain-language list of what switching does, matching the backend's `POST /egg-changer`. */
export function changeEffects(
  current: { eggName: string; image: string },
  egg: TargetEgg,
  choices: ChangeChoices,
): Effect[] {
  const { updatingStartup, reinstalling, wiping, backingUp } = effectiveChoices(egg, choices);
  const effects: Effect[] = [
    {
      key: 'egg',
      tone: 'info',
      text: `The server switches from ${current.eggName} to ${egg.name}.`,
      forced: false,
    },
  ];

  if (backingUp) {
    effects.push({
      key: 'backup',
      tone: 'info',
      text: 'A backup of the server is created first. Nothing changes until it has finished successfully; if it fails, the egg stays as it is.',
      forced: egg.options.force_backup,
    });
  }

  if (updatingStartup) {
    const preset = egg.startup_commands.find((c) => c.value === choices.startup);
    effects.push({
      key: 'startup',
      tone: 'info',
      text: preset
        ? `The startup command is replaced with ${egg.name}'s "${preset.name}" command.`
        : 'The startup command is replaced with your custom command.',
      forced: egg.options.force_startup_update,
    });
  } else {
    effects.push({ key: 'startup', tone: 'info', text: 'The current startup command is kept.', forced: false });
  }

  const imageName = egg.docker_images.find((i) => i.value === choices.image)?.name ?? choices.image;
  effects.push({
    key: 'image',
    tone: 'info',
    text:
      choices.image === current.image
        ? `The Docker image stays ${imageName}.`
        : `The Docker image changes to ${imageName}.`,
    forced: false,
  });

  effects.push({
    key: 'variables',
    tone: 'warning',
    text: `Every startup variable is reset to ${egg.name}'s defaults. Values you changed are lost.`,
    forced: false,
  });

  if (egg.deployment_allocations > 0) {
    const n = egg.deployment_allocations;
    effects.push({
      key: 'allocations',
      tone: 'info',
      text: `Up to ${n} additional port${n === 1 ? ' is' : 's are'} assigned for ${egg.name}. Ports the server already has are reused where they fit.`,
      forced: true,
    });
  }

  if (!reinstalling) {
    effects.push({
      key: 'install',
      tone: 'info',
      text: `Nothing is reinstalled: all files stay and ${egg.name}'s install script does not run. Restart the server to apply the change.`,
      forced: false,
    });
  } else if (!wiping) {
    effects.push({
      key: 'install',
      tone: 'warning',
      text: `The server is stopped and ${egg.name}'s install script runs. Files are kept, but the script may overwrite some of them.`,
      forced: egg.options.force_reinstall,
    });
  } else {
    effects.push({
      key: 'install',
      tone: 'danger',
      text: `The server is stopped and all of its files are deleted before ${egg.name}'s install script runs. This cannot be undone.`,
      forced: egg.options.force_truncate,
    });
  }

  return effects;
}
