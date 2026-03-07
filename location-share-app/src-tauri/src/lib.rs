use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_geolocation::init())
        .setup(|app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .on_navigation(|url: &Url| {
                    let host = url.host_str().unwrap_or_default();
                    host == "tauri.localhost"
                        || host == "localhost"
                        || host == "auth.johnsonyuen.com"
                });

            #[cfg(desktop)]
            let builder = builder.title("HomeKube").inner_size(900.0, 700.0);

            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
