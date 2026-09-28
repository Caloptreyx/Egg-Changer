use serde::{Deserialize, Serialize};
use shared::extensions::settings::{
    ExtensionSettings, SettingsDeserializeExt, SettingsDeserializer, SettingsSerializeExt,
    SettingsSerializer,
};
use utoipa::ToSchema;

/// Servers whose egg is in `eggs` may switch to any egg in `allowed_eggs`.
#[derive(ToSchema, Serialize, Deserialize, Clone, Debug)]
pub struct EggRule {
    pub id: uuid::Uuid,
    pub eggs: Vec<uuid::Uuid>,
    pub allowed_eggs: Vec<uuid::Uuid>,
}

fn default_true() -> bool {
    true
}

#[derive(ToSchema, Serialize, Deserialize, Clone, Debug)]
pub struct EggChangerSettingsData {
    #[serde(default)]
    pub egg_rules: Vec<EggRule>,
    /// Apply the target egg's allocation deployment rules (additional allocations and the
    /// variables they are assigned to) when a server switches to it.
    #[serde(default = "default_true")]
    pub apply_allocation_deployment: bool,
}

impl Default for EggChangerSettingsData {
    fn default() -> Self {
        Self {
            egg_rules: Vec::new(),
            apply_allocation_deployment: true,
        }
    }
}

impl EggChangerSettingsData {
    /// Eggs a server on `current_egg` may switch to: the union of every matching rule's
    /// `allowed_eggs`, in rule order, without duplicates and without the current egg.
    pub fn allowed_targets(&self, current_egg: uuid::Uuid) -> Vec<uuid::Uuid> {
        let mut targets = Vec::new();

        for rule in self
            .egg_rules
            .iter()
            .filter(|r| r.eggs.contains(&current_egg))
        {
            for &egg in &rule.allowed_eggs {
                if egg != current_egg && !targets.contains(&egg) {
                    targets.push(egg);
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

    fn rule(eggs: &[u128], allowed: &[u128]) -> EggRule {
        EggRule {
            id: uuid::Uuid::new_v4(),
            eggs: eggs.iter().copied().map(egg).collect(),
            allowed_eggs: allowed.iter().copied().map(egg).collect(),
        }
    }

    #[test]
    fn targets_are_the_union_of_matching_rules_without_the_current_egg() {
        let settings = EggChangerSettingsData {
            egg_rules: vec![
                rule(&[1, 2], &[1, 2, 3]),
                rule(&[5], &[6]),
                rule(&[1], &[3, 4]),
            ],
            apply_allocation_deployment: true,
        };

        assert_eq!(
            settings.allowed_targets(egg(1)),
            vec![egg(2), egg(3), egg(4)]
        );
        assert_eq!(settings.allowed_targets(egg(2)), vec![egg(1), egg(3)]);
        assert!(settings.allowed_targets(egg(6)).is_empty());
    }

    #[test]
    fn missing_fields_keep_stored_rules_and_enable_deployment() {
        let stored = r#"{"egg_rules":[{"id":"18a6ac64-df1b-4b2c-a327-8dd4e79a3ffb","eggs":["00000000-0000-0000-0000-000000000001"],"allowed_eggs":["00000000-0000-0000-0000-000000000002"]}]}"#;

        let config: EggChangerSettingsData = serde_json::from_str(stored).unwrap();
        assert_eq!(config.egg_rules.len(), 1);
        assert!(config.apply_allocation_deployment);
    }
}
