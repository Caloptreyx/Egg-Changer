# Egg Changer

A [Calagopus Panel](https://calagopus.com) extension that lets users switch their server to another
egg themselves, for example from Minecraft Java to Minecraft Bedrock, within rules you set.

Package name: `dev.caloptreyx.eggchanger` · Requires panel `>=1.2.3`

## What your users get

- A **Change Egg** card on the server's **Settings** page, shown when the user may change eggs and
  a rule allows at least one other egg for the server.
- Pick the new egg (grouped by nest), its startup command and docker image. Custom startup
  commands are only offered when the new egg's configuration allows them.
- Optionally **reinstall** the server with the new egg's install script, and optionally **wipe all
  files** first (only together with reinstalling).
- Startup variables are reset to the new egg's defaults.

## What you get

- **Egg rules**: servers on a rule's source eggs may switch to its target eggs, picked from a
  nest/egg tree. A server whose egg matches no rule can't switch. Select the same eggs on both
  sides to let servers switch freely within a group.
- **Allocation deployment** (on by default): switching applies the new egg's allocation deployment
  rules from its egg configuration. The server keeps its primary allocation; each additional
  allocation rule (random, port range, or relative to the primary port) is satisfied by an
  allocation the server already has when one fits, otherwise by a free allocation on the server's
  node and IP. Ports are written to the variables the rules assign them to.
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
   to* are the eggs those servers may switch to.
2. **Allocations** - turn applying the new egg's allocation deployment rules off if servers should
   keep exactly the allocations they have.
3. Give subusers the `eggchanger.change` permission where wanted. Owners and admins always have it.

Permissions: server `eggchanger.change` (reinstalling while switching also needs
`settings.install`), admin `extensions.eggchanger.read|write`.

## API

- `GET /api/client/servers/{server}/egg-changer` - the current egg and the eggs the server may
  switch to.
- `POST /api/client/servers/{server}/egg-changer` -
  `{ egg_uuid, startup?, image?, reinstall?, truncate_directory? }`; `startup` and `image` default
  to the egg's default startup command and first docker image.
- `GET|PUT /api/admin/extensions/dev.caloptreyx.eggchanger/settings`,
  `POST /api/admin/extensions/dev.caloptreyx.eggchanger/egg-rules`,
  `PUT|DELETE /api/admin/extensions/dev.caloptreyx.eggchanger/egg-rules/{id}`.

## License

MIT
