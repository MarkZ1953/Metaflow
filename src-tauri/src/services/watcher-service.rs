use super::inbox_service::InboxEngine;
use notify::{RecursiveMode, Watcher};
use std::{path::PathBuf, sync::mpsc, time::Duration};
use tauri::Emitter;

pub fn start(engine: InboxEngine, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::sync_channel(1);
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                // Ignore reads/access events; they otherwise create a self-notification loop.
                if !event
                    .as_ref()
                    .is_ok_and(|e| matches!(e.kind, notify::EventKind::Access(_)))
                {
                    let _ = tx.try_send(event.is_ok());
                }
            })
            .ok();
        let mut watched: Option<PathBuf> = None;
        loop {
            let requested = engine
                .lock()
                .ok()
                .and_then(|r| r.inbox.as_ref().map(|i| PathBuf::from(&i.path)));
            if requested != watched {
                if let (Some(w), Some(path)) = (&mut watcher, &watched) {
                    let _ = w.unwatch(path);
                }
                let active = if let (Some(w), Some(path)) = (&mut watcher, &requested) {
                    w.watch(path, RecursiveMode::NonRecursive).is_ok()
                } else {
                    false
                };
                if let Ok(mut state) = engine.lock() {
                    state.watcher_status = if requested.is_none() {
                        "idle"
                    } else if active {
                        "watching"
                    } else {
                        "polling"
                    }
                    .into();
                }
                watched = requested;
                let _ = app.emit("inbox-changed", ());
                engine.log("WATCHER_CONFIGURED", usize::from(active));
            }
            match engine.reconcile() {
                Ok(true) => {
                    let _ = app.emit("inbox-changed", ());
                }
                Ok(false) => {}
                Err(error) => {
                    if let Ok(mut state) = engine.lock() {
                        if state.error.as_deref() != Some(error.code) {
                            state.error = Some(error.code.into());
                            let _ = app.emit("inbox-changed", ());
                            engine.log(error.code, 1);
                        }
                    }
                }
            }
            // Reconciliation is rate limited even during event storms. Polling repairs missed notifications.
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(false) => {
                    engine.log("WATCHER_ERROR", 1);
                }
                Ok(true) => {
                    engine.log("WATCHER_EVENT", 1);
                    std::thread::sleep(Duration::from_millis(750));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(Duration::from_secs(1))
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    });
}
