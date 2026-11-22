//! Applies a target egg's allocation deployment rules (`config_allocations.deployment`) to an
//! existing server. Unlike the core deployment, the server keeps its primary allocation; each
//! additional-allocation rule is satisfied by an allocation the server already has when one fits,
//! otherwise by a free node allocation.

use axum::http::StatusCode;
use compact_str::{CompactString, ToCompactString};
use shared::{
    State,
    models::{
        egg_configuration::{
            EggConfigAllocationDeploymentAdditionalAllocationMode as Mode,
            EggConfigAllocationsDeployment,
        },
        node_allocation::NodeAllocation,
        server::Server,
        server_allocation::ServerAllocation,
    },
    response::DisplayError,
};
use sqlx::types::ipnetwork::IpNetwork;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Alloc {
    /// `node_allocations.uuid`
    pub uuid: uuid::Uuid,
    pub ip: IpNetwork,
    pub port: i32,
}

impl From<&NodeAllocation> for Alloc {
    fn from(allocation: &NodeAllocation) -> Self {
        Self {
            uuid: allocation.uuid,
            ip: allocation.ip,
            port: allocation.port,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Need {
    /// Satisfied by an allocation the server already has.
    Existing(Alloc),
    /// A free node allocation with a port in `start..=end`, on `ip` when set.
    Range {
        ip: Option<IpNetwork>,
        start: u16,
        end: u16,
    },
    /// The free node allocation at exactly `ip:port`.
    Exact { ip: IpNetwork, port: i32 },
}

#[derive(Debug, PartialEq)]
pub struct PlannedRule<'a> {
    pub need: Need,
    pub assign_to_variable: Option<&'a str>,
}

#[derive(Debug, PartialEq)]
pub struct Plan<'a> {
    /// Variable the primary allocation's port is assigned to.
    pub primary_variable: Option<(&'a str, i32)>,
    /// One entry per additional-allocation rule, in rule order.
    pub rules: Vec<PlannedRule<'a>>,
}

/// Port a primary-relative rule points at, computed like the core deployment does.
fn derived_port(mode: &Mode, primary_port: i32) -> Option<i32> {
    match *mode {
        Mode::AddPrimary { value } => Some(primary_port + value as i32),
        Mode::SubtractPrimary { value } => Some(primary_port - value as i32),
        Mode::MultiplyPrimary { value } => Some((primary_port as f64 * value) as i32),
        Mode::DividePrimary { value } => Some((primary_port as f64 / value) as i32),
        Mode::Random | Mode::Range { .. } => None,
    }
}

fn mode_name(mode: &Mode) -> &'static str {
    match mode {
        Mode::Random => "random",
        Mode::Range { .. } => "range",
        Mode::AddPrimary { .. } => "add_primary",
        Mode::SubtractPrimary { .. } => "subtract_primary",
        Mode::MultiplyPrimary { .. } => "multiply_primary",
        Mode::DividePrimary { .. } => "divide_primary",
    }
}

/// Claims the first existing allocation matching `matches` that no other rule claimed yet.
fn claim(
    existing: &[Alloc],
    claimed: &mut [bool],
    matches: impl Fn(&Alloc) -> bool,
) -> Option<Alloc> {
    let index = existing
        .iter()
        .enumerate()
        .position(|(i, alloc)| !claimed[i] && matches(alloc))?;
    claimed[index] = true;

    Some(existing[index])
}

/// Matches the deployment rules against the server's current allocations. Exact-port rules claim
/// existing allocations first, then range rules, then random rules, so a loose rule never takes
/// the allocation a stricter one needs.
pub fn plan<'a>(
    deployment: &'a EggConfigAllocationsDeployment,
    primary: Option<Alloc>,
    existing: &[Alloc],
) -> Result<Plan<'a>, String> {
    let mut claimed = vec![false; existing.len()];
    let mut needs: Vec<Option<Need>> = (0..deployment.additional.len()).map(|_| None).collect();

    let range_need = |claimed: &mut [bool], start: u16, end: u16| {
        let fits = |alloc: &Alloc| {
            primary.is_none_or(|p| p.ip == alloc.ip)
                && (start as i32..=end as i32).contains(&alloc.port)
        };

        match claim(existing, claimed, fits) {
            Some(alloc) => Need::Existing(alloc),
            None => Need::Range {
                ip: primary.map(|p| p.ip),
                start,
                end,
            },
        }
    };

    // pass 0: exact ports, 1: ranges, 2: random
    for pass in 0..3 {
        for (index, rule) in deployment.additional.iter().enumerate() {
            let need = match (pass, &rule.mode) {
                (0, Mode::Random | Mode::Range { .. }) => continue,
                (0, mode) => {
                    let Some(primary) = primary else {
                        return Err(format!(
                            "The new egg needs a primary allocation for its `{}` allocation rule.",
                            mode_name(mode)
                        ));
                    };
                    let port = derived_port(mode, primary.port).unwrap_or_default();
                    if !(1..=65535).contains(&port) {
                        return Err(format!(
                            "The new egg requires port {port}, which is not a valid port."
                        ));
                    }

                    match claim(existing, &mut claimed, |alloc| {
                        alloc.ip == primary.ip && alloc.port == port
                    }) {
                        Some(alloc) => Need::Existing(alloc),
                        None => Need::Exact {
                            ip: primary.ip,
                            port,
                        },
                    }
                }
                (
                    1,
                    &Mode::Range {
                        start_port,
                        end_port,
                    },
                ) => range_need(&mut claimed, start_port, end_port),
                (2, Mode::Random) => range_need(&mut claimed, 1, u16::MAX),
                _ => continue,
            };

            needs[index] = Some(need);
        }
    }

    let rules = deployment
        .additional
        .iter()
        .zip(needs)
        .map(|(rule, need)| PlannedRule {
            need: need.expect("every rule is planned in one of the passes"),
            assign_to_variable: rule.assign_to_variable.as_deref(),
        })
        .collect();

    let primary_variable = match (&deployment.primary, primary) {
        (Some(rule), Some(primary)) => rule
            .assign_to_variable
            .as_deref()
            .map(|variable| (variable, primary.port)),
        _ => None,
    };

    Ok(Plan {
        primary_variable,
        rules,
    })
}

pub struct Applied {
    /// Env variable name -> value.
    pub variables: Vec<(CompactString, CompactString)>,
    /// Node allocations the server has to be given.
    pub new_allocations: Vec<Alloc>,
}

fn rejected(status: StatusCode, message: impl Into<String>) -> anyhow::Error {
    DisplayError::new(message.into()).with_status(status).into()
}

/// Plans `deployment` for `server` and picks free node allocations for the rules its current
/// allocations don't cover. Nothing is written; the caller inserts `new_allocations`.
pub async fn resolve(
    state: &State,
    server: &Server,
    deployment: &EggConfigAllocationsDeployment,
) -> Result<Applied, anyhow::Error> {
    let primary = server
        .allocation
        .as_ref()
        .map(|a| Alloc::from(&a.allocation));
    let existing: Vec<Alloc> = ServerAllocation::all_by_server_uuid(&state.database, server.uuid)
        .await?
        .iter()
        .filter(|a| server.allocation.as_ref().is_none_or(|p| p.uuid != a.uuid))
        .map(|a| Alloc::from(&a.allocation))
        .collect();

    let plan = plan(deployment, primary, &existing)
        .map_err(|message| rejected(StatusCode::EXPECTATION_FAILED, message))?;

    let mut variables = Vec::new();
    if let Some((variable, port)) = plan.primary_variable {
        variables.push((variable.into(), port.to_compact_string()));
    }

    let mut new_allocations: Vec<Alloc> = Vec::new();
    // Node allocations whose port is bound on the node, fetched from Wings once if needed.
    let mut used: Option<Vec<uuid::Uuid>> = None;

    for rule in plan.rules {
        let alloc = match rule.need {
            Need::Existing(alloc) => alloc,
            need => {
                if used.is_none() {
                    let node = server.node.fetch_cached(&state.database).await?;
                    used = Some(
                        NodeAllocation::used_by_node_any_ip(state, &node)
                            .await
                            .map_err(|err| {
                                tracing::warn!(server = %server.uuid, "failed to fetch used ports: {err:#}");
                                rejected(
                                    StatusCode::BAD_GATEWAY,
                                    "Could not reach the node to pick allocations for the new egg.",
                                )
                            })?,
                    );
                }
                let mut exclude = used.clone().unwrap_or_default();
                exclude.extend(new_allocations.iter().map(|a| a.uuid));

                pick(state, server.node.uuid, need, &exclude).await?
            }
        };

        if let Some(variable) = rule.assign_to_variable {
            variables.push((variable.into(), alloc.port.to_compact_string()));
        }
        if !existing.contains(&alloc) {
            new_allocations.push(alloc);
        }
    }

    Ok(Applied {
        variables,
        new_allocations,
    })
}

async fn pick(
    state: &State,
    node_uuid: uuid::Uuid,
    need: Need,
    exclude: &[uuid::Uuid],
) -> Result<Alloc, anyhow::Error> {
    let database = &state.database;

    match need {
        Need::Existing(alloc) => Ok(alloc),
        Need::Range { ip, start, end } => {
            let picked = match ip {
                Some(ip) => {
                    NodeAllocation::get_random_ip(database, node_uuid, &ip, start, end, 1, exclude)
                        .await
                }
                None => {
                    NodeAllocation::get_random(database, node_uuid, start, end, 1, exclude).await
                }
            };
            let no_free = || {
                rejected(
                    StatusCode::EXPECTATION_FAILED,
                    format!(
                        "No free allocation in port range {start}-{end} is left for the new egg."
                    ),
                )
            };
            let uuid = picked
                .ok()
                .and_then(|uuids| uuids.into_iter().next())
                .ok_or_else(no_free)?;

            NodeAllocation::by_node_uuid_uuid(database, node_uuid, uuid)
                .await?
                .map(|allocation| Alloc::from(&allocation))
                .ok_or_else(no_free)
        }
        Need::Exact { ip, port } => {
            NodeAllocation::by_node_uuid_ip_port_unused(database, node_uuid, &ip, port, exclude)
                .await?
                .map(|allocation| Alloc::from(&allocation))
                .ok_or_else(|| {
                    rejected(
                        StatusCode::EXPECTATION_FAILED,
                        format!("The new egg requires port {port}, which is not available."),
                    )
                })
        }
    }
}

/// Whether a server holding `current` allocations may be given `new` more, the way the core
/// self-assign route applies `allocation_limit` (the primary allocation counts).
pub fn within_limit(current: i64, new: usize, limit: i32) -> bool {
    current.saturating_add(new as i64) <= i64::from(limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared::models::egg_configuration::{
        EggConfigAllocationDeploymentAdditionalAllocation as Additional,
        EggConfigAllocationDeploymentPrimaryAllocation as Primary,
    };

    fn ip(last: u8) -> IpNetwork {
        IpNetwork::from(std::net::IpAddr::from([10, 0, 0, last]))
    }

    fn alloc(n: u128, ip_last: u8, port: i32) -> Alloc {
        Alloc {
            uuid: uuid::Uuid::from_u128(n),
            ip: ip(ip_last),
            port,
        }
    }

    #[test]
    fn allocation_limit_counts_existing_and_new() {
        assert!(within_limit(1, 2, 3));
        assert!(!within_limit(1, 3, 3));
        assert!(!within_limit(1, 1, 0));
        assert!(!within_limit(4, 1, 3));
    }

    fn rule(mode: Mode, variable: Option<&str>) -> Additional {
        Additional {
            mode,
            assign_to_variable: variable.map(Into::into),
        }
    }

    fn deployment(additional: Vec<Additional>) -> EggConfigAllocationsDeployment {
        EggConfigAllocationsDeployment {
            dedicated: false,
            primary: Some(Primary {
                start_port: 25565,
                end_port: 25600,
                assign_to_variable: Some("SERVER_PORT".into()),
            }),
            additional,
        }
    }

    #[test]
    fn exact_rules_claim_existing_allocations_before_loose_rules() {
        let deployment = deployment(vec![
            rule(Mode::Random, Some("RCON_PORT")),
            rule(Mode::AddPrimary { value: 1 }, Some("QUERY_PORT")),
        ]);
        let primary = alloc(1, 1, 25565);
        let query = alloc(2, 1, 25566);

        let plan = plan(&deployment, Some(primary), &[query]).unwrap();

        assert_eq!(plan.primary_variable, Some(("SERVER_PORT", 25565)));
        assert_eq!(
            plan.rules,
            vec![
                PlannedRule {
                    need: Need::Range {
                        ip: Some(ip(1)),
                        start: 1,
                        end: u16::MAX
                    },
                    assign_to_variable: Some("RCON_PORT"),
                },
                PlannedRule {
                    need: Need::Existing(query),
                    assign_to_variable: Some("QUERY_PORT"),
                },
            ]
        );
    }

    #[test]
    fn range_rules_only_reuse_allocations_in_range_on_the_primary_ip() {
        let deployment = deployment(vec![rule(
            Mode::Range {
                start_port: 19132,
                end_port: 19140,
            },
            None,
        )]);
        let primary = alloc(1, 1, 25565);
        let other_ip = alloc(2, 2, 19132);
        let out_of_range = alloc(3, 1, 19200);
        let fits = alloc(4, 1, 19133);

        let planned = plan(&deployment, Some(primary), &[other_ip, out_of_range, fits]).unwrap();
        assert_eq!(planned.rules[0].need, Need::Existing(fits));

        let planned = plan(&deployment, Some(primary), &[other_ip, out_of_range]).unwrap();
        assert_eq!(
            planned.rules[0].need,
            Need::Range {
                ip: Some(ip(1)),
                start: 19132,
                end: 19140
            }
        );
    }

    #[test]
    fn one_existing_allocation_satisfies_only_one_rule() {
        let deployment = deployment(vec![rule(Mode::Random, None), rule(Mode::Random, None)]);
        let primary = alloc(1, 1, 25565);
        let extra = alloc(2, 1, 30000);

        let plan = plan(&deployment, Some(primary), &[extra]).unwrap();

        assert_eq!(plan.rules[0].need, Need::Existing(extra));
        assert!(matches!(plan.rules[1].need, Need::Range { .. }));
    }

    #[test]
    fn derived_rules_are_rejected_without_a_primary_or_with_an_invalid_port() {
        let add = deployment(vec![rule(Mode::AddPrimary { value: 1 }, None)]);
        assert!(plan(&add, None, &[]).is_err());

        let too_high = deployment(vec![rule(Mode::MultiplyPrimary { value: 3.0 }, None)]);
        assert!(plan(&too_high, Some(alloc(1, 1, 25565)), &[]).is_err());

        let subtract = deployment(vec![rule(Mode::SubtractPrimary { value: 25565 }, None)]);
        assert!(plan(&subtract, Some(alloc(1, 1, 25565)), &[]).is_err());
    }

    #[test]
    fn random_rules_without_a_primary_may_use_any_ip() {
        let deployment = deployment(vec![rule(Mode::Random, None)]);
        let elsewhere = alloc(2, 7, 40000);

        let plan = plan(&deployment, None, &[elsewhere]).unwrap();

        assert_eq!(plan.primary_variable, None);
        assert_eq!(plan.rules[0].need, Need::Existing(elsewhere));
    }
}
