use std::sync::Mutex;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::{Emitter, Manager};

/// Files the app was asked to open (double-clicked .mdoksi files), waiting for the window to pick them up.
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows / Linux: a double-clicked document arrives as a command-line argument
    let files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedFiles(Mutex::new(files)))
        .invoke_handler(tauri::generate_handler![take_opened_files])
        .build(tauri::generate_context!())
        .expect("error while running Matekos Doksi");

    app.run(|handle, event| {
        // macOS: documents arrive as an "open files" event (also while the app is already running)
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if let Some(state) = handle.try_state::<OpenedFiles>() {
                state.0.lock().unwrap().extend(paths.iter().cloned());
            }
            let _ = handle.emit("open-files", paths);
        }
        let _ = (&handle, &event);
    });
}
