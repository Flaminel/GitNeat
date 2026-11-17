//! JS bindings for `src/diff.ts`: generated from the signatures in `port.rs` by rust-anything.
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

/// `parseDiff`.
#[napi(js_name = "parseDiff")]
pub fn parse_diff(text: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_diff(text)?;
        crate::js::to_json(&out)
    })
}

/// `hunkPatch`.
#[napi(js_name = "hunkPatch")]
pub fn hunk_patch(diff: String, hunk: String) -> napi::Result<String> {
    run(move || {
        let diff = crate::js::from_json(&diff)?;
        let hunk = crate::js::from_json(&hunk)?;
        let out = port::hunk_patch(diff, hunk)?;
        Ok(out)
    })
}

/// `linesPatch`.
#[napi(js_name = "linesPatch")]
pub fn lines_patch(
    diff: String,
    hunk: String,
    selected: String,
    reverse: bool,
) -> napi::Result<String> {
    run(move || {
        let diff = crate::js::from_json(&diff)?;
        let hunk = crate::js::from_json(&hunk)?;
        let selected = crate::js::from_json(&selected)?;
        let out = port::lines_patch(diff, hunk, selected, reverse)?;
        crate::js::to_json(&out)
    })
}

/// `linesInRange`.
#[napi(js_name = "linesInRange")]
pub fn lines_in_range(hunk: String, side: String, start: f64, end: f64) -> napi::Result<Vec<f64>> {
    run(move || {
        let hunk = crate::js::from_json(&hunk)?;
        let out = port::lines_in_range(hunk, side, start, end)?;
        Ok(out)
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

static S_PARSE_DIFF_OUT: wire::Schema = wire::Schema::Obj(&[
    ("fileHeader", wire::Schema::Str16),
    (
        "hunks",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("header", wire::Schema::Str16),
            ("oldStart", wire::Schema::Num),
            ("newStart", wire::Schema::Num),
            ("lines", wire::Schema::List(&wire::Schema::Dyn)),
        ])),
    ),
    ("binary", wire::Schema::Bool),
]);

/// `parseDiff` over the binary wire.
#[napi(js_name = "parseDiffWire")]
pub fn parse_diff_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let text: String = r.string16()?;
        let out = &port::parse_diff(text)?;
        wire::write_value(w, out, &S_PARSE_DIFF_OUT)?;
        Ok(())
    })
}

static S_HUNK_PATCH_0: wire::Schema = wire::Schema::Obj(&[
    ("fileHeader", wire::Schema::Str16),
    (
        "hunks",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("header", wire::Schema::Str16),
            ("oldStart", wire::Schema::Num),
            ("newStart", wire::Schema::Num),
            ("lines", wire::Schema::List(&wire::Schema::Dyn)),
        ])),
    ),
    ("binary", wire::Schema::Bool),
]);
static S_HUNK_PATCH_1: wire::Schema = wire::Schema::Obj(&[
    ("header", wire::Schema::Str16),
    ("oldStart", wire::Schema::Num),
    ("newStart", wire::Schema::Num),
    (
        "lines",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("kind", wire::Schema::Str16),
            ("text", wire::Schema::Str16),
            ("old", wire::Schema::OptJs(&wire::Schema::Num)),
            ("next", wire::Schema::OptJs(&wire::Schema::Num)),
            ("at", wire::Schema::OptJs(&wire::Schema::Num)),
            ("noNewline", wire::Schema::OptJs(&wire::Schema::Bool)),
        ])),
    ),
]);

/// `hunkPatch` over the binary wire.
#[napi(js_name = "hunkPatchWire")]
pub fn hunk_patch_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let diff: serde_json::Value = wire::read_value(r, &S_HUNK_PATCH_0)?;
        let hunk: serde_json::Value = wire::read_value(r, &S_HUNK_PATCH_1)?;
        let out = &port::hunk_patch(diff, hunk)?;
        w.string16(out);
        Ok(())
    })
}

static S_LINES_PATCH_0: wire::Schema = wire::Schema::Obj(&[
    ("fileHeader", wire::Schema::Str16),
    (
        "hunks",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("header", wire::Schema::Str16),
            ("oldStart", wire::Schema::Num),
            ("newStart", wire::Schema::Num),
            ("lines", wire::Schema::List(&wire::Schema::Dyn)),
        ])),
    ),
    ("binary", wire::Schema::Bool),
]);
static S_LINES_PATCH_1: wire::Schema = wire::Schema::Obj(&[
    ("header", wire::Schema::Str16),
    ("oldStart", wire::Schema::Num),
    ("newStart", wire::Schema::Num),
    (
        "lines",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("kind", wire::Schema::Str16),
            ("text", wire::Schema::Str16),
            ("old", wire::Schema::OptJs(&wire::Schema::Num)),
            ("next", wire::Schema::OptJs(&wire::Schema::Num)),
            ("at", wire::Schema::OptJs(&wire::Schema::Num)),
            ("noNewline", wire::Schema::OptJs(&wire::Schema::Bool)),
        ])),
    ),
]);
static S_LINES_PATCH_2: wire::Schema = wire::Schema::List(&wire::Schema::Num);
static S_LINES_PATCH_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Str16);

/// `linesPatch` over the binary wire.
#[napi(js_name = "linesPatchWire")]
pub fn lines_patch_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let diff: serde_json::Value = wire::read_value(r, &S_LINES_PATCH_0)?;
        let hunk: serde_json::Value = wire::read_value(r, &S_LINES_PATCH_1)?;
        let selected: serde_json::Value = wire::read_value(r, &S_LINES_PATCH_2)?;
        let reverse: bool = r.bool()?;
        let out = &port::lines_patch(diff, hunk, selected, reverse)?;
        wire::write_value(w, out, &S_LINES_PATCH_OUT)?;
        Ok(())
    })
}

static S_LINES_IN_RANGE_0: wire::Schema = wire::Schema::Obj(&[
    ("header", wire::Schema::Str16),
    ("oldStart", wire::Schema::Num),
    ("newStart", wire::Schema::Num),
    (
        "lines",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("kind", wire::Schema::Str16),
            ("text", wire::Schema::Str16),
            ("old", wire::Schema::OptJs(&wire::Schema::Num)),
            ("next", wire::Schema::OptJs(&wire::Schema::Num)),
            ("at", wire::Schema::OptJs(&wire::Schema::Num)),
            ("noNewline", wire::Schema::OptJs(&wire::Schema::Bool)),
        ])),
    ),
]);

/// `linesInRange` over the binary wire.
#[napi(js_name = "linesInRangeWire")]
pub fn lines_in_range_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let hunk: serde_json::Value = wire::read_value(r, &S_LINES_IN_RANGE_0)?;
        let side: String = r.string16()?;
        let start: f64 = r.f64()?;
        let end: f64 = r.f64()?;
        let out = &port::lines_in_range(hunk, side, start, end)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            w.f64(*x0);
        }
        Ok(())
    })
}
