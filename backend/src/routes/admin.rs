use crate::settings::{
    EggAppearance, EggChangerSettingsData, EggRule, EggRuleOptions, Placement, parse_image_url,
};
use axum::{extract::Path, http::StatusCode};
use serde::{Deserialize, Serialize};
use shared::{
    GetState, State,
    models::{
        BaseModel, ByUuid, admin_activity::GetAdminActivityLogger, nest::Nest, nest_egg::NestEgg,
        user::GetPermissionManager,
    },
    response::{ApiResponse, ApiResponseResult},
};
use std::collections::BTreeMap;
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
    /// Icons and banners by egg UUID.
    pub egg_appearance: BTreeMap<uuid::Uuid, EggAppearance>,
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

#[derive(ToSchema, Deserialize)]
pub struct EggAppearancePayload {
    /// Square icon: an https URL of at most 1024 characters; null or blank removes it.
    #[serde(default)]
    pub icon: Option<String>,
    /// Wide 3:1 banner: an https URL of at most 1024 characters; null or blank removes it.
    #[serde(default)]
    pub banner: Option<String>,
}

impl EggAppearancePayload {
    /// The normalised appearance, or an error response naming the rejected URL.
    fn into_appearance(self) -> Result<EggAppearance, ApiResponse> {
        fn image(label: &str, value: Option<String>) -> Result<Option<String>, ApiResponse> {
            parse_image_url(value.as_deref().unwrap_or_default())
                .map_err(|reason| ApiResponse::error(format!("The {label} URL {reason}.")))
        }

        Ok(EggAppearance {
            icon: image("icon", self.icon)?,
            banner: image("banner", self.banner)?,
        })
    }
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
        let egg_appearance = ext_settings.egg_appearance.clone();
        drop(settings);

        ApiResponse::new_serialized(SettingsResponse {
            egg_rules,
            placement,
            egg_appearance,
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

mod put_egg_appearance {
    use super::*;

    #[utoipa::path(put, path = "/egg-appearance/{egg}", responses(
        (status = OK, body = inline(EggAppearance)),
        (status = BAD_REQUEST, body = shared::ApiError),
        (status = NOT_FOUND, body = shared::ApiError),
    ), params(("egg" = uuid::Uuid, description = "The egg ID")), request_body = inline(EggAppearancePayload))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        activity_logger: GetAdminActivityLogger,
        Path(egg_uuid): Path<uuid::Uuid>,
        shared::Payload(data): shared::Payload<EggAppearancePayload>,
    ) -> ApiResponseResult {
        permissions.has_admin_permission("extensions.eggchanger.write")?;

        let appearance = data.into_appearance()?;

        // clearing stays possible after the egg was deleted
        if !appearance.is_empty()
            && NestEgg::by_uuid_optional(&state.database, egg_uuid)
                .await?
                .is_none()
        {
            return ApiResponse::error("egg not found")
                .with_status(StatusCode::NOT_FOUND)
                .ok();
        }

        let mut settings = state.settings.get_mut().await?;
        let ext_settings: &mut EggChangerSettingsData = settings.find_mut_extension_settings()?;
        ext_settings.set_appearance(egg_uuid, appearance.clone());
        settings.save().await?;

        activity_logger
            .log(
                "settings:eggchanger:egg-appearance.update",
                serde_json::json!({
                    "egg": egg_uuid,
                    "icon": appearance.icon,
                    "banner": appearance.banner,
                }),
            )
            .await;

        ApiResponse::new_serialized(appearance).ok()
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get_settings::route, put_settings::route))
        .routes(routes!(post_egg_rule::route))
        .routes(routes!(put_egg_rule::route))
        .routes(routes!(delete_egg_rule::route))
        .routes(routes!(put_egg_appearance::route))
        .with_state(state.clone())
}
