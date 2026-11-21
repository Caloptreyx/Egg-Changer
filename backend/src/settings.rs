use serde::{Deserialize, Deserializer, Serialize};
use shared::extensions::settings::{
    ExtensionSettings, SettingsDeserializeExt, SettingsDeserializer, SettingsSerializeExt,
    SettingsSerializer,
};
use utoipa::ToSchema;

/// What happens when a server switches to one of a rule's target eggs.
#[derive(ToSchema, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct EggRuleOptions {
    /// The startup command is always replaced by one of the new egg's; users can't keep theirs.
    #[serde(default)]
    pub force_startup_update: bool,
    /// The server is always reinstalled with the new egg's install script.
    #[serde(default)]
    pub force_reinstall: bool,
    /// All files are always deleted when the server is reinstalled.
    #[serde(default)]
    pub force_truncate: bool,
    /// Apply the new egg's allocation deployment rules (Egg Configuration System).
    #[serde(default = "default_true")]
    pub reassign_allocations: bool,
}

fn default_true() -> bool {
    true
}

/// Rules saved before options existed keep reassigning allocations, as they did then.
impl Default for EggRuleOptions {
    fn default() -> Self {
        Self {
            force_startup_update: false,
            force_reinstall: false,
            force_truncate: false,
            reassign_allocations: true,
        }
    }
}

impl EggRuleOptions {
    /// Combines the options of several rules allowing the same switch: any rule forcing
    /// something forces it.
    fn merge(self, other: Self) -> Self {
        Self {
            force_startup_update: self.force_startup_update || other.force_startup_update,
            force_reinstall: self.force_reinstall || other.force_reinstall,
            force_truncate: self.force_truncate || other.force_truncate,
            reassign_allocations: self.reassign_allocations || other.reassign_allocations,
        }
    }
}

/// Servers whose egg is in `eggs` may switch to any egg in `allowed_eggs`.
#[derive(ToSchema, Serialize, Deserialize, Clone, Debug)]
pub struct EggRule {
    pub id: uuid::Uuid,
    pub eggs: Vec<uuid::Uuid>,
    pub allowed_eggs: Vec<uuid::Uuid>,
    #[serde(default)]
    pub options: EggRuleOptions,
}

#[derive(Debug, PartialEq)]
pub struct Target {
    pub egg: uuid::Uuid,
    pub options: EggRuleOptions,
}

/// Where users find the egg changer on a server.
#[derive(ToSchema, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Placement {
    /// A section on the server's Settings page, as before 1.1.0.
    #[default]
    Settings,
    /// Its own page in the server sidebar.
    Page,
    /// The Settings section and the sidebar page.
    Both,
}

/// Reads a stored placement, falling back to the default for a value this version doesn't know
/// (written by a newer version before a downgrade). Failing instead would fail the whole stored
/// config and with it the egg rules.
fn lenient_placement<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Placement, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

#[derive(ToSchema, Serialize, Deserialize, Clone, Debug, Default)]
pub struct EggChangerSettingsData {
    #[serde(default)]
    pub egg_rules: Vec<EggRule>,
    #[serde(default, deserialize_with = "lenient_placement")]
    pub placement: Placement,
}

impl EggChangerSettingsData {
    /// Eggs a server on `current_egg` may switch to: the union of every matching rule's
    /// `allowed_eggs`, in rule order, without the current egg. An egg allowed by several rules
    /// gets their merged options.
    pub fn targets(&self, current_egg: uuid::Uuid) -> Vec<Target> {
        let mut targets: Vec<Target> = Vec::new();

        for rule in self
            .egg_rules
            .iter()
            .filter(|r| r.eggs.contains(&current_egg))
        {
            for &egg in rule.allowed_eggs.iter().filter(|&&e| e != current_egg) {
                match targets.iter_mut().find(|t| t.egg == egg) {
                    Some(target) => target.options = target.options.merge(rule.options),
                    None => targets.push(Target {
                        egg,
                        options: rule.options,
                    }),
                }
            }
        }

        targets
    }
}

#[async_trait::async_trait]
impl SettingsSerializeExt for EggChangerSettingsData {
    async fn serialize(
        &self,
        serializer: SettingsSerializer,
    ) -> Result<SettingsSerializer, anyhow::Error> {
        Ok(serializer.write_serde_setting("config", self)?)
    }
}

pub struct EggChangerSettingsDeserializer;

#[async_trait::async_trait]
impl SettingsDeserializeExt for EggChangerSettingsDeserializer {
    async fn deserialize_boxed(
        &self,
        deserializer: SettingsDeserializer<'_>,
    ) -> Result<ExtensionSettings, anyhow::Error> {
        let data: EggChangerSettingsData = deserializer
            .read_serde_setting("config")
            .unwrap_or_default();
        Ok(Box::new(data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn egg(n: u128) -> uuid::Uuid {
        uuid::Uuid::from_u128(n)
    }

    fn rule(eggs: &[u128], allowed: &[u128], options: EggRuleOptions) -> EggRule {
        EggRule {
            id: uuid::Uuid::new_v4(),
            eggs: eggs.iter().copied().map(egg).collect(),
            allowed_eggs: allowed.iter().copied().map(egg).collect(),
            options,
        }
    }

    const PLAIN: EggRuleOptions = EggRuleOptions {
        force_startup_update: false,
        force_reinstall: false,
        force_truncate: false,
        reassign_allocations: false,
    };

    #[test]
    fn targets_are_the_union_of_matching_rules_without_the_current_egg() {
        let settings = EggChangerSettingsData {
            egg_rules: vec![
                rule(&[1, 2], &[1, 2, 3], PLAIN),
                rule(&[5], &[6], PLAIN),
                rule(&[1], &[3, 4], PLAIN),
            ],
            ..Default::default()
        };

        let eggs = |current| {
            settings
                .targets(egg(current))
                .into_iter()
                .map(|t| t.egg)
                .collect::<Vec<_>>()
        };
        assert_eq!(eggs(1), vec![egg(2), egg(3), egg(4)]);
        assert_eq!(eggs(2), vec![egg(1), egg(3)]);
        assert!(eggs(6).is_empty());
    }

    #[test]
    fn an_egg_allowed_by_several_rules_gets_every_forced_option() {
        let reinstall = EggRuleOptions {
            force_reinstall: true,
            ..PLAIN
        };
        let truncate_and_allocations = EggRuleOptions {
            force_truncate: true,
            reassign_allocations: true,
            ..PLAIN
        };
        let settings = EggChangerSettingsData {
            egg_rules: vec![
                rule(&[1], &[2, 3], reinstall),
                rule(&[1], &[3], truncate_and_allocations),
                // doesn't match the current egg, must not leak its options
                rule(
                    &[9],
                    &[2],
                    EggRuleOptions {
                        force_startup_update: true,
                        ..PLAIN
                    },
                ),
            ],
            ..Default::default()
        };

        assert_eq!(
            settings.targets(egg(1)),
            vec![
                Target {
                    egg: egg(2),
                    options: reinstall
                },
                Target {
                    egg: egg(3),
                    options: EggRuleOptions {
                        force_reinstall: true,
                        force_truncate: true,
                        reassign_allocations: true,
                        ..PLAIN
                    }
                },
            ]
        );
    }

    #[test]
    fn rules_saved_without_options_keep_reassigning_allocations() {
        let stored = r#"{"egg_rules":[{"id":"18a6ac64-df1b-4b2c-a327-8dd4e79a3ffb","eggs":["00000000-0000-0000-0000-000000000001"],"allowed_eggs":["00000000-0000-0000-0000-000000000002"]}],"apply_allocation_deployment":true}"#;

        let config: EggChangerSettingsData = serde_json::from_str(stored).unwrap();
        assert_eq!(config.egg_rules.len(), 1);
        assert_eq!(config.egg_rules[0].options, EggRuleOptions::default());
        assert!(config.egg_rules[0].options.reassign_allocations);
    }

    #[test]
    fn configs_saved_before_placement_existed_keep_the_settings_section() {
        let stored = r#"{"egg_rules":[{"id":"18a6ac64-df1b-4b2c-a327-8dd4e79a3ffb","eggs":["00000000-0000-0000-0000-000000000001"],"allowed_eggs":["00000000-0000-0000-0000-000000000002"]}]}"#;

        let config: EggChangerSettingsData = serde_json::from_str(stored).unwrap();
        assert_eq!(config.placement, Placement::Settings);
        assert_eq!(
            EggChangerSettingsData::default().placement,
            Placement::Settings
        );
    }

    #[test]
    fn placement_only_accepts_known_values() {
        for (value, expected) in [
            ("settings", Placement::Settings),
            ("page", Placement::Page),
            ("both", Placement::Both),
        ] {
            let json = serde_json::json!(value);
            assert_eq!(
                serde_json::from_value::<Placement>(json.clone()).unwrap(),
                expected
            );
            assert_eq!(serde_json::to_value(expected).unwrap(), json);
        }

        for invalid in [
            serde_json::json!("sidebar"),
            serde_json::json!("Page"),
            serde_json::json!(""),
            serde_json::json!(null),
            serde_json::json!(1),
        ] {
            assert!(serde_json::from_value::<Placement>(invalid).is_err());
        }
    }

    #[test]
    fn an_unknown_stored_placement_keeps_the_rules() {
        let stored = r#"{"egg_rules":[{"id":"18a6ac64-df1b-4b2c-a327-8dd4e79a3ffb","eggs":["00000000-0000-0000-0000-000000000001"],"allowed_eggs":["00000000-0000-0000-0000-000000000002"]}],"placement":"floating"}"#;

        let config: EggChangerSettingsData = serde_json::from_str(stored).unwrap();
        assert_eq!(config.egg_rules.len(), 1);
        assert_eq!(config.placement, Placement::Settings);
    }
}
