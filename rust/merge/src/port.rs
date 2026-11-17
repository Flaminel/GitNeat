//! The Rust port of `src/merge.ts`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

/// Port of `splitLines` (`src/merge.ts:15`).
pub fn split_lines(text: String) -> Result<Vec<String>, String> {
    let _ = &text;
    unimplemented!("port `splitLines` from src/merge.ts")
}

/// Port of `parseMerge` (`src/merge.ts:23`).
pub fn parse_merge(text: String) -> Result<Vec<serde_json::Value>, String> {
    let _ = &text;
    unimplemented!("port `parseMerge` from src/merge.ts")
}

/// Port of `sideLines` (`src/merge.ts:57`).
pub fn side_lines(
    segments: Vec<serde_json::Value>,
    side: String,
) -> Result<serde_json::Value, String> {
    let _ = (&segments, &side);
    unimplemented!("port `sideLines` from src/merge.ts")
}

/// Port of `buildOutput` (`src/merge.ts:71`).
pub fn build_output(
    segments: Vec<serde_json::Value>,
    selections: Vec<Option<Vec<serde_json::Value>>>,
    markers: Option<bool>,
) -> Result<serde_json::Value, String> {
    let _ = (&segments, &selections, &markers);
    unimplemented!("port `buildOutput` from src/merge.ts")
}

/// Port of `togglePick` (`src/merge.ts:92`).
pub fn toggle_pick(
    sel: Option<Vec<serde_json::Value>>,
    p: serde_json::Value,
) -> Result<Option<Vec<serde_json::Value>>, String> {
    let _ = (&sel, &p);
    unimplemented!("port `togglePick` from src/merge.ts")
}

/// Port of `sideTaken` (`src/merge.ts:104`).
pub fn side_taken(
    sel: Option<Vec<serde_json::Value>>,
    side: String,
    count: f64,
) -> Result<bool, String> {
    let _ = (&sel, &side, &count);
    unimplemented!("port `sideTaken` from src/merge.ts")
}

/// Port of `toggleSide` (`src/merge.ts:107`).
pub fn toggle_side(
    sel: Option<Vec<serde_json::Value>>,
    side: String,
    count: f64,
) -> Result<Option<Vec<serde_json::Value>>, String> {
    let _ = (&sel, &side, &count);
    unimplemented!("port `toggleSide` from src/merge.ts")
}

/// Port of `allTaken` (`src/merge.ts:118`).
pub fn all_taken(
    segments: Vec<serde_json::Value>,
    sels: Vec<Option<Vec<serde_json::Value>>>,
    side: String,
) -> Result<bool, String> {
    let _ = (&segments, &sels, &side);
    unimplemented!("port `allTaken` from src/merge.ts")
}

/// Port of `takeAll` (`src/merge.ts:123`).
pub fn take_all(
    segments: Vec<serde_json::Value>,
    sels: Vec<Option<Vec<serde_json::Value>>>,
    side: String,
) -> Result<Vec<Option<Vec<serde_json::Value>>>, String> {
    let _ = (&segments, &sels, &side);
    unimplemented!("port `takeAll` from src/merge.ts")
}
