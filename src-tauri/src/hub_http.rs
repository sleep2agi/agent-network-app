// App HTTP (hub + everything else appFetch reaches) over ONE long-lived client, so requests
// reuse connections. JS side: src/app-fetch.ts.
//
// tauri-plugin-http builds a new reqwest Client for every fetch (commands.rs,
// `reqwest::ClientBuilder::new()` … `builder.build()?` per call, still so in 2.8.0), so every
// hub request paid a fresh TCP + TLS handshake. From China to the US hub that is ~0.5 s on top
// of the ~0.22 s round trip — a cold request cost 0.7–0.8 s, and every screen is a few of them.
// This command is the same request with a process-wide pool: after the first request to a hub,
// the rest ride warm connections (HTTP/2 multiplexed where the hub's front end speaks it).
//
// Same reqwest line (0.12) and features as the plugin (rustls, http2, charset, macOS system
// proxy, gzip), so TLS, proxy and decompression behave as before. No cookie jar: the hub
// authenticates with a bearer header and sets no cookies.
//
// Wire format back to JS (raw IPC bytes, no JSON array of numbers):
//   [u32 big-endian meta length][meta JSON {status,statusText,url,headers}][body bytes]

use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use std::time::Duration;

// Attachments / images come through here too: the cap is for a stuck body, not a slow link.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

static CLIENT: LazyLock<Result<reqwest_pool::Client, String>> = LazyLock::new(|| {
    reqwest_pool::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(30))
        .user_agent(concat!("agent-network-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
});

#[derive(Deserialize)]
pub struct HubFetchRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    data: Option<Vec<u8>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseMeta {
    status: u16,
    status_text: String,
    url: String,
    headers: Vec<(String, String)>,
}

pub fn frame(meta: &[u8], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + meta.len() + body.len());
    out.extend_from_slice(&(meta.len() as u32).to_be_bytes());
    out.extend_from_slice(meta);
    out.extend_from_slice(body);
    out
}

#[tauri::command]
pub async fn pooled_fetch(request: HubFetchRequest) -> Result<tauri::ipc::Response, String> {
    let client = CLIENT.as_ref().map_err(|error| error.clone())?;
    let url = reqwest_pool::Url::parse(&request.url).map_err(|_| "invalid URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("URL must use http or https".into());
    }
    let method = reqwest_pool::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| "invalid method".to_string())?;
    let mut builder = client.request(method.clone(), url);
    for (name, value) in &request.headers {
        // reqwest owns these on a pooled connection; a caller's copy would conflict.
        if name.eq_ignore_ascii_case("host") || name.eq_ignore_ascii_case("content-length") || name.eq_ignore_ascii_case("connection") {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_str());
    }
    match request.data {
        Some(data) => builder = builder.body(data),
        // Same rule as the plugin: a body-less POST / PUT still sends Content-Length: 0.
        None if matches!(method, reqwest_pool::Method::POST | reqwest_pool::Method::PUT) => {
            builder = builder.header("content-length", "0")
        }
        None => {}
    }
    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let meta = ResponseMeta {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        url: response.url().to_string(),
        headers: response
            .headers()
            .iter()
            .filter_map(|(name, value)| value.to_str().ok().map(|v| (name.to_string(), v.to_string())))
            .collect(),
    };
    let body = response.bytes().await.map_err(|error| error.to_string())?;
    let meta = serde_json::to_vec(&meta).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(frame(&meta, &body)))
}

#[cfg(test)]
mod tests {
    use super::frame;

    #[test]
    fn pooled_fetch_frame_is_length_prefixed_meta_then_body() {
        let out = frame(b"{\"status\":200}", b"hello");
        assert_eq!(&out[..4], &14u32.to_be_bytes());
        assert_eq!(&out[4..18], b"{\"status\":200}");
        assert_eq!(&out[18..], b"hello");
    }
}
