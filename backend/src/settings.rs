use serde::{Deserialize, Deserializer, Serialize};
use shared::extensions::settings::{
    ExtensionSettings, SettingsDeserializeExt, SettingsDeserializer, SettingsSerializeExt,
    SettingsSerializer,
};
use std::collections::BTreeMap;
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
    /// A backup of the server must finish successfully before the switch.
    #[serde(default)]
    pub force_backup: bool,
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
            force_backup: false,
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
            force_backup: self.force_backup || other.force_backup,
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

/// Longest icon or banner URL accepted, in bytes after normalisation.
pub const MAX_IMAGE_URL_LENGTH: usize = 1024;

/// An admin-entered icon or banner URL, normalised, or why it is rejected. Blank clears the image.
/// Only absolute https URLs without credentials pass: the frontend renders them as `<img src>`
/// and nowhere else, so this keeps out `javascript:`, `data:` (inline SVG), plain http and
/// relative paths.
pub fn parse_image_url(value: &str) -> Result<Option<String>, &'static str> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > MAX_IMAGE_URL_LENGTH {
        return Err("must be at most 1024 characters long");
    }
    // the URL parser would silently drop tabs and newlines
    if value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("must not contain spaces or control characters");
    }

    let url = reqwest::Url::parse(value).map_err(|_| "must be a full URL starting with https://")?;
    if url.scheme() != "https" {
        return Err("must start with https://");
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("must name a host");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("must not contain a user name or password");
    }

    let url = String::from(url);
    if url.len() > MAX_IMAGE_URL_LENGTH {
        return Err("must be at most 1024 characters long");
    }
    Ok(Some(url))
}

/// Optional pictures of an egg on the user's egg cards and in the switch dialog.
#[derive(ToSchema, Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct EggAppearance {
    /// Square icon, an https URL.
    #[serde(default)]
    pub icon: Option<String>,
    /// Wide banner (shown at 3:1), an https URL.
    #[serde(default)]
    pub banner: Option<String>,
}

impl EggAppearance {
    pub fn is_empty(&self) -> bool {
        self.icon.is_none() && self.banner.is_none()
    }

    /// Drops URLs that no longer pass [`parse_image_url`], should a stored value ever not.
    fn sanitized(self) -> Self {
        let keep = |url: Option<String>| url.and_then(|url| parse_image_url(&url).ok().flatten());
        Self {
            icon: keep(self.icon),
            banner: keep(self.banner),
        }
    }
}

/// Reads stored icons and banners entry by entry: one unreadable entry must not cost the others,
/// or the whole stored config with its egg rules.
fn lenient_appearance<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<uuid::Uuid, EggAppearance>, D::Error> {
    let serde_json::Value::Object(entries) = serde_json::Value::deserialize(deserializer)? else {
        return Ok(BTreeMap::new());
    };

    Ok(entries
        .into_iter()
        .filter_map(|(egg, appearance)| {
            let egg = egg.parse().ok()?;
            let appearance = serde_json::from_value::<EggAppearance>(appearance)
                .ok()?
                .sanitized();
            (!appearance.is_empty()).then_some((egg, appearance))
        })
        .collect())
}

#[derive(ToSchema, Serialize, Deserialize, Clone, Debug, Default)]
pub struct EggChangerSettingsData {
    #[serde(default)]
    pub egg_rules: Vec<EggRule>,
    #[serde(default, deserialize_with = "lenient_placement")]
    pub placement: Placement,
    /// Icons and banners by egg, kept here rather than on the core egg rows.
    #[serde(default, deserialize_with = "lenient_appearance")]
    pub egg_appearance: BTreeMap<uuid::Uuid, EggAppearance>,
}

impl EggChangerSettingsData {
    /// The egg's icon and banner; empty when none are set.
    pub fn appearance(&self, egg: uuid::Uuid) -> EggAppearance {
        self.egg_appearance.get(&egg).cloned().unwrap_or_default()
    }

    /// Sets the egg's icon and banner; an empty appearance removes the entry.
    pub fn set_appearance(&mut self, egg: uuid::Uuid, appearance: EggAppearance) {
        if appearance.is_empty() {
            self.egg_appearance.remove(&egg);
        } else {
            self.egg_appearance.insert(egg, appearance);
        }
    }

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
        force_backup: false,
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
    fn a_forced_backup_from_any_rule_applies_and_old_rules_dont_force_one() {
        let backup = EggRuleOptions {
            force_backup: true,
            ..PLAIN
        };
        let settings = EggChangerSettingsData {
            egg_rules: vec![rule(&[1], &[2], PLAIN), rule(&[1], &[2], backup)],
            ..Default::default()
        };
        assert!(settings.targets(egg(1))[0].options.force_backup);

        let stored = r#"{"force_reinstall":true}"#;
        let options: EggRuleOptions = serde_json::from_str(stored).unwrap();
        assert!(!options.force_backup);
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

    #[test]
    fn image_urls_must_be_absolute_https_and_are_normalised() {
        assert_eq!(
            parse_image_url("  https://CDN.Example.com/eggs/paper.png  "),
            Ok(Some("https://cdn.example.com/eggs/paper.png".into()))
        );
        assert_eq!(
            parse_image_url("https://example.com"),
            Ok(Some("https://example.com/".into()))
        );
        assert_eq!(parse_image_url(""), Ok(None));
        assert_eq!(parse_image_url("   "), Ok(None));

        for rejected in [
            "http://example.com/a.png",
            "javascript:alert(1)",
            "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
            "ftp://example.com/a.png",
            "/assets/a.png",
            "//example.com/a.png",
            "example.com/a.png",
            "https://",
            "https://user:secret@example.com/a.png",
            "https://user@example.com/a.png",
            "https://example.com/a b.png",
            "https://example.com/a\n.png",
            "https://example.com/a\t.png",
        ] {
            assert!(parse_image_url(rejected).is_err(), "{rejected:?}");
        }
    }

    #[test]
    fn image_urls_are_capped_at_1024_bytes_also_after_normalisation() {
        let base = "https://example.com/";
        let longest = format!("{base}{}", "a".repeat(MAX_IMAGE_URL_LENGTH - base.len()));
        assert_eq!(parse_image_url(&longest), Ok(Some(longest.clone())));
        assert!(parse_image_url(&format!("{longest}a")).is_err());

        // each `"` becomes `%22`
        let grows = format!("{base}{}", "\"".repeat(400));
        assert!(grows.len() < MAX_IMAGE_URL_LENGTH);
        assert!(parse_image_url(&grows).is_err());
    }

    #[test]
    fn stored_appearance_is_read_entry_by_entry_and_revalidated() {
        let stored = r#"{
            "egg_rules":[{"id":"18a6ac64-df1b-4b2c-a327-8dd4e79a3ffb","eggs":["00000000-0000-0000-0000-000000000001"],"allowed_eggs":["00000000-0000-0000-0000-000000000002"]}],
            "egg_appearance":{
                "00000000-0000-0000-0000-000000000002":{"icon":"https://example.com/i.png","banner":"http://example.com/b.png"},
                "not-a-uuid":{"icon":"https://example.com/i.png"},
                "00000000-0000-0000-0000-000000000003":{"icon":5},
                "00000000-0000-0000-0000-000000000004":{"banner":"javascript:alert(1)"}
            }
        }"#;

        let config: EggChangerSettingsData = serde_json::from_str(stored).unwrap();
        assert_eq!(config.egg_rules.len(), 1);
        assert_eq!(config.egg_appearance.len(), 1);
        assert_eq!(
            config.appearance(egg(2)),
            EggAppearance {
                icon: Some("https://example.com/i.png".into()),
                banner: None,
            }
        );
        assert_eq!(config.appearance(egg(4)), EggAppearance::default());

        let garbage = r#"{"egg_rules":[],"egg_appearance":"none","placement":"page"}"#;
        let config: EggChangerSettingsData = serde_json::from_str(garbage).unwrap();
        assert!(config.egg_appearance.is_empty());
        assert_eq!(config.placement, Placement::Page);

        let older: EggChangerSettingsData = serde_json::from_str(r#"{"egg_rules":[]}"#).unwrap();
        assert!(older.egg_appearance.is_empty());
    }

    #[test]
    fn clearing_both_images_removes_the_entry() {
        let mut config = EggChangerSettingsData::default();
        let appearance = EggAppearance {
            icon: Some("https://example.com/i.png".into()),
            banner: Some("https://example.com/b.png".into()),
        };
        config.set_appearance(egg(1), appearance.clone());

        let saved = serde_json::to_string(&config).unwrap();
        let mut config: EggChangerSettingsData = serde_json::from_str(&saved).unwrap();
        assert_eq!(config.appearance(egg(1)), appearance);

        config.set_appearance(egg(1), EggAppearance::default());
        assert!(config.egg_appearance.is_empty());
    }
}
