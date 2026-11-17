//! JS bindings for `src/repo.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

/// `samePath`.
#[napi(js_name = "samePath")]
pub fn same_path(a: String, b: String) -> napi::Result<bool> {
    run(move || {
        let out = port::same_path(a, b)?;
        Ok(out)
    })
}

/// `parseLog`.
#[napi(js_name = "parseLog")]
pub fn parse_log(out: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_log(out)?;
        crate::js::to_json(&out)
    })
}

/// `parseRefs`.
#[napi(js_name = "parseRefs")]
pub fn parse_refs(out: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_refs(out)?;
        crate::js::to_json(&out)
    })
}

/// `parseStatus`.
#[napi(js_name = "parseStatus")]
pub fn parse_status(out: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_status(out)?;
        crate::js::to_json(&out)
    })
}

/// `parseNameStatus`.
#[napi(js_name = "parseNameStatus")]
pub fn parse_name_status(out: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_name_status(out)?;
        crate::js::to_json(&out)
    })
}

/// `remoteWebUrl`.
#[napi(js_name = "remoteWebUrl")]
pub fn remote_web_url(url: String) -> napi::Result<String> {
    run(move || {
        let out = port::remote_web_url(url)?;
        crate::js::to_json(&out)
    })
}

/// `commitWebUrl`.
#[napi(js_name = "commitWebUrl")]
pub fn commit_web_url(remote_url: String, sha: String) -> napi::Result<String> {
    run(move || {
        let out = port::commit_web_url(remote_url, sha)?;
        crate::js::to_json(&out)
    })
}

/// `compareWebUrl`.
#[napi(js_name = "compareWebUrl")]
pub fn compare_web_url(remote_url: String, branch: String) -> napi::Result<String> {
    run(move || {
        let out = port::compare_web_url(remote_url, branch)?;
        crate::js::to_json(&out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

thread_local! {
    static WIRE: std::cell::RefCell<Option<(napi::bindgen_prelude::Uint8Array, napi::bindgen_prelude::Uint8Array)>> =
        const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument and result buffers `index.cjs` writes to and reads from.
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// Reads `len` argument bytes, runs `f`, and writes its result; a negative return is the size
/// of a result that did not fit, kept for `rustAnythingWireFlush`.
fn wire_io(
    len: u32,
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output)) = guard.as_mut() else {
            return Err(napi::Error::from_reason(
                "rust-anything: the wire buffers are not registered",
            ));
        };
        let len = (len as usize).min(input.len());
        let mut w = wire::Writer::default();
        match run(|| f(&mut wire::Reader::new(&input[..len]), &mut w)) {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => return Ok(f64::NAN),
            other => other?,
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        Ok(n as f64)
    })
}

static S_PARSE_LOG_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("sha", wire::Schema::Str16),
    ("parents", wire::Schema::List(&wire::Schema::Str16)),
    ("author", wire::Schema::Str16),
    ("email", wire::Schema::Str16),
    ("time", wire::Schema::Num),
    ("subject", wire::Schema::Str16),
    ("stash", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `parseLog` over the binary wire.
#[napi(js_name = "parseLogWire")]
pub fn parse_log_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let out: String = r.string16()?;
        let out = &port::parse_log(out)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_LOG_OUT.inner())?;
        }
        Ok(())
    })
}

static S_PARSE_REFS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("kind", wire::Schema::Str16),
    ("name", wire::Schema::Str16),
    ("full", wire::Schema::Str16),
    ("sha", wire::Schema::Str16),
    ("upstream", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("ahead", wire::Schema::OptJs(&wire::Schema::Num)),
    ("behind", wire::Schema::OptJs(&wire::Schema::Num)),
    ("current", wire::Schema::OptJs(&wire::Schema::Bool)),
    ("worktree", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `parseRefs` over the binary wire.
#[napi(js_name = "parseRefsWire")]
pub fn parse_refs_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let out: String = r.string16()?;
        let out = &port::parse_refs(out)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_REFS_OUT.inner())?;
        }
        Ok(())
    })
}

static S_PARSE_STATUS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("path", wire::Schema::Str16),
    ("orig", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("index", wire::Schema::Str16),
    ("work", wire::Schema::Str16),
]));

/// `parseStatus` over the binary wire.
#[napi(js_name = "parseStatusWire")]
pub fn parse_status_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let out: String = r.string16()?;
        let out = &port::parse_status(out)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_STATUS_OUT.inner())?;
        }
        Ok(())
    })
}

static S_PARSE_NAME_STATUS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("status", wire::Schema::Str16),
    ("path", wire::Schema::Str16),
    ("orig", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `parseNameStatus` over the binary wire.
#[napi(js_name = "parseNameStatusWire")]
pub fn parse_name_status_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let out: String = r.string16()?;
        let out = &port::parse_name_status(out)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_NAME_STATUS_OUT.inner())?;
        }
        Ok(())
    })
}

static S_REMOTE_WEB_URL_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Str16);

/// `remoteWebUrl` over the binary wire.
#[napi(js_name = "remoteWebUrlWire")]
pub fn remote_web_url_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let url: String = r.string16()?;
        let out = &port::remote_web_url(url)?;
        wire::write_value(w, out, &S_REMOTE_WEB_URL_OUT)?;
        Ok(())
    })
}

static S_COMMIT_WEB_URL_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Str16);

/// `commitWebUrl` over the binary wire.
#[napi(js_name = "commitWebUrlWire")]
pub fn commit_web_url_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let remote_url: String = r.string16()?;
        let sha: String = r.string16()?;
        let out = &port::commit_web_url(remote_url, sha)?;
        wire::write_value(w, out, &S_COMMIT_WEB_URL_OUT)?;
        Ok(())
    })
}

static S_COMPARE_WEB_URL_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Str16);

/// `compareWebUrl` over the binary wire.
#[napi(js_name = "compareWebUrlWire")]
pub fn compare_web_url_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let remote_url: String = r.string16()?;
        let branch: String = r.string16()?;
        let out = &port::compare_web_url(remote_url, branch)?;
        wire::write_value(w, out, &S_COMPARE_WEB_URL_OUT)?;
        Ok(())
    })
}
