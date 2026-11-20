use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::JsFunction;
use napi_derive::napi;

#[napi]
pub fn init(callback: JsFunction) -> Result<()> {
    gitneat_core::shellpath::apply();
    let sink: ThreadsafeFunction<(String, String), ErrorStrategy::Fatal> = callback
        .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<(String, String)>| {
            Ok(vec![
                ctx.env.create_string(&ctx.value.0)?,
                ctx.env.create_string(&ctx.value.1)?,
            ])
        })?;
    gitneat_core::emit::set(Box::new(move |event, payload| {
        sink.call(
            (event.to_string(), payload),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }));
    Ok(())
}

#[napi]
pub async fn invoke(name: String, args: String) -> Result<String> {
    let parsed: serde_json::Value =
        serde_json::from_str(&args).map_err(|e| Error::from_reason(e.to_string()))?;
    let value = gitneat_core::commands::invoke(&name, parsed)
        .await
        .map_err(Error::from_reason)?;
    Ok(value.to_string())
}
