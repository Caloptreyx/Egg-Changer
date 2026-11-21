use indexmap::IndexMap;
use shared::{
    State,
    extensions::{
        Extension, ExtensionPermissionsBuilder, ExtensionRouteBuilder, index_html::IndexHtmlBuilder,
    },
    permissions::PermissionGroup,
};
use std::sync::Arc;

pub mod allocations;
pub mod routes;
pub mod settings;

#[derive(Default)]
pub struct ExtensionStruct;

#[async_trait::async_trait]
impl Extension for ExtensionStruct {
    async fn initialize(&mut self, _state: State) {
        tracing::info!("Egg Changer extension initialized");
    }

    async fn settings_deserializer(
        &self,
        _state: State,
    ) -> shared::extensions::settings::ExtensionSettingsDeserializer {
        Arc::new(settings::EggChangerSettingsDeserializer)
    }

    async fn initialize_router(
        &mut self,
        state: State,
        builder: ExtensionRouteBuilder,
    ) -> ExtensionRouteBuilder {
        builder
            .add_admin_api_router(|router| {
                router.nest(
                    "/extensions/dev.caloptreyx.eggchanger",
                    routes::admin::router(&state),
                )
            })
            .add_client_server_api_router(|router| {
                router.nest("/egg-changer", routes::client::router(&state))
            })
    }

    /// The frontend needs the placement before it builds the server sidebar. Not a secret:
    /// index.html is public.
    async fn initialize_index_html(
        &mut self,
        _state: State,
        builder: IndexHtmlBuilder,
    ) -> IndexHtmlBuilder {
        builder.add_variable("placement", |app| {
            let placement = app
                .find_extension_settings::<settings::EggChangerSettingsData>()
                .map(|settings| settings.placement)
                .unwrap_or_default();
            Ok(serde_json::to_value(placement)?)
        });
        builder
    }

    async fn initialize_permissions(
        &mut self,
        _state: State,
        builder: ExtensionPermissionsBuilder,
    ) -> ExtensionPermissionsBuilder {
        builder
            .add_server_permission_group(
                "eggchanger",
                PermissionGroup {
                    description: "Permissions for the Egg Changer extension.",
                    permissions: IndexMap::from([(
                        "change",
                        "Allows switching this server to another admin-approved egg, including any reinstall or file wipe the admin's rules force. Choosing to reinstall also needs the reinstall permission.",
                    )]),
                },
            )
            .mutate_admin_permission_group("extensions", |group| {
                group.add_permission(
                    "eggchanger.read",
                    "Allows viewing Egg Changer settings and egg rules.",
                );
                group.add_permission(
                    "eggchanger.write",
                    "Allows modifying Egg Changer settings and egg rules.",
                );
            })
    }
}
