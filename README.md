# Egg Changer

A [Calagopus Panel](https://calagopus.com) extension that lets users switch their server to another
egg themselves, for example from Minecraft Java to Minecraft Bedrock, within rules you set.

Package name: `dev.caloptreyx.eggchanger` · Requires panel `>=1.2.8`

## What your users get

- **Change Egg** where the admin's *Placement* puts it: a section at the bottom of the server's
  **Settings** page (the default, as in 1.0), a **Change Egg** page in the server sidebar, or both.
  The Settings section only appears when the user may change eggs and a rule allows at least one
  other egg for the server; the page says so when no egg is available.
- The current egg, and the eggs the server may switch to as cards with their nest, description and
  what the switch forces (reinstall, file wipe, new startup command, extra ports). Search and a
  nest filter appear once there are more than six eggs or more than one nest.
- Pick a card, then its startup command and docker image, or keep the current startup command.
  Custom startup commands are only offered when the new egg's configuration allows them.
- Optionally **reinstall** the server with the new egg's install script, and optionally **delete
  all files** first (only together with reinstalling, and only after ticking a confirmation).
  Options a rule forces are shown switched on and locked.
- Before switching, a **What happens** list spells out the switch: the startup command and docker
  image it applies, that startup variables are reset to the new egg's defaults, how many ports may
  be added, and whether files stay, the install script runs or every file is deleted.
- Works on phones (the dialog goes full-screen) and follows the panel theme (Mint, Zoron, ...).

## What you get

- **Egg rules**: servers on a rule's source eggs may switch to its target eggs, picked from a
  nest/egg tree. A server whose egg matches no rule can't switch. Select the same eggs on both
  sides to let servers switch freely within a group.
- **Rule options**, applied when a server switches to one of the rule's target eggs:
  - **Require a new startup command** - users can't hold on to their old startup command; one of
    the target egg's commands is always applied. Without it they may keep theirs.
  - **Always reinstall** - every switch runs the target egg's installation script.
  - **Always wipe files on reinstall** - whenever the switch reinstalls the server, its files are
    erased first.
  - **Match allocations to the new egg** (on for new rules) - applies the new egg's allocation
    deployment settings from Egg Configurations. The server keeps its primary allocation; each
    additional allocation rule (random, port range, or relative to the primary port) is satisfied
    by an allocation the server already has when one fits, otherwise by a free allocation on the
    server's node and IP. Ports are written to the variables the rules assign them to.

  When several rules allow the same switch, every option enabled in any of them applies.
- Every switch is recorded in the server's activity log as `server:eggchanger.change` with the old
  and new egg, startup command, image, reinstall options and newly assigned allocations.

## Installation

Download `dev_caloptreyx_eggchanger.c7s.zip` and either upload it under **Admin → Extensions** or
drop it into your heavy image's `build/extensions/` directory and `docker compose restart web`.
Extensions require the `:heavy` panel image - see the
[Calagopus docs](https://calagopus.com/docs/panel/extensions/installing-extensions).

## Configuration

**Admin → Extensions → Egg Changer → Configure**

1. **Egg Rules** - add at least one rule. *Servers on* are the eggs the rule applies to, *Can switch
   to* are the eggs those servers may switch to, *Options* control what a switch does.
2. **Placement** - *Settings page* (default), *Own page* or *Both*. Users see a change after
   reloading the panel. Egg Configurations can hide or reorder the page per egg like any sidebar
   page.
3. Give subusers the `eggchanger.change` permission where wanted. Owners and admins always have it.

Permissions: server `eggchanger.change`, which covers reinstalls and wipes a rule forces; choosing
to reinstall also needs `settings.install`. Admin `extensions.eggchanger.read|write`.

## API

- `GET /api/client/servers/{server}/egg-changer` - the current egg and the eggs the server may
  switch to.
- `POST /api/client/servers/{server}/egg-changer` -
  `{ egg_uuid, startup?, image?, keep_startup?, reinstall?, truncate_directory? }`; `startup` and
  `image` default to the egg's default startup command and first docker image.
- `GET|PUT /api/admin/extensions/dev.caloptreyx.eggchanger/settings` - `PUT` takes
  `{ placement: "settings" | "page" | "both" }`,
  `POST /api/admin/extensions/dev.caloptreyx.eggchanger/egg-rules`,
  `PUT|DELETE /api/admin/extensions/dev.caloptreyx.eggchanger/egg-rules/{id}` - rules are
  `{ eggs, allowed_eggs, options: { force_startup_update, force_reinstall, force_truncate,
  reassign_allocations } }`.

## License

MIT
