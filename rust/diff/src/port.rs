//! The Rust port of `src/diff.ts`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

/// Port of `parseDiff` (`src/diff.ts:27`).
pub fn parse_diff(text: String) -> Result<serde_json::Value, String> {
    let _ = &text;
    unimplemented!("port `parseDiff` from src/diff.ts")
}

/// Port of `hunkPatch` (`src/diff.ts:72`).
pub fn hunk_patch(diff: serde_json::Value, hunk: serde_json::Value) -> Result<String, String> {
    let _ = (&diff, &hunk);
    unimplemented!("port `hunkPatch` from src/diff.ts")
}

/// Port of `linesPatch` (`src/diff.ts:77`).
pub fn lines_patch(
    diff: serde_json::Value,
    hunk: serde_json::Value,
    selected: serde_json::Value,
    reverse: bool,
) -> Result<Option<String>, String> {
    let _ = (&diff, &hunk, &selected, &reverse);
    unimplemented!("port `linesPatch` from src/diff.ts")
}

/// Port of `linesInRange` (`src/diff.ts:101`).
pub fn lines_in_range(
    hunk: serde_json::Value,
    side: String,
    start: f64,
    end: f64,
) -> Result<Vec<f64>, String> {
    let _ = (&hunk, &side, &start, &end);
    unimplemented!("port `linesInRange` from src/diff.ts")
}
