use serde_json::{Map, Value};

use crate::application::errors::ApplicationError;
use crate::domain::repositories::chat_completion_repository::ChatCompletionSource;

mod chutes;
mod claude;
mod claude_messages;
mod cohere;
mod custom;
mod deepseek;
mod gemini_interactions;
mod makersuite;
mod moonshot;
mod nanogpt;
mod openai;
mod openai_responses;
mod openrouter;
mod prompt_post_processing;
mod shared;
mod tool_calls;
mod vertexai;
mod zai;

pub(super) fn build_payload(
    source: ChatCompletionSource,
    payload: Map<String, Value>,
) -> Result<(String, Value), ApplicationError> {
    let mut payload = payload;
    let include_body_raw = payload
        .get("custom_include_body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let exclude_body_raw = payload
        .get("custom_exclude_body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if source != ChatCompletionSource::DeepSeek {
        prompt_post_processing::apply_custom_prompt_post_processing(&mut payload);
    }

    let (endpoint_path, mut upstream_payload) = match source {
        ChatCompletionSource::OpenAi
        | ChatCompletionSource::Groq
        | ChatCompletionSource::SiliconFlow => Ok(openai::build(payload)),
        ChatCompletionSource::DeepSeek => deepseek::build(payload),
        ChatCompletionSource::Cohere => Ok(cohere::build(payload)?),
        ChatCompletionSource::Moonshot => Ok(moonshot::build(payload)),
        ChatCompletionSource::NanoGpt => nanogpt::build(payload),
        ChatCompletionSource::Chutes => chutes::build(payload),
        ChatCompletionSource::OpenRouter => Ok(openrouter::build(payload)),
        ChatCompletionSource::Zai => Ok(zai::build(payload)),
        ChatCompletionSource::Custom => custom::build(payload),
        ChatCompletionSource::Claude => Ok(claude::build(payload)?),
        ChatCompletionSource::Makersuite => Ok(makersuite::build(payload)?),
        ChatCompletionSource::VertexAi => Ok(vertexai::build(payload)?),
    }?;

    if matches!(
        source,
        ChatCompletionSource::Claude | ChatCompletionSource::DeepSeek
    ) {
        shared::apply_custom_body_overrides(
            &mut upstream_payload,
            &include_body_raw,
            &exclude_body_raw,
        )?;
    }

    Ok((endpoint_path, upstream_payload))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn deepseek_applies_additional_body_overrides() {
        let payload = json!({
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.7,
            "max_tokens": 64,
            "custom_include_body": "response_format: { type: json_object }\ncustom_flag: true",
            "custom_exclude_body": "- temperature"
        })
        .as_object()
        .cloned()
        .expect("payload must be an object");

        let (_, body) =
            build_payload(ChatCompletionSource::DeepSeek, payload).expect("payload should build");

        assert_eq!(
            body.pointer("/response_format/type")
                .and_then(Value::as_str),
            Some("json_object")
        );
        assert_eq!(body.get("custom_flag").and_then(Value::as_bool), Some(true));
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn claude_applies_additional_body_overrides() {
        let payload = json!({
            "model": "claude-sonnet-4-5",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.7,
            "max_tokens": 64,
            "stream": false,
            "custom_include_body": "metadata: { user_id: test-user }",
            "custom_exclude_body": "- temperature"
        })
        .as_object()
        .cloned()
        .expect("payload must be an object");

        let (_, body) =
            build_payload(ChatCompletionSource::Claude, payload).expect("payload should build");

        assert_eq!(
            body.pointer("/metadata/user_id").and_then(Value::as_str),
            Some("test-user")
        );
        assert!(body.get("temperature").is_none());
    }
}
