#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Debug)]
pub struct GraphCommit {
    pub sha: String,
    pub parents: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Segment {
    pub x1: usize,
    pub y1: &'static str,
    pub x2: usize,
    pub y2: &'static str,
    pub color: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GraphRow {
    pub col: usize,
    pub color: usize,
    pub segments: Vec<Segment>,
    pub width: usize,
}

fn seg(x1: usize, y1: &'static str, x2: usize, y2: &'static str) -> Segment {
    Segment {
        x1,
        y1,
        x2,
        y2,
        color: x1.max(x2),
    }
}

fn free_slot(lanes: &mut Vec<Option<String>>, exclude: Option<usize>) -> usize {
    if let Some(i) = (0..lanes.len()).find(|&i| lanes[i].is_none() && Some(i) != exclude) {
        return i;
    }
    lanes.push(None);
    lanes.len() - 1
}

pub fn layout(commits: &[GraphCommit]) -> Vec<GraphRow> {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut rows = Vec::with_capacity(commits.len());
    for commit in commits {
        let mut segments = Vec::new();
        let top = lanes.clone();
        let incoming: Vec<usize> = top
            .iter()
            .enumerate()
            .filter(|(_, sha)| sha.as_deref() == Some(commit.sha.as_str()))
            .map(|(i, _)| i)
            .collect();
        let col = match incoming.first() {
            Some(&c) => c,
            None => free_slot(&mut lanes, None),
        };
        for &i in &incoming {
            segments.push(seg(i, "top", col, "mid"));
            if i != col {
                lanes[i] = None;
            }
        }
        let first = commit.parents.first().cloned();
        lanes[col] = first.clone();
        if first.is_some() {
            segments.push(seg(col, "mid", col, "bottom"));
        }
        for parent in commit.parents.iter().skip(1) {
            let slot = match lanes
                .iter()
                .position(|l| l.as_deref() == Some(parent.as_str()))
            {
                Some(s) => s,
                None => {
                    let s = free_slot(&mut lanes, Some(col));
                    lanes[s] = Some(parent.clone());
                    s
                }
            };
            segments.push(seg(col, "mid", slot, "bottom"));
        }
        for (i, sha) in top.iter().enumerate() {
            if sha.is_some() && sha.as_deref() != Some(commit.sha.as_str()) {
                segments.push(seg(i, "top", i, "bottom"));
            }
        }
        while lanes.last().is_some_and(|l| l.is_none()) {
            lanes.pop();
        }
        rows.push(GraphRow {
            col,
            color: col,
            segments,
            width: top.len().max(lanes.len()).max(col + 1),
        });
    }
    rows
}

#[cfg(test)]
pub(crate) mod wrappers {
    use super::*;

    pub fn layout_graph(commits: Vec<serde_json::Value>) -> Result<Vec<serde_json::Value>, String> {
        let typed: Vec<GraphCommit> = commits
            .into_iter()
            .map(serde_json::from_value)
            .collect::<Result<_, _>>()
            .map_err(|e| format!("TypeError: {e}"))?;
        layout(&typed)
            .iter()
            .map(|row| serde_json::to_value(row).map_err(|e| e.to_string()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(sha: &str, parents: &[&str]) -> GraphCommit {
        GraphCommit {
            sha: sha.into(),
            parents: parents.iter().map(|p| p.to_string()).collect(),
        }
    }

    #[test]
    fn merge_opens_and_closes_a_lane() {
        let rows = layout(&[c("m", &["a", "b"]), c("b", &["a"]), c("a", &[])]);
        assert_eq!(
            rows.iter().map(|r| r.col).collect::<Vec<_>>(),
            vec![0, 1, 0]
        );
        assert_eq!(rows[0].width, 2);
        assert_eq!(
            rows[2].segments,
            vec![seg(0, "top", 0, "mid"), seg(1, "top", 0, "mid")]
        );
    }
}
