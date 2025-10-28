// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nsg_cli::{Credentials, NsgClient};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, State, WebviewWindow};
use tauri_plugin_store::StoreExt;
use zip::write::FileOptions;
use zip::ZipWriter;

// Application state - store credentials instead of client
struct AppState {
    credentials: Mutex<Option<Credentials>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JobSummary {
    job_id: String,
    url: String,
    tool: Option<String>,
    job_stage: Option<String>,
    failed: bool,
    date_submitted: Option<String>,
    date_completed: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JobDetails {
    job_id: String,
    job_stage: String,
    failed: bool,
    date_submitted: Option<String>,
    self_uri: String,
    results_uri: Option<String>,
}

// Showcase mode utilities
fn is_showcase_mode() -> bool {
    std::env::var("SHOWCASE_MODE").unwrap_or_default() == "1"
}

fn anonymize_username(username: &str) -> String {
    if is_showcase_mode() {
        "demo_user".to_string()
    } else {
        username.to_string()
    }
}

fn anonymize_job_id(job_id: &str) -> String {
    if is_showcase_mode() {
        // Generate consistent but unique fake ID based on hash of original
        let prefix = "NGBW-JOB-";

        // Simple hash of the job_id string to generate a unique suffix
        let mut hash: u64 = 0;
        for byte in job_id.bytes() {
            hash = hash.wrapping_mul(31).wrapping_add(byte as u64);
        }

        // Convert hash to base36 string (using 0-9, A-Z)
        let chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let mut suffix = String::new();
        let mut h = hash;
        for _ in 0..12 {
            suffix.push(chars.chars().nth((h % 36) as usize).unwrap());
            h /= 36;
        }

        format!("{}{}", prefix, suffix)
    } else {
        job_id.to_string()
    }
}

fn anonymize_url(url: &str) -> String {
    if is_showcase_mode() {
        // Replace username and job_id in URL
        // NSG URLs format: https://nsgr.sdsc.edu:8443/cipresrest/v1/job/USERNAME/JOBID
        let parts: Vec<&str> = url.split('/').collect();
        if parts.len() >= 2 {
            let mut new_parts: Vec<String> = parts.iter().map(|s| s.to_string()).collect();
            // Replace second-to-last segment (username) with "demo_user"
            if parts.len() >= 2 {
                new_parts[parts.len() - 2] = "demo_user".to_string();
            }
            // Replace last segment (job ID) with anonymized version
            if let Some(job_id) = parts.last() {
                new_parts[parts.len() - 1] = anonymize_job_id(job_id);
            }
            return new_parts.join("/");
        }
        url.to_string()
    } else {
        url.to_string()
    }
}

#[allow(dead_code)]
fn anonymize_app_key(key: &str) -> String {
    if is_showcase_mode() {
        "DEMO-APP-KEY-".to_string() + &"X".repeat(32)
    } else {
        key.to_string()
    }
}

// Tauri Commands

#[tauri::command]
async fn load_credentials() -> Result<Option<Credentials>, String> {
    // Always return real credentials - they're needed for authentication
    // Anonymization only happens in display strings, not in credentials used for API calls
    match Credentials::load() {
        Ok(creds) => Ok(Some(creds)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn connect(
    username: String,
    password: String,
    app_key: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let creds = Credentials {
        username: username.clone(),
        password,
        app_key,
    };

    // Test connection by creating client
    let test_creds = creds.clone();
    tokio::task::spawn_blocking(move || {
        let client = NsgClient::new(test_creds)?;
        client.test_connection()
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Connection test failed: {}", e))?;

    // Store credentials in state
    *state.credentials.lock().unwrap() = Some(creds);

    Ok(format!("Connected as {}", anonymize_username(&username)))
}

#[tauri::command]
async fn list_jobs(state: State<'_, AppState>) -> Result<Vec<JobSummary>, String> {
    let creds = state
        .credentials
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not connected")?;

    let jobs = tokio::task::spawn_blocking(move || {
        let client = NsgClient::new(creds)?;
        client.list_jobs()
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to list jobs: {}", e))?;

    Ok(jobs
        .into_iter()
        .map(|j| JobSummary {
            job_id: anonymize_job_id(&j.job_id),
            url: anonymize_url(&j.url),
            tool: j.tool,
            job_stage: j.job_stage,
            failed: j.failed,
            date_submitted: j.date_submitted,
            date_completed: j.date_completed,
        })
        .collect())
}

#[tauri::command]
async fn get_job_status(job_url: String, state: State<'_, AppState>) -> Result<JobDetails, String> {
    let creds = state
        .credentials
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not connected")?;

    let status = tokio::task::spawn_blocking(move || {
        let client = NsgClient::new(creds)?;
        client.get_job_status(&job_url)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to get job status: {}", e))?;

    Ok(JobDetails {
        job_id: anonymize_job_id(&status.job_id),
        job_stage: status.job_stage,
        failed: status.failed,
        date_submitted: status.date_submitted,
        self_uri: anonymize_url(&status.self_uri),
        results_uri: status.results_uri.map(|u| anonymize_url(&u)),
    })
}

#[tauri::command]
async fn submit_job(
    file_path: String,
    tool: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let creds = state
        .credentials
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not connected")?;

    let path = PathBuf::from(file_path);
    let status = tokio::task::spawn_blocking(move || {
        let client = NsgClient::new(creds)?;
        client.submit_job(&path, &tool)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to submit job: {}", e))?;

    Ok(status.job_id)
}

#[tauri::command]
async fn download_results(
    job_url: String,
    output_dir: String,
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> Result<String, String> {
    let creds = state
        .credentials
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not connected")?;

    // Extract job ID from URL (e.g., "https://example.com/jobs/NGBW-JOB-123" -> "NGBW-JOB-123")
    let job_id = job_url
        .split('/')
        .last()
        .ok_or("Invalid job URL")?
        .to_string();

    tokio::task::spawn_blocking(move || {
        // Create temporary directory for downloads
        let temp_dir = std::env::temp_dir().join(format!("nsg_download_{}", job_id));
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp dir: {}", e))?;

        // Download files to temp directory with progress callback
        let client =
            NsgClient::new(creds).map_err(|e| format!("Failed to create client: {}", e))?;

        let window_clone = window.clone();
        let files = client
            .download_results(&job_url, &temp_dir, |filename, downloaded, total| {
                // Emit progress event to frontend
                let _ = window_clone.emit(
                    "download-progress",
                    json!({
                        "filename": filename,
                        "downloaded": downloaded,
                        "total": total,
                    }),
                );
            })
            .map_err(|e| format!("Failed to download results: {}", e))?;

        // Create output zip file
        let zip_filename = format!("nsg_results_{}.zip", job_id);
        let zip_path = PathBuf::from(&output_dir).join(&zip_filename);

        // Ensure output directory exists
        if let Some(parent) = zip_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output dir: {}", e))?;
        }

        // Create zip archive
        let zip_file =
            File::create(&zip_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
        let mut zip = ZipWriter::new(zip_file);
        let options = FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);

        // Add each downloaded file to the zip
        for file_info in files {
            let file_path = &file_info.path;
            let file_name = file_path
                .file_name()
                .ok_or("Invalid file path")?
                .to_string_lossy();

            // Read file contents
            let contents = std::fs::read(file_path)
                .map_err(|e| format!("Failed to read file {}: {}", file_name, e))?;

            // Add to zip
            zip.start_file(file_name.to_string(), options)
                .map_err(|e| format!("Failed to add file to zip: {}", e))?;
            zip.write_all(&contents)
                .map_err(|e| format!("Failed to write file to zip: {}", e))?;
        }

        // Finalize zip
        zip.finish()
            .map_err(|e| format!("Failed to finalize zip: {}", e))?;

        // Clean up temp directory
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean up temp dir: {}", e))?;

        // Emit completion event
        let _ = window.emit("download-complete", json!({}));

        Ok(zip_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn get_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    // Check if user has set a custom download directory
    if let Some(custom_dir) = store.get("download_dir") {
        if let Some(dir_str) = custom_dir.as_str() {
            return Ok(dir_str.to_string());
        }
    }

    // Default to ~/Downloads
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not determine home directory".to_string())?;

    let download_dir = PathBuf::from(home).join("Downloads");
    Ok(download_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn set_download_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    // Validate that the directory exists
    let path = PathBuf::from(&dir);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", dir));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", dir));
    }

    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    store.set("download_dir", json!(dir));
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_credentials_location() -> Result<String, String> {
    Ok(Credentials::credentials_location())
}

#[tauri::command]
async fn zoom_in(app: tauri::AppHandle, window: WebviewWindow) -> Result<f64, String> {
    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    // Get current zoom level
    let current_zoom = store
        .get("zoom_level")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);

    let new_zoom = (current_zoom + 0.1).min(3.0); // Max 300%

    // Save to store (auto-persists)
    store.set("zoom_level", json!(new_zoom));
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    // Apply to window
    window
        .eval(&format!("document.body.style.zoom = '{}'", new_zoom))
        .map_err(|e| format!("Failed to set zoom: {}", e))?;

    Ok(new_zoom)
}

#[tauri::command]
async fn zoom_out(app: tauri::AppHandle, window: WebviewWindow) -> Result<f64, String> {
    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let current_zoom = store
        .get("zoom_level")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);

    let new_zoom = (current_zoom - 0.1).max(0.5); // Min 50%

    store.set("zoom_level", json!(new_zoom));
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    window
        .eval(&format!("document.body.style.zoom = '{}'", new_zoom))
        .map_err(|e| format!("Failed to set zoom: {}", e))?;

    Ok(new_zoom)
}

#[tauri::command]
async fn reset_zoom(app: tauri::AppHandle, window: WebviewWindow) -> Result<f64, String> {
    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    store.set("zoom_level", json!(1.0));
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    window
        .eval("document.body.style.zoom = '1.0'")
        .map_err(|e| format!("Failed to reset zoom: {}", e))?;

    Ok(1.0)
}

#[tauri::command]
async fn get_zoom(app: tauri::AppHandle) -> Result<f64, String> {
    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let zoom = store
        .get("zoom_level")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);

    Ok(zoom)
}

#[tauri::command]
async fn get_theme(app: tauri::AppHandle) -> Result<String, String> {
    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let theme = store
        .get("theme")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "system".to_string());

    Ok(theme)
}

#[tauri::command]
async fn set_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    let store = app
        .store("preferences.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    store.set("theme", json!(theme));
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_showcase_mode() -> bool {
    is_showcase_mode()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            credentials: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            load_credentials,
            connect,
            list_jobs,
            get_job_status,
            submit_job,
            download_results,
            get_download_dir,
            set_download_dir,
            get_credentials_location,
            zoom_in,
            zoom_out,
            reset_zoom,
            get_zoom,
            get_theme,
            set_theme,
            get_showcase_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
