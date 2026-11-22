use crate::{
    allocations,
    settings::{EggChangerSettingsData, EggRuleOptions},
};
use axum::http::StatusCode;
use garde::Validate;
use serde::{Deserialize, Serialize};
use shared::{
    ApiError, GetState, State,
    database::DatabaseError,
    models::{
        BaseModel, ByUuid, UpdatableModel,
        egg_configuration::{EggConfiguration, EggConfigurationTarget},
        invalidate_cache_keys,
        nest_egg::NestEgg,
        nest_egg_variable::NestEggVariable,
        server::{
            GetServer, GetServerActivityLogger, Server, ServerInstallOptions, UpdateServerOptions,
        },
        server_variable::ServerVariable,
        user::GetPermissionManager,
    },
    response::{ApiResponse, ApiResponseResult},
};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

#[derive(ToSchema, Serialize)]
pub struct EggSummary {
    pub uuid: uuid::Uuid,
    pub name: compact_str::CompactString,
}

#[derive(ToSchema, Serialize)]
pub struct NamedValue {
    pub name: compact_str::CompactString,
    pub value: compact_str::CompactString,
}

#[derive(ToSchema, Serialize)]
pub struct TargetEgg {
    pub uuid: uuid::Uuid,
    pub name: compact_str::CompactString,
    pub description: Option<compact_str::CompactString>,
    pub nest_uuid: uuid::Uuid,
    pub nest_name: compact_str::CompactString,
    /// Predefined startup commands; the first one is the default.
    pub startup_commands: Vec<NamedValue>,
    /// Docker images; the first one is the default.
    pub docker_images: Vec<NamedValue>,
    pub allow_custom_startup_command: bool,
    /// Additional allocations the egg's deployment rules need. The server's existing allocations
    /// are reused where they fit, so fewer may actually be assigned.
    pub deployment_allocations: usize,
    /// Options of the rules allowing this switch.
    pub options: EggRuleOptions,
}

/// The server's egg before switching.
#[derive(ToSchema, Serialize)]
pub struct CurrentEgg {
    pub uuid: uuid::Uuid,
    pub name: compact_str::CompactString,
    pub description: Option<compact_str::CompactString>,
    pub nest_name: compact_str::CompactString,
}

#[derive(ToSchema, Serialize)]
pub struct IndexResponse {
    pub current_egg: CurrentEgg,
    pub eggs: Vec<TargetEgg>,
}

#[derive(ToSchema, Validate, Deserialize)]
pub struct ChangeEggPayload {
    #[garde(skip)]
    pub egg_uuid: uuid::Uuid,
    /// Defaults to the egg's default startup command.
    #[garde(length(chars, min = 1, max = 8192))]
    #[schema(min_length = 1, max_length = 8192)]
    pub startup: Option<compact_str::CompactString>,
    /// Defaults to the egg's first docker image.
    #[garde(length(chars, min = 2, max = 255))]
    #[schema(min_length = 2, max_length = 255)]
    pub image: Option<compact_str::CompactString>,
    /// Keep the current startup command instead of using one of the new egg's. Not allowed when
    /// the rule forces a startup update.
    #[serde(default)]
    #[garde(skip)]
    pub keep_startup: bool,
    /// Forced when the rule forces a reinstall.
    #[serde(default)]
    #[garde(skip)]
    pub reinstall: bool,
    /// Wipe all server files before reinstalling. Requires reinstalling; forced when the rule
    /// forces a truncate.
    #[serde(default)]
    #[garde(skip)]
    pub truncate_directory: bool,
}

#[derive(ToSchema, Serialize)]
pub struct AssignedAllocation {
    pub ip: String,
    pub port: i32,
}

#[derive(ToSchema, Serialize)]
pub struct ChangeEggResponse {
    pub egg: EggSummary,
    pub reinstalling: bool,
    /// Allocations newly assigned to the server by the egg's deployment rules.
    pub allocations: Vec<AssignedAllocation>,
}

async fn config(state: &State) -> Result<EggChangerSettingsData, anyhow::Error> {
    let settings = state.settings.get().await?;

    Ok(settings
        .find_extension_settings::<EggChangerSettingsData>()
        .cloned()
        .unwrap_or_default())
}

fn default_startup(egg: &NestEgg) -> Option<&compact_str::CompactString> {
    egg.startup_commands
        .get("Default")
        .or_else(|| egg.startup_commands.values().next())
}

/// Core permissions a switch needs besides `eggchanger.change`. The extension's permission never
/// stands in for a core one, even when an egg rule forces the reinstall.
fn core_permissions(
    reinstall: bool,
    keep_startup: bool,
    startup_predefined: bool,
) -> Vec<&'static str> {
    let mut permissions = Vec::new();
    if reinstall {
        permissions.push("settings.install");
    }
    if keep_startup || !startup_predefined {
        permissions.push("startup.command");
    }
    permissions
}

fn named(
    map: &indexmap::IndexMap<compact_str::CompactString, compact_str::CompactString>,
) -> Vec<NamedValue> {
    map.iter()
        .map(|(name, value)| NamedValue {
            name: name.clone(),
            value: value.clone(),
        })
        .collect()
}

mod get_index {
    use super::*;

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(IndexResponse)),
    ), params(("server" = uuid::Uuid, description = "The server ID")))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        server: GetServer,
    ) -> ApiResponseResult {
        permissions.has_server_permission("eggchanger.change")?;

        let config = config(&state).await?;

        let node = server.node.fetch_cached(&state.database).await?;
        let egg_configurations = EggConfiguration::all_cached(&state.database).await?;

        let mut eggs = Vec::new();
        for target in config.targets(server.egg.uuid) {
            // rules may still reference deleted eggs
            let Some(egg) = NestEgg::by_uuid_optional(&state.database, target.egg).await? else {
                continue;
            };
            let nest = egg.nest.fetch_cached(&state.database).await?;
            let configuration = EggConfiguration::merge(
                &egg_configurations,
                &EggConfigurationTarget::new(&egg, &node),
            );

            eggs.push(TargetEgg {
                uuid: egg.uuid,
                name: egg.name.clone(),
                description: egg.description.clone(),
                nest_uuid: nest.uuid,
                nest_name: nest.name,
                startup_commands: named(&egg.startup_commands),
                docker_images: named(&egg.docker_images),
                allow_custom_startup_command: configuration
                    .config_startup
                    .as_ref()
                    .is_some_and(|c| c.allow_custom_startup_command),
                deployment_allocations: if target.options.reassign_allocations {
                    configuration
                        .config_allocations
                        .as_ref()
                        .map_or(0, |c| c.deployment.additional.len())
                } else {
                    0
                },
                options: target.options,
            });
        }

        ApiResponse::new_serialized(IndexResponse {
            current_egg: CurrentEgg {
                uuid: server.egg.uuid,
                name: server.egg.name.clone(),
                description: server.egg.description.clone(),
                nest_name: server.nest.name.clone(),
            },
            eggs,
        })
        .ok()
    }
}

mod post_change {
    use super::*;

    #[utoipa::path(post, path = "/", responses(
        (status = OK, body = inline(ChangeEggResponse)),
        (status = BAD_REQUEST, body = ApiError),
        (status = FORBIDDEN, body = ApiError),
        (status = CONFLICT, body = ApiError),
        (status = EXPECTATION_FAILED, body = ApiError),
    ), params(("server" = uuid::Uuid, description = "The server ID")), request_body = inline(ChangeEggPayload))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        server: GetServer,
        activity_logger: GetServerActivityLogger,
        shared::Payload(data): shared::Payload<ChangeEggPayload>,
    ) -> ApiResponseResult {
        permissions.has_server_permission("eggchanger.change")?;

        if let Err(errors) = shared::utils::validate_data(&data) {
            return ApiResponse::new_serialized(ApiError::new_strings_value(errors))
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
        }

        let config = config(&state).await?;
        let Some(options) = config
            .targets(server.egg.uuid)
            .into_iter()
            .find(|t| t.egg == data.egg_uuid)
            .map(|t| t.options)
        else {
            return ApiResponse::error("This server cannot switch to the selected egg.")
                .with_status(StatusCode::FORBIDDEN)
                .ok();
        };

        let reinstall = data.reinstall || options.force_reinstall;
        let truncate_directory = reinstall && (data.truncate_directory || options.force_truncate);

        if data.truncate_directory && !reinstall {
            return ApiResponse::error("Files can only be wiped when reinstalling.")
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
        }
        if data.keep_startup && options.force_startup_update {
            return ApiResponse::error(
                "Switching to the selected egg always updates the startup command.",
            )
            .with_status(StatusCode::BAD_REQUEST)
            .ok();
        }
        if data.keep_startup && data.startup.is_some() {
            return ApiResponse::error(
                "A startup command can't be given when keeping the current one.",
            )
            .with_status(StatusCode::BAD_REQUEST)
            .ok();
        }
        if reinstall && server.status.is_some() {
            return ApiResponse::error("The server cannot be reinstalled in its current state.")
                .with_status(StatusCode::CONFLICT)
                .ok();
        }

        let Some(egg) = NestEgg::by_uuid_optional(&state.database, data.egg_uuid).await? else {
            return ApiResponse::error("egg not found")
                .with_status(StatusCode::NOT_FOUND)
                .ok();
        };
        let node = server.node.fetch_cached(&state.database).await?;
        let egg_configuration = EggConfiguration::merged_for_target(
            &state.database,
            &EggConfigurationTarget::new(&egg, &node),
        )
        .await?;

        // A kept command goes through the same checks as a custom one: the new egg may not allow
        // it, and only users who may change the startup command can keep or write their own.
        let chosen_startup = if data.keep_startup {
            Some(server.startup.clone())
        } else {
            data.startup
        };
        let startup_predefined = chosen_startup
            .as_ref()
            .is_none_or(|command| egg.startup_commands.values().any(|c| c == command));

        for permission in core_permissions(reinstall, data.keep_startup, startup_predefined) {
            permissions.has_server_permission(permission)?;
        }

        let startup = match chosen_startup {
            Some(command) => {
                let custom_allowed = egg_configuration
                    .config_startup
                    .as_ref()
                    .is_some_and(|c| c.allow_custom_startup_command);
                if !startup_predefined && !custom_allowed {
                    return ApiResponse::error(if data.keep_startup {
                        "The selected egg doesn't allow custom startup commands, so the current one can't be kept."
                    } else {
                        "Custom startup commands are not enabled for the selected egg."
                    })
                    .with_status(StatusCode::EXPECTATION_FAILED)
                    .ok();
                }
                command
            }
            None => match default_startup(&egg) {
                Some(command) => command.clone(),
                None => {
                    return ApiResponse::error("The selected egg has no startup command.")
                        .with_status(StatusCode::EXPECTATION_FAILED)
                        .ok();
                }
            },
        };

        let image = match data.image {
            Some(image) if egg.docker_images.values().any(|i| *i == image) => image,
            Some(_) => {
                return ApiResponse::error(
                    "The selected docker image is not available for this egg.",
                )
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
            }
            None => match egg.docker_images.values().next() {
                Some(image) => image.clone(),
                None => {
                    return ApiResponse::error("The selected egg has no docker image.")
                        .with_status(StatusCode::EXPECTATION_FAILED)
                        .ok();
                }
            },
        };

        let mut server = server.0;
        let from_egg = EggSummary {
            uuid: server.egg.uuid,
            name: server.egg.name.clone(),
        };

        let deployment = match &egg_configuration.config_allocations {
            Some(c) if options.reassign_allocations => {
                Some(allocations::resolve(&state, &server, &c.deployment).await?)
            }
            _ => None,
        };

        let egg_variables = NestEggVariable::all_by_egg_uuid(&state.database, egg.uuid).await?;

        let kept_startup = data.keep_startup;

        // Run to completion even if the client disconnects: once the switch is committed, the
        // node sync and the reinstall must follow.
        tokio::spawn(async move {
            let new_allocations = deployment.as_ref().map_or(0, |d| d.new_allocations.len());
            // Same lock the core self-assign route holds while it counts and adds allocations.
            let allocations_lock = if new_allocations > 0 {
                Some(
                    state
                        .cache
                        .lock(
                            format!("servers::{}::allocations", server.uuid),
                            Some(30),
                            Some(5000),
                        )
                        .await?,
                )
            } else {
                None
            };

            let mut transaction = state.database.write().begin().await?;

            // Two concurrent changes must not both pass the rule check against the old egg.
            let (locked_egg, allocation_limit): (uuid::Uuid, i32) = sqlx::query_as(
                "SELECT egg_uuid, allocation_limit FROM servers WHERE uuid = $1 FOR UPDATE",
            )
            .bind(server.uuid)
            .fetch_one(&mut *transaction)
            .await?;
            if locked_egg != from_egg.uuid {
                transaction.rollback().await?;
                return ApiResponse::error(
                    "The server's egg was changed in the meantime, reload and try again.",
                )
                .with_status(StatusCode::CONFLICT)
                .ok();
            }

            if new_allocations > 0 {
                let current: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM server_allocations WHERE server_uuid = $1",
                )
                .bind(server.uuid)
                .fetch_one(&mut *transaction)
                .await?;
                if !allocations::within_limit(current, new_allocations, allocation_limit) {
                    transaction.rollback().await?;
                    return ApiResponse::error(format!(
                        "The selected egg needs {new_allocations} more allocation(s), which would exceed this server's limit of {allocation_limit}."
                    ))
                    .with_status(StatusCode::EXPECTATION_FAILED)
                    .ok();
                }
            }

            server
                .update_with_transaction(
                    &state,
                    UpdateServerOptions {
                        egg_uuid: Some(egg.uuid),
                        startup: Some(startup.clone()),
                        image: Some(image.clone()),
                        ..Default::default()
                    },
                    &mut transaction,
                )
                .await?;

            // variables start from the new egg's defaults
            sqlx::query("DELETE FROM server_variables WHERE server_uuid = $1")
                .bind(server.uuid)
                .execute(&mut *transaction)
                .await?;

            if let Some(deployment) = &deployment {
                for allocation in &deployment.new_allocations {
                    let inserted = sqlx::query(
                        "INSERT INTO server_allocations (server_uuid, allocation_uuid) VALUES ($1, $2)",
                    )
                    .bind(server.uuid)
                    .bind(allocation.uuid)
                    .execute(&mut *transaction)
                    .await;

                    if let Err(err) = inserted {
                        transaction.rollback().await?;
                        if DatabaseError::from(err).is_unique_violation() {
                            return ApiResponse::error(
                                "An allocation was taken while switching, please try again.",
                            )
                            .with_status(StatusCode::CONFLICT)
                            .ok();
                        }
                        return ApiResponse::error("failed to assign allocations")
                            .with_status(StatusCode::INTERNAL_SERVER_ERROR)
                            .ok();
                    }
                }

                for (env, value) in &deployment.variables {
                    if let Some(variable) = egg_variables.iter().find(|v| v.env_variable == *env) {
                        ServerVariable::create_with_transaction(
                            &mut transaction,
                            server.uuid,
                            variable.uuid,
                            value,
                        )
                        .await?;
                    }
                }
            }

            transaction.commit().await?;
            drop(allocations_lock);
            invalidate_cache_keys(&state.database, &server.cache_invalidation_keys()).await;

            let assigned: Vec<AssignedAllocation> = deployment
                .iter()
                .flat_map(|d| &d.new_allocations)
                .map(|a| AssignedAllocation {
                    ip: a.ip.ip().to_string(),
                    port: a.port,
                })
                .collect();

            activity_logger
                .log(
                    "server:eggchanger.change",
                    serde_json::json!({
                        "from_egg": { "uuid": from_egg.uuid, "name": from_egg.name },
                        "to_egg": { "uuid": egg.uuid, "name": egg.name },
                        "startup": startup,
                        "image": image,
                        "reinstall": reinstall,
                        "truncate_directory": truncate_directory,
                        "kept_startup": kept_startup,
                        "options": options,
                        "allocations": assigned
                            .iter()
                            .map(|a| format!("{}:{}", a.ip, a.port))
                            .collect::<Vec<_>>(),
                    }),
                )
                .await;

            // re-fetch so the node gets the new nest, allocations and variables
            let server = Server::by_uuid(&state.database, server.uuid).await?;

            if reinstall {
                if let Err(err) = server.clone().sync(&state).await {
                    tracing::warn!(server = %server.uuid, "failed to sync server after egg change: {err:#}");
                    return ApiResponse::error(
                        "The egg was changed, but the node could not be reached to reinstall the server.",
                    )
                    .with_status(StatusCode::BAD_GATEWAY)
                    .ok();
                }

                server
                    .install_with_options(
                        &state,
                        ServerInstallOptions {
                            truncate_directory,
                            ..Default::default()
                        },
                    )
                    .await?;
            } else {
                server.batch_sync(&state).await;
            }

            ApiResponse::new_serialized(ChangeEggResponse {
                egg: EggSummary {
                    uuid: egg.uuid,
                    name: egg.name,
                },
                reinstalling: reinstall,
                allocations: assigned,
            })
            .ok()
        })
        .await?
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get_index::route, post_change::route))
        .with_state(state.clone())
}

#[cfg(test)]
mod tests {
    use super::core_permissions;

    #[test]
    fn any_reinstall_needs_the_core_reinstall_permission() {
        assert_eq!(core_permissions(true, false, true), ["settings.install"]);
        assert!(core_permissions(false, false, true).is_empty());
    }

    #[test]
    fn custom_or_kept_startup_needs_the_core_startup_permission() {
        assert_eq!(core_permissions(false, false, false), ["startup.command"]);
        assert_eq!(core_permissions(false, true, true), ["startup.command"]);
        assert_eq!(
            core_permissions(true, true, false),
            ["settings.install", "startup.command"]
        );
    }
}
