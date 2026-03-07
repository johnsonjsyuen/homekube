#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_navigation(|url| {
            let host = url.host_str().unwrap_or_default();
            host == "tauri.localhost"
                || host == "localhost"
                || host == "auth.johnsonyuen.com"
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
