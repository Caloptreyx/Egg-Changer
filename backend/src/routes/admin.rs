use crate::settings::{EggChangerSettingsData, EggRule, EggRuleOptions, Placement};
use axum::{extract::Path, http::StatusCode};
use serde::{Deserialize, Serialize};
use shared::{
    GetState, State,
    models::{
        BaseModel, admin_activity::GetAdminActivityLogger, nest::Nest, nest_egg::NestEgg,
        user::GetPermissionManager,
    },
    response::{ApiResponse, ApiResponseResult},
};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

#[derive(ToSchema, Serialize)]
pub struct EmptyResponse {}

#[derive(ToSchema, Serialize)]
pub struct EggItem {
    pub uuid: uuid::Uuid,
    pub name: compact_str::CompactString,
    pub nest_uuid: uuid::Uuid,
    pub nest_name: compact_str::CompactString,
}

#[derive(ToSchema, Serialize)]
pub struct SettingsResponse {
    pub egg_rules: Vec<EggRule>,
    pub placement: Placement,
    pub eggs: Vec<EggItem>,
}

#[derive(ToSchema, Deserialize)]
pub struct SettingsPayload {
    /// `settings`, `page` or `both`; anything else is rejected.
    pub placement: Placement,
}

#[derive(ToSchema, Deserialize)]
pub struct EggRulePayload {
    pub eggs: Vec<uuid::Uuid>,
    pub allowed_eggs: Vec<uuid::Uuid>,
    #[serde(default)]
    pub options: EggRuleOptions,
}

impl EggRulePayload {
    /// The rule with deduplicated egg lists, or an error response when either side is empty.
    fn into_rule(self, id: uuid::Uuid) -> Result<EggRule, ApiResponse> {
        fn dedup(list: Vec<uuid::Uuid>) -> Vec<uuid::Uuid> {
            let mut out = Vec::with_capacity(list.len());
            for uuid in list {
                if !out.contains(&uuid) {
                    out.push(uuid);
                }
            }
            out
        }

        if self.eggs.is_empty() || self.allowed_eggs.is_empty() {
            return Err(ApiResponse::error(
                "A rule needs at least one source egg and one target egg.",
            )
            .with_status(StatusCode::BAD_REQUEST));
        }

        Ok(EggRule {
            id,
            eggs: dedup(self.eggs),
            allowed_eggs: dedup(self.allowed_eggs),
            options: self.options,
        })
    }
}

async fn get_all_eggs(state: &State) -> Result<Vec<EggItem>, anyhow::Error> {
    let nest_rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {} FROM nests ORDER BY nests.name ASC",
        Nest::columns_sql(None)
    )))
    .fetch_all(state.database.read())
    .await?;

    let mut eggs = Vec::new();

    for row in nest_rows {
        let nest = Nest::map(None, &row)?;
        for egg in NestEgg::all_by_nest_uuid(&state.database, nest.uuid).await? {
            eggs.push(EggItem {
                uuid: egg.uuid,
                name: egg.name,
                nest_uuid: nest.uuid,
                nest_name: nest.name.clone(),
            });
        }
    }

    Ok(eggs)
}

mod get_settings {
    use super::*;

    #[utoipa::path(get, path = "/settings", responses(
        (status = OK, body = inline(SettingsResponse)),
    ))]
    pub async fn route(state: GetState, permissions: GetPermissionManager) -> ApiResponseResult {
        permissions.has_admin_permission("extensions.eggchanger.read")?;

        let settings = state.settings.get().await?;
        let ext_settings: &EggChangerSettingsData = settings.find_extension_settings()?;
        let egg_rules = ext_settings.egg_rules.clone();
        let placement = ext_settings.placement;
        drop(settings);

        ApiResponse::new_serialized(SettingsResponse {
            egg_rules,
            placement,
            eggs: get_all_eggs(&state).await?,
        })
        .ok()
    }
}

mod put_settings {
    use super::*;

    #[utoipa::path(put, path = "/settings", responses(
        (status = OK, body = inline(EmptyResponse)),
        (status = BAD_REQUEST, body = shared::ApiError),
    ), request_body = inline(SettingsPayload))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        activity_logger: GetAdminActivityLogger,
        shared::Payload(data): shared::Payload<SettingsPayload>,
    ) -> ApiResponseResult {
        permissions.has_admin_permission("extensions.eggchanger.write")?;

        let mut settings = state.settings.get_mut().await?;
        let ext_settings: &mut EggChangerSettingsData = settings.find_mut_extension_settings()?;
        ext_settings.placement = data.placement;
        settings.save().await?;

        activity_logger
            .log(
                "settings:eggchanger:placement.update",
                serde_json::json!({ "placement": data.placement }),
            )
            .await;

        ApiResponse::new_serialized(EmptyResponse {}).ok()
    }
}

mod post_egg_rule {
    use super::*;

    #[utoipa::path(post, path = "/egg-rules", responses(
        (status = CREATED, body = inline(EggRule)),
    ), request_body = inline(EggRulePayload))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        activity_logger: GetAdminActivityLogger,
        shared::Payload(data): shared::Payload<EggRulePayload>,
    ) -> ApiResponseResult {
        permissions.has_admin_permission("extensions.eggchanger.write")?;

        let rule = data.into_rule(uuid::Uuid::new_v4())?;

        let mut settings = state.settings.get_mut().await?;
        let ext_settings: &mut EggChangerSettingsData = settings.find_mut_extension_settings()?;
        ext_settings.egg_rules.push(rule.clone());
        settings.save().await?;

        activity_logger
            .log(
                "settings:eggchanger:egg-rule.create",
                serde_json::json!({
                    "rule_id": rule.id,
                    "eggs": rule.eggs,
                    "allowed_eggs": rule.allowed_eggs,
                    "options": rule.options,
                }),
            )
            .await;

        ApiResponse::new_serialized(rule)
            .with_status(StatusCode::CREATED)
            .ok()
    }
}

mod put_egg_rule {
    use super::*;

    #[utoipa::path(put, path = "/egg-rules/{id}", responses(
        (status = OK, body = inline(EmptyResponse)),
        (status = NOT_FOUND, body = shared::ApiError),
    ), params(("id" = uuid::Uuid, description = "The egg rule ID")), request_body = inline(EggRulePayload))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        activity_logger: GetAdminActivityLogger,
        Path(rule_id): Path<uuid::Uuid>,
        shared::Payload(data): shared::Payload<EggRulePayload>,
    ) -> ApiResponseResult {
        permissions.has_admin_permission("extensions.eggchanger.write")?;

        let updated = data.into_rule(rule_id)?;

        let mut settings = state.settings.get_mut().await?;
        let ext_settings: &mut EggChangerSettingsData = settings.find_mut_extension_settings()?;

        let Some(rule) = ext_settings.egg_rules.iter_mut().find(|r| r.id == rule_id) else {
            return ApiResponse::error("egg rule not found")
                .with_status(StatusCode::NOT_FOUND)
                .ok();
        };
        *rule = updated.clone();
        settings.save().await?;

        activity_logger
            .log(
                "settings:eggchanger:egg-rule.update",
                serde_json::json!({
                    "rule_id": rule_id,
                    "eggs": updated.eggs,
                    "allowed_eggs": updated.allowed_eggs,
                    "options": updated.options,
                }),
            )
            .await;

        ApiResponse::new_serialized(EmptyResponse {}).ok()
    }
}

mod delete_egg_rule {
    use super::*;

    #[utoipa::path(delete, path = "/egg-rules/{id}", responses(
        (status = OK, body = inline(EmptyResponse)),
        (status = NOT_FOUND, body = shared::ApiError),
    ), params(("id" = uuid::Uuid, description = "The egg rule ID")))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        activity_logger: GetAdminActivityLogger,
        Path(rule_id): Path<uuid::Uuid>,
    ) -> ApiResponseResult {
        permissions.has_admin_permission("extensions.eggchanger.write")?;

        let mut settings = state.settings.get_mut().await?;
        let ext_settings: &mut EggChangerSettingsData = settings.find_mut_extension_settings()?;

        let before = ext_settings.egg_rules.len();
        ext_settings.egg_rules.retain(|r| r.id != rule_id);
        if ext_settings.egg_rules.len() == before {
            return ApiResponse::error("egg rule not found")
                .with_status(StatusCode::NOT_FOUND)
                .ok();
        }
        settings.save().await?;

        activity_logger
            .log(
                "settings:eggchanger:egg-rule.delete",
                serde_json::json!({ "rule_id": rule_id }),
            )
            .await;

        ApiResponse::new_serialized(EmptyResponse {}).ok()
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get_settings::route, put_settings::route))
        .routes(routes!(post_egg_rule::route))
        .routes(routes!(put_egg_rule::route))
        .routes(routes!(delete_egg_rule::route))
        .with_state(state.clone())
}
