#[cfg(windows)]
fn clear_window_region(window: &tauri::WebviewWindow) -> crate::Result<()> {
    use windows_sys::Win32::Graphics::Gdi::SetWindowRgn;
    let hwnd = window.hwnd().map_err(crate::err)?;
    // GDI regions have binary coverage and cut off the compositor's partially
    // transparent edge pixels. Leave the HWND transparent and let one CSS clip
    // produce the antialiased corners instead of intersecting it with an HRGN.
    unsafe {
        if SetWindowRgn(hwnd.0 as _, std::ptr::null_mut(), 1) == 0 {
            return Err("无法清除窗口硬裁剪".into());
        }
    }
    Ok(())
}

pub fn prepare(window: &tauri::WebviewWindow) -> crate::Result<()> {
    window.set_shadow(false).map_err(crate::err)?;
    #[cfg(windows)]
    clear_window_region(window)?;
    Ok(())
}

pub fn center_for_startup(window: &tauri::WebviewWindow) -> crate::Result<()> {
    let monitor = window
        .current_monitor()
        .map_err(crate::err)?
        .or(window.primary_monitor().map_err(crate::err)?);
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let size = window.outer_size().map_err(crate::err)?;
        // Both rectangles are physical pixels, so mixed DPI and monitors with
        // negative desktop coordinates do not inherit the old logical offset.
        window
            .set_position(tauri::PhysicalPosition::new(
                area.position.x + (area.size.width as i32 - size.width as i32) / 2,
                area.position.y + (area.size.height as i32 - size.height as i32) / 2,
            ))
            .map_err(crate::err)
    } else {
        window.center().map_err(crate::err)
    }
}
