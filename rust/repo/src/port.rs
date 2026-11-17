//! The Rust port of `src/repo.ts`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

/// Port of `samePath` (`src/repo.ts:100`).
pub fn same_path(a: String, b: String) -> Result<bool, String> {
    let _ = (&a, &b);
    unimplemented!("port `samePath` from src/repo.ts")
}

/// Port of `parseLog` (`src/repo.ts:232`).
pub fn parse_log(out: String) -> Result<Vec<serde_json::Value>, String> {
    let _ = &out;
    unimplemented!("port `parseLog` from src/repo.ts")
}

/// Port of `parseRefs` (`src/repo.ts:250`).
pub fn parse_refs(out: String) -> Result<Vec<serde_json::Value>, String> {
    let _ = &out;
    unimplemented!("port `parseRefs` from src/repo.ts")
}

/// Port of `parseStatus` (`src/repo.ts:284`).
pub fn parse_status(out: String) -> Result<Vec<serde_json::Value>, String> {
    let _ = &out;
    unimplemented!("port `parseStatus` from src/repo.ts")
}

/// Port of `parseNameStatus` (`src/repo.ts:353`).
pub fn parse_name_status(out: String) -> Result<Vec<serde_json::Value>, String> {
    let _ = &out;
    unimplemented!("port `parseNameStatus` from src/repo.ts")
}

/// Port of `remoteWebUrl` (`src/repo.ts:397`).
pub fn remote_web_url(url: String) -> Result<Option<String>, String> {
    let _ = &url;
    unimplemented!("port `remoteWebUrl` from src/repo.ts")
}

/// Port of `commitWebUrl` (`src/repo.ts:402`).
pub fn commit_web_url(remote_url: String, sha: String) -> Result<Option<String>, String> {
    let _ = (&remote_url, &sha);
    unimplemented!("port `commitWebUrl` from src/repo.ts")
}

/// Port of `compareWebUrl` (`src/repo.ts:416`).
pub fn compare_web_url(remote_url: String, branch: String) -> Result<Option<String>, String> {
    let _ = (&remote_url, &branch);
    unimplemented!("port `compareWebUrl` from src/repo.ts")
}
